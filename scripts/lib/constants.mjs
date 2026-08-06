export const ARCHIVE_EXTENSION = '.grainery-plugin.zip';
export const MANIFEST_FILE = 'grainery-plugin.manifest.json';
export const REQUIRED_PLUGIN_API_RANGE = '^1.2.0';

export const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
export const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 256;
export const MAX_MANIFEST_BYTES = 256 * 1024;

export const CORE_PERMISSIONS = new Set([
  'document:read',
  'document:write',
  'editor:commands',
  'export:register',
]);

export const OPTIONAL_PERMISSIONS = new Set([
  'fs:pick-read',
  'fs:pick-write',
  'network:https',
  'ui:mount',
  'editor:annotations',
  'system:fonts',
]);
