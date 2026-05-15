import { createDecipheriv } from 'node:crypto'
import { randomBytes } from 'node:crypto'
import { encryptPayload } from '../encrypt'

const VALID_KEY = randomBytes(32).toString('base64')

describe('encryptPayload', () => {
  it('returns a non-empty base64 string', () => {
    const result = encryptPayload({ message: 'hello' }, VALID_KEY)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('output layout: iv[0..11] + tag[12..27] + ciphertext[28..]', () => {
    const result = encryptPayload({ message: 'test', line: 42 }, VALID_KEY)
    const buf = Buffer.from(result, 'base64')
    // minimum length: 12 (IV) + 16 (tag) + 1 (at least one byte of ciphertext)
    expect(buf.length).toBeGreaterThan(28)
  })

  it('decrypts back to the original data', () => {
    const data = { message: 'round-trip', code: 'ERR_TEST', line: 99 }
    const result = encryptPayload(data, VALID_KEY)
    const buf = Buffer.from(result, 'base64')
    const iv  = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const ct  = buf.subarray(28)
    const key = Buffer.from(VALID_KEY, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const plain = decipher.update(ct, undefined, 'utf8') + decipher.final('utf8')
    expect(JSON.parse(plain)).toEqual(data)
  })

  it('produces a unique output on each call (IV uniqueness)', () => {
    const data = { message: 'same' }
    const a = encryptPayload(data, VALID_KEY)
    const b = encryptPayload(data, VALID_KEY)
    expect(a).not.toBe(b)
  })

  it('throws RangeError when key decodes to 31 bytes', () => {
    const shortKey = randomBytes(31).toString('base64')
    expect(() => encryptPayload({ message: 'x' }, shortKey)).toThrow(RangeError)
  })

  it('throws RangeError when key decodes to 33 bytes', () => {
    const longKey = randomBytes(33).toString('base64')
    expect(() => encryptPayload({ message: 'x' }, longKey)).toThrow(RangeError)
  })

  it('throws RangeError for empty string key', () => {
    expect(() => encryptPayload({ message: 'x' }, '')).toThrow(RangeError)
  })
})
