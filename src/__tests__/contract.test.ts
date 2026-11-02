import { createDecipheriv } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { DEFAULT_API_ENDPOINT, type LogData, type LogLevel, type LogPayload } from '@infinitetoken/lumber-kit'

import { seal } from '../encrypt'
import { LumberClient } from '../index'

// Lumber-Kit's contract, which Lumber-Python and Lumber-Go are tested against too
const vectors = JSON.parse(readFileSync(require.resolve('@infinitetoken/lumber-kit/contract/vectors.json'), 'utf8'))

type EncryptionVector = { name: string; key: string; nonce: string; plaintext: string; payload: string }
type PayloadVector = { name: string; level: LogLevel; message: string; data?: LogData; autoContext?: Record<string, unknown>; payload: LogPayload }

const levelMethods = ['debug', 'info', 'warn', 'error', 'fatal'] as const
const KEY = vectors.encryption[0].key as string

describe('Lumber-Kit contract', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 201 } as Response)
  })
  afterEach(() => fetchSpy.mockRestore())

  it('sends to the default endpoint', async () => {
    const client = new LumberClient({ apiKey: `token.${KEY}`, context: false })
    client.info('hello')
    await client.flush()
    expect(fetchSpy.mock.calls[0][0]).toBe(`${DEFAULT_API_ENDPOINT}${vectors.constants.ingestPath}`)
    expect(vectors.constants.defaultEndpoint).toBe(DEFAULT_API_ENDPOINT)
  })

  it.each(vectors.encryption as EncryptionVector[])('encrypts: $name', (v) => {
    const sealed = seal(v.plaintext, Buffer.from(v.key, 'base64'), Buffer.from(v.nonce, 'base64'))
    expect(sealed.toString('base64')).toBe(v.payload)
  })

  // Vectors with automatic context are the kit's own buildLogPayload's; this client's automatic context is its own
  it.each((vectors.payloads as PayloadVector[]).filter((v) => !v.autoContext))('sends the payload: $name', async (v) => {
    const client = new LumberClient({ apiKey: `token.${KEY}`, context: false })
    client[levelMethods[v.level]](v.message, v.data)
    await client.flush()

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(Object.keys(body).sort()).toEqual(['encrypted', 'level'])
    expect(body.level).toBe(v.level)
    expect(Object.keys(body.encrypted).sort()).toEqual(['keyVersion', 'nonce', 'payload'])
    expect(body.encrypted.keyVersion).toBe(vectors.constants.keyVersion)

    const nonce = Buffer.from(body.encrypted.nonce, 'base64')
    const sealed = Buffer.from(body.encrypted.payload, 'base64')
    expect(nonce).toHaveLength(vectors.constants.nonceBytes)
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(KEY, 'base64'), nonce)
    decipher.setAuthTag(sealed.subarray(0, vectors.constants.tagBytes))
    const plaintext = decipher.update(sealed.subarray(vectors.constants.tagBytes), undefined, 'utf8') + decipher.final('utf8')
    expect(JSON.parse(plaintext)).toEqual(v.payload)
  })
})
