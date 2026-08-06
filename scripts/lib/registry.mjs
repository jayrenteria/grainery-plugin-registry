import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import semver from 'semver';

import { inspectArchive } from './archive.mjs';
import { ARCHIVE_EXTENSION } from './constants.mjs';

const execFileAsync = promisify(execFile);
const pluginId = /^(?!\.{1,2}$)[a-z0-9._-]{1,64}$/;
const categories = new Set(['editing', 'formatting', 'navigation', 'productivity', 'review', 'writing']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJson(filePath, errors) {
  return readFile(filePath, 'utf8').then(JSON.parse).catch((error) => {
    errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
}

function validatePluginMetadata(value, pluginDir, errors) {
  if (!isObject(value)) return errors.push(`${pluginDir}/plugin.json must be an object`);
  const allowed = new Set(['schemaVersion', 'id', 'publisher', 'license', 'repositoryUrl', 'homepageUrl', 'categories', 'tags', 'icon', 'readme', 'screenshots']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${pluginDir}/plugin.json contains unknown property '${key}'`);
  if (value.schemaVersion !== 1) errors.push(`${pluginDir}/plugin.json schemaVersion must equal 1`);
  if (typeof value.id !== 'string' || !pluginId.test(value.id)) errors.push(`${pluginDir}/plugin.json id is invalid`);
  if (!isObject(value.publisher) || typeof value.publisher.name !== 'string' || !value.publisher.name.trim()) errors.push(`${pluginDir}/plugin.json publisher.name is required`);
  if (value.publisher?.url !== undefined && (!/^https:\/\//.test(value.publisher.url) || !URL.canParse(value.publisher.url))) errors.push(`${pluginDir}/plugin.json publisher.url must be an HTTPS URL`);
  if (typeof value.license !== 'string' || !value.license.trim()) errors.push(`${pluginDir}/plugin.json license is required`);
  for (const key of ['repositoryUrl', 'homepageUrl']) if (value[key] !== undefined && (!/^https:\/\//.test(value[key]) || !URL.canParse(value[key]))) errors.push(`${pluginDir}/plugin.json ${key} must be an HTTPS URL`);
  if (!Array.isArray(value.categories) || value.categories.some((item) => !categories.has(item)) || new Set(value.categories).size !== value.categories.length || value.categories.length > 5) errors.push(`${pluginDir}/plugin.json categories are invalid`);
  if (!Array.isArray(value.tags) || value.tags.some((item) => typeof item !== 'string' || !/^[a-z0-9-]{1,32}$/.test(item)) || new Set(value.tags).size !== value.tags.length || value.tags.length > 10) errors.push(`${pluginDir}/plugin.json tags are invalid`);
}

async function validateAssets(metadata, pluginDir, errors) {
  const screenshots = Array.isArray(metadata?.screenshots) ? metadata.screenshots : [];
  const assets = [metadata?.icon, metadata?.readme, ...screenshots.map((shot) => shot?.path)].filter(Boolean);
  if (metadata?.icon !== undefined && !/^icon\.(png|webp)$/.test(metadata.icon)) errors.push(`${pluginDir}/plugin.json icon is invalid`);
  if (metadata?.readme !== undefined && metadata.readme !== 'README.md') errors.push(`${pluginDir}/plugin.json readme is invalid`);
  if (metadata?.screenshots !== undefined && (!Array.isArray(metadata.screenshots) || metadata.screenshots.length > 5 || metadata.screenshots.some((shot) => !isObject(shot) || !/^screenshots\/[A-Za-z0-9._-]+\.(png|jpe?g|webp)$/.test(shot.path) || typeof shot.alt !== 'string' || !shot.alt.trim() || shot.alt.length > 200))) errors.push(`${pluginDir}/plugin.json screenshots are invalid`);
  for (const asset of assets) {
    try {
      const result = await readFile(path.join(pluginDir, asset));
      if (!result.length) errors.push(`${pluginDir}/${asset} must not be empty`);
    } catch {
      errors.push(`Required asset is missing: ${pluginDir}/${asset}`);
    }
  }
}

function validateVersionMetadata(value, versionDir, errors) {
  if (!isObject(value)) return errors.push(`${versionDir}/version.json must be an object`);
  const allowed = new Set(['schemaVersion', 'version', 'archive', 'releaseNotes', 'yanked']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${versionDir}/version.json contains unknown property '${key}'`);
  if (value.schemaVersion !== 1) errors.push(`${versionDir}/version.json schemaVersion must equal 1`);
  if (typeof value.version !== 'string' || !semver.valid(value.version)) errors.push(`${versionDir}/version.json version must be a semantic version`);
  if (typeof value.archive !== 'string' || !value.archive.endsWith(ARCHIVE_EXTENSION)) errors.push(`${versionDir}/version.json archive is invalid`);
  if (typeof value.releaseNotes !== 'string' || !value.releaseNotes.trim() || value.releaseNotes.length > 5000) errors.push(`${versionDir}/version.json releaseNotes are required`);
  if (typeof value.yanked !== 'boolean') errors.push(`${versionDir}/version.json yanked must be boolean`);
}

async function baseFile(rootDir, baseRef, relativePath) {
  try {
    return (await execFileAsync('git', ['-C', rootDir, 'show', `${baseRef}:${relativePath}`], { encoding: 'buffer' })).stdout;
  } catch (error) {
    if (error.code === 128) return null;
    throw error;
  }
}

async function validateHistory(rootDir, baseRef, record, errors) {
  const relativeVersionDir = path.relative(rootDir, record.versionDir).split(path.sep).join('/');
  const previousVersion = await baseFile(rootDir, baseRef, `${relativeVersionDir}/version.json`);
  if (!previousVersion) return;
  let previous;
  try { previous = JSON.parse(previousVersion); } catch { errors.push(`${baseRef}:${relativeVersionDir}/version.json is invalid JSON`); return; }
  const current = { ...record.versionMetadata };
  const wasYanked = previous.yanked;
  delete previous.yanked;
  delete current.yanked;
  if (JSON.stringify(previous) !== JSON.stringify(current)) errors.push(`${relativeVersionDir} is immutable; only version.json yanked may change`);
  const previousArchive = await baseFile(rootDir, baseRef, `${relativeVersionDir}/${record.versionMetadata.archive}`);
  if (!previousArchive) errors.push(`${relativeVersionDir} was previously published without its archive`);
  else if (createHash('sha256').update(previousArchive).digest('hex') !== createHash('sha256').update(await readFile(record.archivePath)).digest('hex')) errors.push(`${relativeVersionDir} archive is immutable after publication`);
  if (typeof wasYanked !== 'boolean') errors.push(`${baseRef}:${relativeVersionDir}/version.json has invalid yanked state`);
}

async function validateNoPublishedVersionWasDeleted(rootDir, baseRef, records, errors) {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', rootDir, 'ls-tree', '-r', '--name-only', baseRef, '--', 'registry/plugins'],
    { encoding: 'utf8' },
  );
  const currentVersionFiles = new Set(records.map((record) => (
    `${path.relative(rootDir, record.versionDir).split(path.sep).join('/')}/version.json`
  )));
  for (const file of stdout.split('\n')) {
    if (/^registry\/plugins\/[^/]+\/versions\/[^/]+\/version\.json$/.test(file) && !currentVersionFiles.has(file)) {
      errors.push(`${file}: published versions cannot be deleted; set yanked to true instead`);
    }
  }
}

async function baseRefExists(rootDir, baseRef) {
  try {
    await execFileAsync('git', ['-C', rootDir, 'rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

export async function loadAndValidateRegistry({ rootDir, baseRef } = {}) {
  const absoluteRoot = path.resolve(rootDir ?? process.cwd());
  const pluginsRoot = path.join(absoluteRoot, 'registry', 'plugins');
  const errors = [];
  const checkHistory = baseRef && await baseRefExists(absoluteRoot, baseRef);
  if (baseRef && !checkHistory) errors.push(`Invalid baseRef: ${baseRef}`);
  let pluginNames = [];
  try { pluginNames = await readdir(pluginsRoot, { withFileTypes: true }); } catch { errors.push(`Registry plugins directory not found: ${pluginsRoot}`); }
  const records = [];
  const seen = new Set();
  for (const pluginEntry of await pluginNames) {
    if (pluginEntry.name.startsWith('.')) continue;
    if (!pluginEntry.isDirectory()) { errors.push(`Registry plugins entry must be a directory: ${pluginEntry.name}`); continue; }
    const pluginDir = path.join(pluginsRoot, pluginEntry.name);
    const pluginMetadata = await readJson(path.join(pluginDir, 'plugin.json'), errors);
    validatePluginMetadata(pluginMetadata, pluginDir, errors);
    await validateAssets(pluginMetadata, pluginDir, errors);
    if (pluginMetadata?.id !== pluginEntry.name) errors.push(`${pluginDir} directory name must equal plugin.json id`);
    let versionEntries = [];
    try { versionEntries = await readdir(path.join(pluginDir, 'versions'), { withFileTypes: true }); } catch { errors.push(`Versions directory not found: ${pluginDir}/versions`); }
    for (const versionEntry of versionEntries) {
      if (!versionEntry.isDirectory()) { errors.push(`Version entry must be a directory: ${versionEntry.name}`); continue; }
      const versionDir = path.join(pluginDir, 'versions', versionEntry.name);
      const versionMetadata = await readJson(path.join(versionDir, 'version.json'), errors);
      validateVersionMetadata(versionMetadata, versionDir, errors);
      if (versionMetadata?.version !== versionEntry.name) errors.push(`${versionDir} directory name must equal version.json version`);
      const expectedArchive = `${pluginMetadata?.id}-${versionMetadata?.version}${ARCHIVE_EXTENSION}`;
      if (versionMetadata?.archive !== expectedArchive) errors.push(`${versionDir}/version.json archive must equal ${expectedArchive}`);
      const archivePath = path.join(versionDir, versionMetadata?.archive ?? '');
      const inspected = await inspectArchive(archivePath);
      errors.push(...inspected.errors.map((error) => `${archivePath}: ${error}`));
      if (inspected.manifest && (inspected.manifest.id !== pluginMetadata?.id || inspected.manifest.version !== versionMetadata?.version)) errors.push(`${archivePath}: archive manifest id and version must match its directory metadata`);
      const key = `${pluginMetadata?.id}@${versionMetadata?.version}`;
      if (seen.has(key)) errors.push(`Duplicate plugin ID and version: ${key}`);
      seen.add(key);
      const record = { pluginMetadata, versionMetadata, manifest: inspected.manifest, archivePath, pluginDir, versionDir };
      if (checkHistory && versionMetadata && inspected.manifest) await validateHistory(absoluteRoot, baseRef, record, errors);
      records.push(record);
    }
  }
  if (checkHistory) await validateNoPublishedVersionWasDeleted(absoluteRoot, baseRef, records, errors);
  if (errors.length) throw new AggregateError(errors, `Registry validation failed with ${errors.length} error${errors.length === 1 ? '' : 's'}`);
  return records.sort((a, b) => a.pluginMetadata.id.localeCompare(b.pluginMetadata.id) || semver.compare(a.versionMetadata.version, b.versionMetadata.version));
}
