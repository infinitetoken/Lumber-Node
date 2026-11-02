import crypto from 'node:crypto'

/** AES-256-GCM over a UTF-8 plaintext with the given nonce (12 bytes): the 16-byte auth tag, then the ciphertext. */
export function seal(plaintext: string, key: Buffer, nonce: Buffer): Buffer {
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([cipher.getAuthTag(), ct])
}

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
  return Buffer.concat([iv, seal(JSON.stringify(data), key, iv)]).toString('base64')
}
