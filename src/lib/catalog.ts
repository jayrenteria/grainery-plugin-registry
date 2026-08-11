import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type Plugin = {
	id: string;
	name: string;
	version: string;
	description: string;
	manifest?: {
		permissions?: string[];
		optionalPermissions?: string[];
		permissionRationales?: Record<string, string>;
		engine?: { grainery?: string; pluginApi?: string };
	};
	publisher?: { name?: string; url?: string };
	categories?: string[];
	tags?: string[];
	license?: string;
	repositoryUrl?: string;
	homepageUrl?: string;
	icon?: string;
	screenshots?: Array<{ url: string; alt: string }>;
	releaseNotes?: string;
	publishedAt?: string;
	downloadUrl?: string;
	versions?: Array<{
		version: string;
		releaseNotes?: string;
		publishedAt?: string;
		yanked: boolean;
		downloadUrl?: string;
	}>;
};

type Catalog = { plugins?: unknown };

const catalogPath = path.resolve('public/registry/v1/catalog.json');

function isPlugin(value: unknown): value is Plugin {
	if (!value || typeof value !== 'object') return false;
	const plugin = value as Record<string, unknown>;
	return ['id', 'name', 'version', 'description'].every((key) => typeof plugin[key] === 'string');
}

export async function getPlugins(): Promise<Plugin[]> {
	try {
		const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as Catalog;
		return Array.isArray(catalog.plugins)
			? catalog.plugins.filter(isPlugin).sort((a, b) => a.name.localeCompare(b.name))
			: [];
	} catch {
		return [];
	}
}

export function pluginUrl(id: string): string {
	return `/plugins/${encodeURIComponent(id)}/`;
}

export function installUrl(plugin: Plugin): string {
	return `grainery://plugins/${encodeURIComponent(plugin.id)}?version=${encodeURIComponent(plugin.version)}`;
}

export function packageUrl(plugin: Plugin): string {
	return plugin.downloadUrl ?? `/packages/${encodeURIComponent(plugin.id)}/${encodeURIComponent(plugin.version)}/${encodeURIComponent(plugin.id)}-${encodeURIComponent(plugin.version)}.grainery-plugin.zip`;
}

const permissionDetails: Record<string, { label: string; description: string }> = {
	'document:read': { label: 'Read the current document', description: 'Lets the plugin inspect the open document.' },
	'document:write': { label: 'Change the current document', description: 'Lets the plugin make changes through Grainery.' },
	'editor:commands': { label: 'Add editor commands', description: 'Lets the plugin register commands in Grainery.' },
	'export:register': { label: 'Register export formats', description: 'Lets the plugin add supported export formats.' },
	'fs:pick-read': { label: 'Open selected files', description: 'Lets the plugin read files you choose.' },
	'fs:pick-write': { label: 'Save selected files', description: 'Lets the plugin write files where you choose.' },
	'network:https': { label: 'Use secure network access', description: 'Lets the plugin connect to its declared HTTPS services.' },
	'ui:mount': { label: 'Add Grainery interface controls', description: 'Lets the plugin add host-rendered panels and controls.' },
	'editor:annotations': { label: 'Show editor annotations', description: 'Lets the plugin display annotations in the editor.' },
	'system:fonts': { label: 'List installed font names', description: 'Lets the plugin read font family and variant names.' },
};

export function permissionDetail(permission: string) {
	return permissionDetails[permission] ?? { label: permission, description: 'Declared by this plugin.' };
}

export function formatDate(value?: string): string | undefined {
	if (!value) return undefined;
	const date = new Date(value);
	return Number.isNaN(date.valueOf()) ? undefined : date.toLocaleDateString('en-US', {
		year: 'numeric', month: 'short', day: 'numeric',
	});
}
