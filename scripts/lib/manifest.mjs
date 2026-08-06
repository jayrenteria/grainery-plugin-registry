import semver from 'semver';

import { CORE_PERMISSIONS, OPTIONAL_PERMISSIONS, REQUIRED_PLUGIN_API_RANGE } from './constants.mjs';

const PLUGIN_ID = /^(?!\.{1,2}$)[a-z0-9._-]{1,64}$/;
const ACTIVATION_EVENT = /^(onStartup|on(?:Command|Exporter|Importer|UIControl|UIPanel|StatusBadge|InlineAnnotations):[A-Za-z0-9._-]+|onTransform:(?:post-open|pre-save|pre-export))$/;
const TOP_LEVEL_KEYS = new Set(['schemaVersion', 'id', 'name', 'version', 'description', 'engine', 'entry', 'permissions', 'optionalPermissions', 'networkAllowlist', 'activationEvents', 'contributes', 'enabledApiProposals', 'permissionRationales', 'signature']);
const CONTRIBUTION_ARRAYS = ['commands', 'menus', 'keybindings', 'exporters', 'importers', 'statusBadges', 'inlineAnnotationProviders', 'uiControls', 'uiPanels', 'transforms'];
const CONTRIBUTION_KEYS = new Set([...CONTRIBUTION_ARRAYS, 'configuration', 'editorCompletionProviders', 'editorLandmarkProviders']);
const LOCAL_ID = /^[A-Za-z0-9._-]{1,64}$/;
const MENU_LOCATIONS = new Set(['command-palette', 'main-menu', 'editor-context', 'toolbar-overflow']);
const UI_MOUNTS = new Set(['top-bar', 'bottom-bar', 'editor-floating']);
const UI_KINDS = new Set(['button', 'toggle', 'segmented']);
const DOCUMENT_HOOKS = new Set(['post-open', 'pre-save', 'pre-export']);
const CONFIGURATION_TYPES = new Set(['string', 'number', 'boolean', 'enum']);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function localId(value) {
  return typeof value === 'string' && LOCAL_ID.test(value) && !value.includes(':');
}

function contributionItems(contributes, key, errors) {
  const items = contributes[key];
  if (!Array.isArray(items)) return [];
  for (const item of items) if (!object(item)) errors.push(`contributes.${key} entries must be objects`);
  return items.filter(object);
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strings(value, name, allowed, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${name} must be an array`);
    return [];
  }
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || !item) errors.push(`${name} entries must be non-empty strings`);
    else if (seen.has(item)) errors.push(`${name} contains duplicate value '${item}'`);
    else if (allowed && !allowed.has(item)) errors.push(`Unknown ${name.slice(0, -1)}: ${item}`);
    seen.add(item);
  }
  return value;
}

export function validateManifest(manifest) {
  const errors = [];
  if (!object(manifest)) return { errors: ['Manifest must be a JSON object'] };

  if (manifest.signature !== undefined) errors.push('manifest.signature must be absent; registry v1 uses a detached signature');
  for (const key of Object.keys(manifest)) if (!TOP_LEVEL_KEYS.has(key)) errors.push(`manifest contains unknown property '${key}'`);
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
  if (typeof manifest.id !== 'string' || !PLUGIN_ID.test(manifest.id)) errors.push('id must be a canonical lowercase plugin ID using only a-z, 0-9, dot, underscore, and hyphen (maximum 64 characters; not . or ..)');
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) errors.push('name is required');
  if (typeof manifest.version !== 'string' || !semver.valid(manifest.version)) errors.push('version must be a semantic version');
  if (typeof manifest.description !== 'string' || !manifest.description.trim()) errors.push('description is required');

  if (!object(manifest.engine)) {
    errors.push('engine must be an object');
  } else {
    for (const key of Object.keys(manifest.engine)) if (!['grainery', 'pluginApi'].includes(key)) errors.push(`engine contains unknown property '${key}'`);
    if (typeof manifest.engine.grainery !== 'string' || !semver.validRange(manifest.engine.grainery) || manifest.engine.grainery.includes('||') || manifest.engine.grainery.includes(' - ')) errors.push('engine.grainery must be a Grainery-compatible semantic-version range');
    if (manifest.engine.pluginApi !== REQUIRED_PLUGIN_API_RANGE) errors.push(`engine.pluginApi must be exactly ${REQUIRED_PLUGIN_API_RANGE}`);
  }

  if (typeof manifest.entry !== 'string' || !manifest.entry.endsWith('.js') || manifest.entry.startsWith('/') || manifest.entry.includes('\\') || manifest.entry.split('/').includes('..')) {
    errors.push('entry must be a relative JavaScript module path without traversal');
  }

  const optionalPermissions = strings(manifest.optionalPermissions, 'optionalPermissions', OPTIONAL_PERMISSIONS, errors);
  strings(manifest.permissions, 'permissions', CORE_PERMISSIONS, errors);
  const networkAllowlist = strings(manifest.networkAllowlist, 'networkAllowlist', null, errors);
  if (networkAllowlist.length && !optionalPermissions.includes('network:https')) errors.push('networkAllowlist requires optionalPermissions to include network:https');

  if (!Array.isArray(manifest.activationEvents) || !manifest.activationEvents.length) {
    errors.push('activationEvents must contain at least one event');
  } else {
    const events = new Set();
    for (const event of manifest.activationEvents) {
      if (typeof event !== 'string' || !ACTIVATION_EVENT.test(event)) errors.push(`Invalid activation event: ${String(event)}`);
      else if (events.has(event)) errors.push(`activationEvents contains duplicate value '${event}'`);
      events.add(event);
    }
  }
  if (!object(manifest.contributes)) {
    errors.push('contributes must be an object');
  } else {
    for (const key of Object.keys(manifest.contributes)) if (!CONTRIBUTION_KEYS.has(key)) errors.push(`contributes contains unknown property '${key}'`);
    for (const key of CONTRIBUTION_ARRAYS) {
      if (!Array.isArray(manifest.contributes[key])) errors.push(`contributes.${key} must be an array`);
    }
    for (const key of ['editorCompletionProviders', 'editorLandmarkProviders']) {
      if (manifest.contributes[key] !== undefined && !Array.isArray(manifest.contributes[key])) errors.push(`contributes.${key} must be an array`);
    }

    const commands = contributionItems(manifest.contributes, 'commands', errors);
    const commandIds = new Set(commands.map((item) => item.id));
    for (const item of commands) {
      if (!localId(item.id)) errors.push('contributes.commands id is invalid');
      if (!nonEmpty(item.title)) errors.push(`contributes.commands '${String(item.id)}' title is required`);
    }
    for (const item of contributionItems(manifest.contributes, 'menus', errors)) {
      if (!localId(item.id) || !localId(item.command)) errors.push('contributes.menus id and command are required');
      if (!commandIds.has(item.command)) errors.push(`contributes.menus references missing command '${String(item.command)}'`);
      if (!MENU_LOCATIONS.has(item.location)) errors.push(`contributes.menus '${String(item.id)}' has invalid location`);
    }
    for (const item of contributionItems(manifest.contributes, 'keybindings', errors)) {
      if (!localId(item.id) || !localId(item.command) || !nonEmpty(item.key)) errors.push('contributes.keybindings requires valid id, command, and key');
      if (!commandIds.has(item.command)) errors.push(`contributes.keybindings references missing command '${String(item.command)}'`);
    }
    for (const item of contributionItems(manifest.contributes, 'exporters', errors)) {
      if (!localId(item.id) || !nonEmpty(item.title) || !nonEmpty(item.extension)) errors.push('contributes.exporters requires valid id, title, and extension');
    }
    for (const item of contributionItems(manifest.contributes, 'importers', errors)) {
      if (!localId(item.id) || !nonEmpty(item.title) || !Array.isArray(item.extensions) || !item.extensions.length) errors.push('contributes.importers requires valid id, title, and extensions');
    }
    for (const item of contributionItems(manifest.contributes, 'statusBadges', errors)) {
      if (!localId(item.id) || !nonEmpty(item.label)) errors.push('contributes.statusBadges requires valid id and label');
    }
    for (const key of ['inlineAnnotationProviders', 'editorCompletionProviders', 'editorLandmarkProviders']) {
      for (const item of contributionItems(manifest.contributes, key, errors)) if (!localId(item.id)) errors.push(`contributes.${key} id is invalid`);
    }
    for (const item of contributionItems(manifest.contributes, 'uiControls', errors)) {
      if (!localId(item.id) || !UI_MOUNTS.has(item.mount) || !UI_KINDS.has(item.kind) || !nonEmpty(item.label) || !nonEmpty(item.icon)) errors.push('contributes.uiControls requires valid id, mount, kind, label, and icon');
    }
    for (const item of contributionItems(manifest.contributes, 'uiPanels', errors)) {
      if (!localId(item.id) || !nonEmpty(item.title)) errors.push('contributes.uiPanels requires valid id and title');
    }
    for (const item of contributionItems(manifest.contributes, 'transforms', errors)) {
      if (!localId(item.id) || !DOCUMENT_HOOKS.has(item.hook)) errors.push('contributes.transforms requires valid id and hook');
    }
    if (manifest.contributes.configuration !== undefined) {
      const configuration = manifest.contributes.configuration;
      if (!object(configuration) || !Array.isArray(configuration.properties)) errors.push('contributes.configuration.properties must be an array');
      else for (const item of configuration.properties) {
        if (!object(item) || !localId(item.id) || !nonEmpty(item.title) || !CONFIGURATION_TYPES.has(item.type)) errors.push('contributes.configuration.properties entries require valid id, title, and type');
        else if (item.type === 'enum' && (!Array.isArray(item.enum) || !item.enum.length)) errors.push(`configuration enum '${item.id}' must include values`);
      }
    }
    if ((manifest.contributes.editorCompletionProviders?.length || manifest.contributes.editorLandmarkProviders?.length) && !manifest.activationEvents?.includes('onStartup')) errors.push('Editor completion and landmark providers require activationEvents to include onStartup');
  }

  return { errors };
}
