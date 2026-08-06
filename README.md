# Grainery Plugin Registry

The approved plugin catalog and public marketplace for Grainery.

- Public site: `https://plugins.grainery.xyz`
- Registry index: `https://plugins.grainery.xyz/registry/v1/index.json`
- Package format: `*.grainery-plugin.zip`

The service is deliberately static. Approved metadata is committed through GitHub
pull requests, CI validates and signs immutable package archives, and Astro
generates both the website and the registry index consumed by Grainery.

## Status

The registry contracts, publication pipeline, public catalog, and website-to-app
install flow are implemented. Production launch still requires signing-key setup,
deployment configuration, an approved initial plugin, and installed-app smoke tests.

## Local commands

```bash
npm install
npm test
npm run registry:validate
npm run build
```

Generating signed registry output additionally requires an Ed25519 key:

```bash
REGISTRY_SIGNING_KEY_ID=local-test \
REGISTRY_SIGNING_PRIVATE_KEY="<PKCS#8 PEM>" \
npm run registry:build
```

Production secret setup, publication, rotation, and rollback are documented in
[Registry operations](docs/operations.md).

See:

- [Architecture](docs/architecture.md)
- [Registry v1 contract](docs/contracts/registry-v1.md)
- [Security model](docs/security/threat-model.md)
