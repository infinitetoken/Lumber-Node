import crypto from 'node:crypto'

/**
 * Encrypts arbitrary data with AES-256-GCM using a 32-byte symmetric key.
 * Wire format: base64(IV[12] | AuthTag[16] | ciphertext).
 * keyBase64 must decode to exactly 32 bytes.
 */
export function encryptPayload(data: object, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64')
  if (key.length !== 32) {
    throw new RangeError(`Invalid key: expected 32 bytes after base64 decode, got ${key.length}`)
  }

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const plaintext = JSON.stringify(data)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([iv, authTag, ct]).toString('base64')
}
