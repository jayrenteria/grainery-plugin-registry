# Security Model

## Trust boundary

Admin approval means the registry has reviewed a specific archive digest. The
Ed25519 signature proves that digest was approved; SHA-256 proves the downloaded
archive is the approved byte sequence. Runtime permissions and worker isolation
remain responsible for limiting what approved plugin code can do.

## Required controls

| Threat | Control |
| --- | --- |
| Package replaced after approval | Immutable version path plus signed SHA-256 digest |
| Registry index points to altered bytes | Grainery recomputes and compares SHA-256 |
| Index displays one plugin but downloads another signed plugin | Grainery compares the archive manifest with the selected registry entry |
| Crafted install link selects an attacker registry | Deep link contains only ID/version; Grainery compiles the official registry URL |
| Path traversal during extraction | CI rejects unsafe paths; Grainery retains `enclosed_name` extraction checks |
| ZIP bomb or oversized submission | CI caps compressed bytes, uncompressed bytes, and entry count |
| Failed update removes the working plugin | Extract and validate in staging, preserve a recovery backup, then activate the replacement |
| Unknown or excessive permissions | Schema validation, admin review, and user confirmation |
| Compromised signing key | Offline/restricted secret, key IDs, embedded multiple public keys during rotation, emergency yank/release procedure |
| Published version silently changed | Publish fails when an existing ID/version has a different digest |
| Malicious contributor changes publishing workflow | CODEOWNERS and protected-branch review for workflows, schemas, and signing scripts |
| Silent web-triggered installation | Native confirmation is mandatory before installation |

## Implementation status

Screenwrite now compares the registry manifest with the manifest inside the signed
archive, validates archive structure and size before extraction, bounds registry and
package downloads, restricts official package URLs, and uses staged installation
with persistent recovery backups. Website install links can select only an exact ID
and version from the compiled official registry URL, and installation requires a
native confirmation.

Screenwrite embeds the production registry public key and verifies it against a known
signature fixture. Platform-installed deep-link handling must still be smoke-tested
on every supported desktop operating system before release.

## Key handling

- The private Ed25519 key exists only in the protected publication environment.
- The production public key replaces Screenwrite's placeholder before launch.
- Pull request workflows never receive the production signing key.
- Logs contain key IDs, hashes, and signatures, never private key material.
- Grainery embeds public keys by stable key ID.
- Rotation ships a Grainery release containing both old and new public keys before
  publication switches to the new key.
- Removing a compromised key requires an application release and registry incident
  procedure; yanking alone does not invalidate already installed code.

## Registry freshness

Registry v1 trusts HTTPS and the Cloudflare deployment for the current install index.
Package signatures prove that specific bytes were approved, but the index envelope is
not signed and therefore does not provide cryptographic yank or freshness guarantees
if the CDN itself is compromised or serves a replay. A future signed, expiring index
is required before treating CDN replay as part of the v1 threat model.

## Review boundary

Automated validation proves package structure and contract compliance, not that
plugin behavior is benevolent. Admin review must inspect provenance, source or
reproducibility evidence, requested permissions, network destinations, licensing,
and user-facing behavior before approval.

## Minimum security fixtures

- Valid approved archive and signature
- Tampered archive with the original digest/signature
- Unknown signing key
- Invalid base64 and incorrect signature length
- Entry manifest/archive manifest mismatch
- ID and version mismatch
- Parent traversal and absolute archive paths
- Duplicate archive path
- Missing root manifest or missing entry module
- Too many files, excessive uncompressed size, and high compression ratio
- Unknown permission and incompatible plugin API range
- Re-publication of an existing ID/version with different bytes
- Yanked version absent from the install index
