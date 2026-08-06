# Registry Operations

## Required GitHub configuration

Protect `main` and require the `Validate registry` check plus CODEOWNERS approval.
Protect the `production` environment and allow deployments only from `main`.

Configure these production environment values:

| Name | Kind | Value |
| --- | --- | --- |
| `REGISTRY_SIGNING_PRIVATE_KEY` | Secret | Unencrypted PKCS#8 PEM Ed25519 private key, including the `BEGIN PRIVATE KEY` and `END PRIVATE KEY` lines |
| `REGISTRY_SIGNING_KEY_ID` | Variable | Stable public identifier compiled into Grainery, such as `registry-2026-01` |
| `CLOUDFLARE_API_TOKEN` | Secret | Token limited to deploying this Worker/static assets project |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Cloudflare account containing `plugins.grainery.xyz` |

GitHub supports multiline secrets, so store the PEM exactly as Node exports it. The
generator also accepts a single-line value containing literal `\\n` separators for
local tooling. Never commit the production private key or expose it to pull request
workflows.

Generate a key offline with Node:

```sh
node --input-type=module -e "import {generateKeyPairSync} from 'node:crypto'; const k=generateKeyPairSync('ed25519'); const j=k.publicKey.export({format:'jwk'}); console.log(k.privateKey.export({type:'pkcs8',format:'pem'})); console.error(Buffer.from(j.x,'base64url').toString('base64'))"
```

The standard output is the GitHub private-key secret. The final standard-error line
is the Base64 raw 32-byte public key to retain for the Grainery application update.

## Publication

Pull requests run signing tests, validate the complete registry, generate outputs
with an ephemeral key that Grainery does not trust, and build the static site.
Production signing occurs only after merge to protected `main`, or by manually
dispatching the publish workflow from `main` through the protected `production`
environment.

The generator validates source records before reading or signing archives. It hashes
the exact ZIP bytes, signs the lowercase SHA-256 ASCII value with Ed25519, copies
packages and media into `public`, and writes deterministic `index.json` and
`catalog.json` files. `generatedAt` uses `SOURCE_DATE_EPOCH` when provided, then the
checked-out commit timestamp, and finally the Unix epoch outside Git.

Published package URLs are versioned and immutable. Reject any pull request that
changes archive bytes for an existing plugin ID/version. Yanking changes only
`version.json`; the version disappears from the install index while its package is
retained for audit and existing installations.

## Production release checklist

1. Generate the Ed25519 production key offline and store the private key only in the
   protected GitHub production environment.
2. Replace Grainery's placeholder registry public key with the generated raw public
   key and ship the desktop release before enabling website install links in production.
3. Configure the GitHub environment values above, protect `main`, and require the
   validation check plus CODEOWNERS approval.
4. Approve an initial plugin through the normal pull-request workflow; do not seed a
   package outside the review path.
5. Deploy to `plugins.grainery.xyz` and verify the index, catalog, package headers,
   immutable caching, and a deliberately invalid package request.
6. From installed macOS, Windows, and Linux builds, open a marketplace install link,
   confirm the permission prompt, install the plugin, restart Grainery, and verify the
   plugin remains enabled and its lock record is marked verified.
7. Exercise a tampered package fixture in staging and confirm installation is rejected
   without changing the previously installed plugin.

## Key rotation

1. Generate a new Ed25519 key offline and choose a new key ID.
2. Ship a Grainery release that trusts both the current and new public keys.
3. Replace the production secret and key-ID variable after that release is adopted.
4. Publish a registry update and verify installation with the new key.
5. Remove the old public key only in a later Grainery release.

If a private key is exposed, stop the production environment, remove the secret,
yank affected versions as needed, rotate the key, and publish a Grainery release
that removes trust in the compromised key. A registry yank does not revoke plugin
code already installed on user machines.

## Rollback and recovery

Static-site deployments can be rolled back through Cloudflare, but package bytes for
an already published ID/version must never be replaced. Correct metadata with a new
commit; correct plugin code with a new version. If publication fails before deploy,
no production state changes. If deploy fails partway, restore the previous complete
deployment and rerun the workflow after fixing the cause.
