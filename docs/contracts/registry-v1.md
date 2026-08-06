# Registry v1 Contract

## Stable URLs

```text
Site:     https://plugins.grainery.xyz
Index:    https://plugins.grainery.xyz/registry/v1/index.json
Packages: https://plugins.grainery.xyz/packages/<id>/<version>/<id>-<version>.grainery-plugin.zip
```

All production URLs use HTTPS. Package paths are immutable.

## Index envelope

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-05T00:00:00.000Z",
  "plugins": []
}
```

The `plugins` array is compatible with Screenwrite's existing
`PluginRegistryEntry` type. Envelope fields other than `plugins` are ignored by
existing clients.

## Install entry

Each array item has these required fields:

```json
{
  "id": "com.example.scene-tools",
  "name": "Scene Tools",
  "version": "1.0.0",
  "description": "Utilities for working with scenes.",
  "manifest": {},
  "downloadUrl": "https://plugins.grainery.xyz/packages/com.example.scene-tools/1.0.0/com.example.scene-tools-1.0.0.grainery-plugin.zip",
  "sha256": "64 lowercase hexadecimal characters",
  "signatureKeyId": "registry-2026-01",
  "signature": "base64 Ed25519 signature"
}
```

Rules:

- `id` is 1-64 lowercase ASCII characters using only `a-z`, `0-9`, `.`, `_`,
  and `-`; the exact values `.` and `..` are forbidden.
- `id` and `version` exactly match the manifest inside the downloaded archive.
- `manifest` exactly matches the manifest inside the downloaded archive after
  JSON parsing; object key order is irrelevant.
- `downloadUrl` uses the immutable production package path.
- `sha256` is the lowercase SHA-256 digest of the final archive bytes.
- `signature` is an Ed25519 signature over the ASCII bytes of the lowercase
  `sha256` value, matching Screenwrite's existing verifier.
- `signatureKeyId` identifies a public key embedded in Grainery.
- Only approved, non-yanked versions appear in the install index.
- Entries are sorted by plugin ID and semantic version for deterministic output.

The archive's `manifest.signature` field is omitted in registry v1. It cannot
contain the final archive digest without becoming self-referential. Registry trust
comes from the detached index signature over the final archive digest.

## Catalog metadata

The public site may generate richer catalog data from the approved source files,
including:

- Publisher name and URL
- License
- Repository and homepage URLs
- Categories and tags
- Icon and screenshots
- README and release notes
- Publication date
- Yanked state and version history

This data must not replace or weaken the install entry. Technical identity,
permissions, engine compatibility, and contributions come from the package
manifest.

## Package requirements

- File name ends in `.grainery-plugin.zip`.
- Compressed size is at most 10 MiB.
- Total uncompressed size is at most 50 MiB.
- A single uncompressed file is at most 10 MiB.
- The archive contains at most 256 entries.
- The root manifest is at most 256 KiB.
- `grainery-plugin.manifest.json` exists at the archive root.
- The manifest entry file exists and is a JavaScript module.
- No absolute paths, parent traversal, backslash paths, duplicate normalized
  paths, case-colliding paths, symlinks, encrypted entries, or unsupported
  compression methods are allowed.
- Manifest schema, IDs, semantic versions, engine ranges, permissions,
  activation events, and contributions pass Grainery-compatible validation.
- A plugin ID and version pair is immutable after publication.

## Install-link contract

```text
grainery://plugins/<url-encoded-id>?version=<url-encoded-version>
```

The website always emits an exact version. Grainery may later accept a missing
version only after it can select the newest compatible version. Grainery:

1. Rejects malformed IDs, versions, hosts, paths, and unexpected parameters.
2. Ignores any externally supplied registry or download location.
3. Fetches the compiled official index URL.
4. Shows the selected plugin and requested permissions before installation.
5. Verifies the detached signature and archive hash.
6. Parses the downloaded archive manifest and compares it with the selected entry.
7. Extracts into a staging directory and replaces an installed version only after
   every check succeeds.
8. Installs only after every check succeeds.

## Cache behavior

- HTML and catalog JSON may use normal CDN revalidation.
- The registry index uses short revalidation so approvals and yanks propagate.
- Versioned package URLs use long-lived immutable caching.
