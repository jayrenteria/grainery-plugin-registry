# Architecture

## Scope

The first release provides:

1. A public plugin catalog at `plugins.grainery.xyz`.
2. An approved, machine-readable registry index.
3. Immutable, signed plugin packages.
4. GitHub pull request submission and admin approval.
5. A website link that opens Grainery and requests installation of an exact plugin
   version.

A full plugin browser inside Grainery is intentionally deferred. The registry API
is designed so that browser can be added later without changing the publication
format.

## Components

### Static Astro site

The marketplace is generated from approved registry metadata and deployed as
static assets to Cloudflare. It does not require a database, Worker, account
system, or server-rendered application.

### Registry index

`/registry/v1/index.json` contains every approved, installable plugin version.
Grainery already accepts the `{ "plugins": [...] }` envelope used by this file.
Yanked versions are omitted from this install index but retained in source history.

### Package storage

Published archives use immutable, versioned paths:

```text
/packages/<plugin-id>/<version>/<plugin-id>-<version>.grainery-plugin.zip
```

The same plugin ID and version may never be published with different bytes.
For the initial release these are static Cloudflare assets deployed with the site.
Move them to R2 only when repository or asset volume requires independent object
storage.

### Submission and approval

Authors submit metadata, media, and a packaged archive in a GitHub pull request.
Automated checks validate the submission. An admin approves it by merging to the
protected production branch. The publish workflow signs and deploys only merged,
approved content.

Initial archives are capped at 10 MiB compressed. This keeps GitHub pull requests
practical; move pending binaries to an upload service only when real submission
volume makes that necessary.

### Website-to-app installation

Plugin pages expose this primary action:

```text
grainery://plugins/<plugin-id>?version=<exact-version>
```

The link carries only a validated plugin ID and exact version. It never carries a
registry URL, download URL, hash, signature, or permission list.

Grainery uses its compiled official registry URL, fetches the matching entry,
shows the plugin identity and permissions for confirmation, and invokes its
existing verified registry installer. Installation is never silent.

Grainery binds the downloaded archive manifest to the selected registry entry,
enforces package and network limits, and uses recoverable staged replacement for
updates. The production public key must replace the placeholder key before launch.

The website also exposes a direct package download as a secondary fallback. A
manually installed package remains a sideload and is shown as unverified unless
Grainery independently matches it to the official registry.

## Delivery order

1. Freeze and test package, index, signature, and install-link contracts.
2. Create the static Astro registry and deterministic index generator.
3. Add submission validation, signing, immutable publication, and approval CI.
4. Build the public catalog and plugin detail pages.
5. Harden the verified installer and add the narrow install-link handler to Grainery.
6. Run end-to-end security and release checks.
7. Add a full in-app plugin browser after launch.

## Deferred until justified

- User accounts and web uploads
- Database-backed search
- Ratings, comments, and reviews
- Payments
- Download analytics
- Automatic plugin updates
- Full in-app marketplace browsing
