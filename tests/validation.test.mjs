import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { loadAndValidateRegistry } from '../scripts/lib/registry.mjs';
import { MAX_ARCHIVE_BYTES, MAX_ARCHIVE_ENTRIES } from '../scripts/lib/constants.mjs';
import { verifySha256 } from '../scripts/lib/signing.mjs';

const execFileAsync = promisify(execFile);
const crc32 = (value) => {
  let crc = ~0;
  for (const byte of value) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (~crc) >>> 0;
};
const u16 = (value) => Buffer.from([value & 255, value >>> 8 & 255]);
const u32 = (value) => Buffer.from([value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24 & 255]);
function zip(entries) {
  const locals = []; const central = []; let offset = 0;
  for (const item of entries) {
    const name = Buffer.from(item.name); const data = Buffer.isBuffer(item.data) ? item.data : Buffer.from(item.data); const crc = crc32(data); const flags = item.flags ?? 0; const method = item.method ?? 0; const external = item.external ?? 0;
    const local = Buffer.concat([Buffer.from('PK\x03\x04'), u16(20), u16(flags), u16(method), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
    locals.push(local);
    central.push(Buffer.concat([Buffer.from('PK\x01\x02'), u16(0x0314), u16(20), u16(flags), u16(method), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(external), u32(offset), name]));
    offset += local.length;
  }
  const directory = Buffer.concat(central);
  return Buffer.concat([...locals, directory, Buffer.from('PK\x05\x06'), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(directory.length), u32(offset), u16(0)]);
}
function manifest(id = 'com.example.plugin', version = '1.0.0', extra = {}) {
  return JSON.stringify({ schemaVersion: 1, id, name: 'Example Plugin', version, description: 'Example plugin.', engine: { grainery: '>=0.1.0', pluginApi: '^1.2.0' }, entry: 'dist/main.js', permissions: ['document:read'], optionalPermissions: [], networkAllowlist: [], activationEvents: ['onStartup'], contributes: { commands: [], menus: [], keybindings: [], exporters: [], importers: [], statusBadges: [], inlineAnnotationProviders: [], uiControls: [], uiPanels: [], transforms: [] }, ...extra });
}
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'registry-validation-')); t.after(() => rm(root, { recursive: true, force: true }));
  const id = options.id ?? 'com.example.plugin'; const version = options.version ?? '1.0.0'; const pluginDir = path.join(root, 'registry/plugins', id); const versionDir = path.join(pluginDir, 'versions', version); await mkdir(versionDir, { recursive: true });
  const plugin = { schemaVersion: 1, id, publisher: { name: 'Example' }, license: 'MIT', categories: ['writing'], tags: ['example'], ...(options.plugin ?? {}) };
  const archive = options.archive ?? `${id}-${version}.grainery-plugin.zip`;
  const versionMeta = { schemaVersion: 1, version, archive, releaseNotes: 'Initial release.', yanked: false, ...(options.versionMeta ?? {}) };
  const entries = options.entries ?? [{ name: 'grainery-plugin.manifest.json', data: manifest(id, version, options.manifest) }, { name: 'dist/main.js', data: 'export default {};' }];
  await writeFile(path.join(pluginDir, 'plugin.json'), JSON.stringify(plugin)); await writeFile(path.join(versionDir, 'version.json'), JSON.stringify(versionMeta)); await writeFile(path.join(versionDir, archive), zip(entries));
  return { root, pluginDir, versionDir, archivePath: path.join(versionDir, archive) };
}
async function rejects(t, options, message) { const item = await fixture(t, options); await assert.rejects(loadAndValidateRegistry({ rootDir: item.root }), (error) => error.errors.some((value) => value.includes(message)), message); }

test('loads a valid registry record', async (t) => {
  const item = await fixture(t); const [record] = await loadAndValidateRegistry({ rootDir: item.root });
  assert.equal(record.manifest.id, 'com.example.plugin'); assert.equal(record.archivePath, item.archivePath); assert.equal(record.versionMetadata.yanked, false);
});

test('enforces catalog metadata, assets, and source identity', async (t) => {
  await rejects(t, { plugin: { id: 'other.plugin', icon: 'icon.png' } }, 'directory name must equal');
  await rejects(t, { plugin: { id: 'Com.Example.Plugin' } }, 'plugin.json id is invalid');
  await rejects(t, { plugin: { id: '.' } }, 'plugin.json id is invalid');
});

test('rejects manifest signature, bad permissions, API range, missing entry, and identity mismatch', async (t) => {
  await rejects(t, { manifest: { id: 'Com.Example.Plugin' } }, 'canonical lowercase plugin ID');
  await rejects(t, { manifest: { signature: {} } }, 'signature must be absent');
  await rejects(t, { manifest: { permissions: ['system:root'] } }, 'Unknown permission');
  await rejects(t, { manifest: { engine: { grainery: '>=0.1.0', pluginApi: '^1.0.0' } } }, 'pluginApi');
  await rejects(t, { manifest: { entry: 'missing.js' } }, 'missing manifest entry');
  await rejects(t, { manifest: { id: 'com.example.other' } }, 'archive manifest id and version');
  await rejects(t, { manifest: { engine: { grainery: '1.0.0 - 2.0.0', pluginApi: '^1.2.0' } } }, 'Grainery-compatible');
  await rejects(t, { manifest: { contributes: { commands: [{ id: 'missing-title' }], menus: [], keybindings: [], exporters: [], importers: [], statusBadges: [], inlineAnnotationProviders: [], uiControls: [], uiPanels: [], transforms: [] } } }, 'title is required');
});

test('rejects unsafe, duplicate, case-colliding, symlink, encrypted, and unsupported ZIP entries', async (t) => {
  for (const [name, entries, expected] of [
    ['unsafe', [{ name: 'grainery-plugin.manifest.json', data: manifest() }, { name: '../dist/main.js', data: '' }], 'Unsafe archive path'],
    ['duplicate', [{ name: 'grainery-plugin.manifest.json', data: manifest() }, { name: 'dist/main.js', data: '' }, { name: 'dist/main.js', data: '' }], 'Duplicate normalized'],
    ['case', [{ name: 'grainery-plugin.manifest.json', data: manifest() }, { name: 'dist/main.js', data: '' }, { name: 'Dist/Main.js', data: '' }], 'Case-colliding'],
    ['symlink', [{ name: 'grainery-plugin.manifest.json', data: manifest() }, { name: 'dist/main.js', data: '', external: 0o120777 << 16 }], 'Symlink'],
    ['encrypted', [{ name: 'grainery-plugin.manifest.json', data: manifest() }, { name: 'dist/main.js', data: '', flags: 1 }], 'Unsafe archive path or malformed ZIP entry'],
    ['method', [{ name: 'grainery-plugin.manifest.json', data: manifest() }, { name: 'dist/main.js', data: '', method: 12 }], 'Unsupported compression'],
    ['drive', [{ name: 'grainery-plugin.manifest.json', data: manifest('com.example.plugin', '1.0.0', { entry: 'C:main.js' }) }, { name: 'C:main.js', data: '' }], 'Unsafe archive path'],
  ]) await rejects(t, { entries }, expected);
});

test('enforces archive identity, yanked metadata, and entry-count limits', async (t) => {
  await rejects(t, { archive: 'wrong.zip' }, 'archive is invalid');
  await rejects(t, { versionMeta: { yanked: 'no' } }, 'yanked must be boolean');
  const entries = [{ name: 'grainery-plugin.manifest.json', data: manifest() }, { name: 'dist/main.js', data: '' }];
  while (entries.length <= MAX_ARCHIVE_ENTRIES) entries.push({ name: `x${entries.length}.js`, data: '' });
  await rejects(t, { entries }, 'entry limit');
});

test('rejects an oversized archive without attempting to open it', async (t) => {
  const item = await fixture(t);
  await writeFile(item.archivePath, Buffer.alloc(MAX_ARCHIVE_BYTES + 1));
  await assert.rejects(
    loadAndValidateRegistry({ rootDir: item.root }),
    (error) => error.errors.some((value) => value.includes('compressed limit')),
  );
});

test('allows yanking but rejects changes to a published version', async (t) => {
  const item = await fixture(t);
  const git = (args) => execFileAsync('git', ['-C', item.root, ...args]);
  await git(['init', '--quiet']);
  await git(['config', 'user.email', 'test@example.com']);
  await git(['config', 'user.name', 'Registry Test']);
  await git(['add', '.']);
  await git(['commit', '--quiet', '-m', 'published']);

  const versionFile = path.join(item.versionDir, 'version.json');
  const yanked = JSON.parse(await readFile(versionFile, 'utf8'));
  yanked.yanked = true;
  await writeFile(versionFile, JSON.stringify(yanked));
  await loadAndValidateRegistry({ rootDir: item.root, baseRef: 'HEAD' });

  yanked.releaseNotes = 'Changed release notes.';
  await writeFile(versionFile, JSON.stringify(yanked));
  await assert.rejects(loadAndValidateRegistry({ rootDir: item.root, baseRef: 'HEAD' }), (error) => error.errors.some((value) => value.includes('only version.json yanked may change')));

  await rm(item.versionDir, { recursive: true });
  await assert.rejects(
    loadAndValidateRegistry({ rootDir: item.root, baseRef: 'HEAD' }),
    (error) => error.errors.some((value) => value.includes('published versions cannot be deleted')),
  );
});

test('builds an installable index whose signature covers the published archive', async (t) => {
  const item = await fixture(t);
  const output = path.join(item.root, 'output');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const projectRoot = path.resolve(import.meta.dirname, '..');

  await execFileAsync(
    process.execPath,
    ['scripts/build-registry.mjs', '--root', item.root, '--output', output],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        REGISTRY_SIGNING_KEY_ID: 'test-key',
        REGISTRY_SIGNING_PRIVATE_KEY: privatePem,
        SOURCE_DATE_EPOCH: '0',
      },
    },
  );

  const index = JSON.parse(await readFile(path.join(output, 'registry/v1/index.json'), 'utf8'));
  const [entry] = index.plugins;
  const published = await readFile(path.join(output, 'packages/com.example.plugin/1.0.0/com.example.plugin-1.0.0.grainery-plugin.zip'));
  assert.equal(index.generatedAt, '1970-01-01T00:00:00.000Z');
  assert.equal(entry.sha256, (await import('node:crypto')).createHash('sha256').update(published).digest('hex'));
  assert.equal(entry.signatureKeyId, 'test-key');
  assert.equal(verifySha256(entry.sha256, entry.signature, publicPem), true);
});
