#!/usr/bin/env node
import { loadAndValidateRegistry } from './lib/registry.mjs';

const baseIndex = process.argv.indexOf('--base-ref');
const baseRef = baseIndex === -1 ? undefined : process.argv[baseIndex + 1];
if (baseIndex !== -1 && !baseRef) {
  console.error('--base-ref requires a Git revision');
  process.exitCode = 2;
} else {
  loadAndValidateRegistry({ rootDir: process.cwd(), baseRef })
    .then((records) => console.log(`Registry validation passed: ${records.length} version${records.length === 1 ? '' : 's'}.`))
    .catch((error) => {
      console.error(error.message);
      for (const detail of error.errors ?? [error.message]) console.error(`- ${detail}`);
      process.exitCode = 1;
    });
}
