import { createCipheriv, randomBytes } from 'node:crypto'
import type { LogPayload } from '@infinitetoken/lumber-kit'

/**
 * Encrypts a LogPayload into the Lumber wire format.
 * Returns base64(IV[12 bytes] + AuthTag[16 bytes] + ciphertext).
 * Throws RangeError if keyBase64 does not decode to exactly 32 bytes.
 */
export function encryptPayload(payload: LogPayload, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64')
  if (key.length !== 32) {
    throw new RangeError(
      `Invalid encryption key: expected 32 bytes after base64 decode, got ${key.length}`,
    )
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = JSON.stringify(payload)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()  // must be called AFTER cipher.final()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}
