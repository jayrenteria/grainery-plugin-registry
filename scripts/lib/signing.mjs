import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function assertSha256(digest) {
	if (!SHA256_PATTERN.test(digest)) {
		throw new TypeError('SHA-256 digest must be 64 lowercase hexadecimal characters');
	}
}

function normalizePem(value, label) {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new TypeError(`${label} must be a non-empty PEM string`);
	}

	return value.includes('\\n') ? value.replaceAll('\\n', '\n') : value;
}

export function loadEd25519PrivateKey(pem) {
	const key = createPrivateKey(normalizePem(pem, 'Private key'));
	if (key.asymmetricKeyType !== 'ed25519') {
		throw new TypeError('Signing key must be an Ed25519 private key');
	}
	return key;
}

export function loadEd25519PublicKey(pem) {
	const key = createPublicKey(normalizePem(pem, 'Public key'));
	if (key.asymmetricKeyType !== 'ed25519') {
		throw new TypeError('Verification key must be an Ed25519 public key');
	}
	return key;
}

export function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

export async function sha256File(filePath) {
	return sha256(await readFile(filePath));
}

export function signSha256(digest, privateKey) {
	assertSha256(digest);
	const key = typeof privateKey === 'string' ? loadEd25519PrivateKey(privateKey) : privateKey;
	if (key?.asymmetricKeyType !== 'ed25519' || key.type !== 'private') {
		throw new TypeError('Signing key must be an Ed25519 private key');
	}
	return sign(null, Buffer.from(digest, 'ascii'), key).toString('base64');
}

export function verifySha256(digest, signature, publicKey) {
	assertSha256(digest);
	const key = typeof publicKey === 'string' ? loadEd25519PublicKey(publicKey) : publicKey;
	if (key?.asymmetricKeyType !== 'ed25519' || key.type !== 'public') {
		throw new TypeError('Verification key must be an Ed25519 public key');
	}

	let signatureBytes;
	try {
		signatureBytes = Buffer.from(signature, 'base64');
	} catch {
		return false;
	}
	return signatureBytes.length === 64 && verify(null, Buffer.from(digest, 'ascii'), key, signatureBytes);
}
