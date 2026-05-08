import crypto from 'node:crypto'
import type { LogPayload } from '@infinitetoken/lumber-kit'

const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex') // 12-byte X25519 SPKI prefix

/**
 * Encrypts a LogPayload using X25519 ECIES.
 * Wire format: base64(eph_pub[32] | IV[12] | AuthTag[16] | ciphertext).
 * recipientPubKeyB64 is the raw 32-byte X25519 public key, base64-encoded.
 */
export function encryptPayload(payload: LogPayload, recipientPubKeyB64: string): string {
  const recipientPubRaw = Buffer.from(recipientPubKeyB64, 'base64')
  if (recipientPubRaw.length !== 32) {
    throw new RangeError(
      `Invalid public key: expected 32 bytes after base64 decode, got ${recipientPubRaw.length}`,
    )
  }

  // Ephemeral X25519 key pair
  const eph = crypto.generateKeyPairSync('x25519')
  const ephPubRaw = (eph.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(12)

  // Reconstruct recipient public key as KeyObject for DH
  const recipientKeyObj = crypto.createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, recipientPubRaw]),
    format: 'der',
    type: 'spki',
  })

  // X25519 shared secret → HKDF-SHA256 → 32-byte AES key
  const sharedSecret = crypto.diffieHellman({ publicKey: recipientKeyObj, privateKey: eph.privateKey })
  const aesKey = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, '', 'lumber-v1', 32))

  // AES-256-GCM encrypt
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv)
  const plaintext = JSON.stringify(payload)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Wire format: eph_pub[32] | IV[12] | AuthTag[16] | ciphertext
  return Buffer.concat([ephPubRaw, iv, authTag, ct]).toString('base64')
}
