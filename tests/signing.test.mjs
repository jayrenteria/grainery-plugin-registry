import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { loadEd25519PrivateKey, loadEd25519PublicKey, sha256, signSha256, verifySha256 } from '../scripts/lib/signing.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });

test('signs the lowercase SHA-256 ASCII payload Screenwrite verifies', () => {
	const digest = sha256(Buffer.from('approved archive bytes'));
	const signature = signSha256(digest, loadEd25519PrivateKey(privatePem));

	assert.equal(verifySha256(digest, signature, loadEd25519PublicKey(publicPem)), true);
	assert.equal(signature, signSha256(digest, privatePem), 'Ed25519 signatures should be deterministic');
});

test('rejects tampered digests and signatures', () => {
	const digest = sha256(Buffer.from('approved archive bytes'));
	const signature = signSha256(digest, privatePem);
	const tamperedDigest = sha256(Buffer.from('tampered archive bytes'));
	const tamperedSignature = Buffer.from(signature, 'base64');
	tamperedSignature[0] ^= 0xff;

	assert.equal(verifySha256(tamperedDigest, signature, publicPem), false);
	assert.equal(verifySha256(digest, tamperedSignature.toString('base64'), publicPem), false);
});

test('rejects malformed digests and non-Ed25519 keys', () => {
	assert.throws(() => signSha256('ABC', privatePem), /64 lowercase hexadecimal/);
	const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
	assert.throws(() => loadEd25519PrivateKey(rsa), /Ed25519/);
});
