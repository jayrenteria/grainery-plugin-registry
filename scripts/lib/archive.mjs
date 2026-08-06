import { stat } from 'node:fs/promises';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import yauzl from 'yauzl';

import {
  MANIFEST_FILE,
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_ENTRIES,
  MAX_FILE_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_UNCOMPRESSED_BYTES,
} from './constants.mjs';
import { validateManifest } from './manifest.mjs';

function normalizedName(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) return null;
  const normalized = path.posix.normalize(name);
  return normalized === '.' || normalized.startsWith('../') || normalized !== name ? null : normalized;
}

function symlink(entry) {
  return ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000;
}

async function readEntry(zip, entry, limit) {
  const stream = await zip.openReadStreamPromise(entry);
  const parts = [];
  let bytes = 0;
  stream.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > limit) stream.destroy(new Error(`${entry.fileName} exceeds its permitted size`));
    else parts.push(chunk);
  });
  await finished(stream);
  return Buffer.concat(parts);
}

export async function inspectArchive(archivePath) {
  const errors = [];
  let archiveStats;
  try {
    archiveStats = await stat(archivePath);
  } catch {
    return { errors: [`Archive not found: ${archivePath}`] };
  }
  if (!archiveStats.isFile()) return { errors: [`Archive is not a regular file: ${archivePath}`] };
  if (archiveStats.size > MAX_ARCHIVE_BYTES) errors.push(`Archive exceeds ${MAX_ARCHIVE_BYTES} byte compressed limit`);
  if (errors.length) return { errors };

  let zip;
  try {
    zip = await yauzl.openPromise(archivePath, { autoClose: false, strictFileNames: true, validateEntrySizes: true });
  } catch (error) {
    return { errors: [`Invalid ZIP archive: ${error.message}`] };
  }

  const entries = [];
  let totalBytes = 0;
  const names = new Set();
  const caseNames = new Set();
  try {
    for await (const entry of zip.eachEntry()) {
      entries.push(entry);
      if (entries.length > MAX_ARCHIVE_ENTRIES) {
        errors.push(`Archive exceeds ${MAX_ARCHIVE_ENTRIES} entry limit`);
        break;
      }
      const name = normalizedName(entry.fileName);
      if (!name) errors.push(`Unsafe archive path: ${entry.fileName}`);
      else {
        if (names.has(name)) errors.push(`Duplicate normalized archive path: ${name}`);
        if (caseNames.has(name.toLowerCase())) errors.push(`Case-colliding archive path: ${name}`);
        names.add(name);
        caseNames.add(name.toLowerCase());
      }
      if (entry.isEncrypted() || (entry.generalPurposeBitFlag & 0x40)) errors.push(`Encrypted archive entry: ${entry.fileName}`);
      if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) errors.push(`Unsupported compression method for ${entry.fileName}`);
      if (symlink(entry)) errors.push(`Symlink archive entry: ${entry.fileName}`);
      if (entry.uncompressedSize > MAX_FILE_BYTES) errors.push(`Archive entry exceeds ${MAX_FILE_BYTES} byte limit: ${entry.fileName}`);
      totalBytes += entry.uncompressedSize;
    }
  } catch (error) {
    errors.push(`Unsafe archive path or malformed ZIP entry: ${error.message}`);
  }
  if (totalBytes > MAX_UNCOMPRESSED_BYTES) errors.push(`Archive exceeds ${MAX_UNCOMPRESSED_BYTES} byte uncompressed limit`);

  const manifestEntries = entries.filter((entry) => entry.fileName === MANIFEST_FILE);
  if (!manifestEntries.length) errors.push(`Archive is missing root ${MANIFEST_FILE}`);
  if (manifestEntries.length > 1) errors.push(`Archive contains duplicate root ${MANIFEST_FILE}`);
  if (manifestEntries[0]?.uncompressedSize > MAX_MANIFEST_BYTES) errors.push(`Manifest exceeds ${MAX_MANIFEST_BYTES} byte limit`);
  if (errors.length) {
    zip.close();
    return { errors };
  }

  let manifest;
  try {
    manifest = JSON.parse((await readEntry(zip, manifestEntries[0], MAX_MANIFEST_BYTES)).toString('utf8'));
  } catch (error) {
    zip.close();
    return { errors: [`Failed to parse archive manifest: ${error.message}`] };
  }
  errors.push(...validateManifest(manifest).errors);
  if (typeof manifest.entry === 'string' && normalizedName(manifest.entry) !== manifest.entry) errors.push(`Manifest entry path is not normalized: ${manifest.entry}`);
  else if (typeof manifest.entry === 'string' && !names.has(manifest.entry)) errors.push(`Archive is missing manifest entry file: ${manifest.entry}`);

  try {
    for (const entry of entries) {
      if (!entry.fileName.endsWith('/')) await readEntry(zip, entry, MAX_FILE_BYTES);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(message.includes('encrypted') ? `Encrypted archive entry: ${message}` : `Failed to read archive entry: ${message}`);
  } finally {
    zip.close();
  }
  return { errors, manifest };
}
