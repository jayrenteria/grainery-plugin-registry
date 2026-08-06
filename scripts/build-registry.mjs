#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { loadEd25519PrivateKey, sha256, signSha256 } from './lib/signing.mjs';

const SITE_URL = 'https://plugins.grainery.xyz';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..');

function parseArgs(argv) {
	const options = { rootDir: DEFAULT_ROOT, outputDir: undefined, baseRef: undefined };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		const value = argv[index + 1];
		if (!['--root', '--output', '--base-ref'].includes(argument) || !value) {
			throw new Error(`Usage: build-registry.mjs [--root DIR] [--output DIR] [--base-ref REF]`);
		}
		if (argument === '--root') options.rootDir = path.resolve(value);
		if (argument === '--output') options.outputDir = path.resolve(value);
		if (argument === '--base-ref') options.baseRef = value;
		index += 1;
	}
	options.outputDir ??= path.join(options.rootDir, 'public');
	return options;
}

function generatedAt(rootDir) {
	const epoch = process.env.SOURCE_DATE_EPOCH;
	if (epoch && /^\d+$/.test(epoch)) return new Date(Number(epoch) * 1000).toISOString();
	try {
		const timestamp = execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], {
			cwd: rootDir,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
		if (/^\d+$/.test(timestamp)) return new Date(Number(timestamp) * 1000).toISOString();
	} catch {
		// A source timestamp is optional outside a Git checkout.
	}
	return new Date(0).toISOString();
}

function json(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function assertPathInside(parent, child, label) {
	const relative = path.relative(path.resolve(parent), path.resolve(child));
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(`${label} resolves outside its approved directory`);
	}
}

async function copyMedia(record, outputDir) {
	const { id, icon, readme, screenshots = [] } = record.pluginMetadata;
	const mediaRoot = path.join(outputDir, 'media', id);
	const result = {};

	for (const [field, relativePath] of [['icon', icon], ['readmeUrl', readme]]) {
		if (!relativePath) continue;
		const source = path.resolve(record.pluginDir, relativePath);
		assertPathInside(record.pluginDir, source, field);
		const destination = path.join(mediaRoot, relativePath);
		await mkdir(path.dirname(destination), { recursive: true });
		await copyFile(source, destination);
		result[field] = `/media/${id}/${relativePath.split(path.sep).join('/')}`;
	}

	result.screenshots = [];
	for (const screenshot of screenshots) {
		const source = path.resolve(record.pluginDir, screenshot.path);
		assertPathInside(record.pluginDir, source, 'Screenshot');
		const destination = path.join(mediaRoot, screenshot.path);
		await mkdir(path.dirname(destination), { recursive: true });
		await copyFile(source, destination);
		result.screenshots.push({ url: `/media/${id}/${screenshot.path.split(path.sep).join('/')}`, alt: screenshot.alt });
	}

	return result;
}

function versionSort(left, right) {
	return left.pluginMetadata.id.localeCompare(right.pluginMetadata.id)
		|| semver.compare(left.versionMetadata.version, right.versionMetadata.version);
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const privateKeyPem = process.env.REGISTRY_SIGNING_PRIVATE_KEY;
	const signatureKeyId = process.env.REGISTRY_SIGNING_KEY_ID;
	if (!privateKeyPem || !signatureKeyId) {
		throw new Error('REGISTRY_SIGNING_PRIVATE_KEY and REGISTRY_SIGNING_KEY_ID are required');
	}
	const privateKey = loadEd25519PrivateKey(privateKeyPem);

	let loadAndValidateRegistry;
	try {
		({ loadAndValidateRegistry } = await import('./lib/registry.mjs'));
	} catch (error) {
		if (error?.code === 'ERR_MODULE_NOT_FOUND') {
			throw new Error('scripts/lib/registry.mjs is required before registry generation can run');
		}
		throw error;
	}
	if (typeof loadAndValidateRegistry !== 'function') {
		throw new TypeError('scripts/lib/registry.mjs must export loadAndValidateRegistry(options)');
	}

	const records = (await loadAndValidateRegistry({ rootDir: options.rootDir, baseRef: options.baseRef })).sort(versionSort);
	const timestamp = generatedAt(options.rootDir);
	const built = [];

	for (const record of records) {
		const { pluginMetadata, versionMetadata, manifest, archivePath } = record;
		if (manifest.signature !== undefined) throw new Error(`${manifest.id}@${manifest.version}: manifest.signature is not allowed`);
		const archiveBytes = await readFile(archivePath);
		const digest = sha256(archiveBytes);
		const packageName = `${manifest.id}-${manifest.version}.grainery-plugin.zip`;
		const relativePackagePath = `packages/${manifest.id}/${manifest.version}/${packageName}`;
		const packageDestination = path.join(options.outputDir, ...relativePackagePath.split('/'));
		built.push({
			record,
			archiveBytes,
			digest,
			signature: signSha256(digest, privateKey),
			downloadUrl: `${SITE_URL}/${relativePackagePath}`,
			packageDestination,
		});
	}

	for (const directory of ['registry/v1', 'packages', 'media']) {
		await rm(path.join(options.outputDir, directory), { recursive: true, force: true });
	}

	for (const item of built) {
		await mkdir(path.dirname(item.packageDestination), { recursive: true });
		await writeFile(item.packageDestination, item.archiveBytes);
	}

	const installEntries = built
		.filter(({ record }) => !record.versionMetadata.yanked)
		.map(({ record, digest, signature, downloadUrl }) => ({
			id: record.manifest.id,
			name: record.manifest.name,
			version: record.manifest.version,
			description: record.manifest.description,
			manifest: record.manifest,
			downloadUrl,
			sha256: digest,
			signatureKeyId,
			signature,
		}));

	const byPlugin = Map.groupBy(built, ({ record }) => record.pluginMetadata.id);
	const catalogPlugins = [];
	for (const versions of byPlugin.values()) {
		const installable = versions.filter(({ record }) => !record.versionMetadata.yanked);
		if (installable.length === 0) continue;
		const latest = installable.at(-1);
		const { record, downloadUrl } = latest;
		const media = await copyMedia(record, options.outputDir);
		const { schemaVersion: _pluginSchema, id: _pluginId, ...catalogMetadata } = record.pluginMetadata;
		catalogPlugins.push({
			id: record.manifest.id,
			name: record.manifest.name,
			version: record.manifest.version,
			description: record.manifest.description,
			manifest: record.manifest,
			...catalogMetadata,
			...media,
			releaseNotes: record.versionMetadata.releaseNotes,
			publishedAt: record.versionMetadata.publishedAt,
			downloadUrl,
			versions: versions.toReversed().map((item) => ({
				version: item.record.versionMetadata.version,
				releaseNotes: item.record.versionMetadata.releaseNotes,
				publishedAt: item.record.versionMetadata.publishedAt,
				yanked: item.record.versionMetadata.yanked,
				...(item.record.versionMetadata.yanked ? {} : { downloadUrl: item.downloadUrl }),
			})),
		});
	}
	catalogPlugins.sort((left, right) => left.id.localeCompare(right.id));

	const registryDirectory = path.join(options.outputDir, 'registry', 'v1');
	await mkdir(registryDirectory, { recursive: true });
	await Promise.all([
		writeFile(path.join(registryDirectory, 'index.json'), json({ schemaVersion: 1, generatedAt: timestamp, plugins: installEntries })),
		writeFile(path.join(registryDirectory, 'catalog.json'), json({ schemaVersion: 1, generatedAt: timestamp, plugins: catalogPlugins })),
	]);

	process.stdout.write(`Built ${installEntries.length} installable version(s) for ${catalogPlugins.length} plugin(s) in ${options.outputDir}\n`);
}

await main();
