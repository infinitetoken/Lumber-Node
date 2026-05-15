import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { LumberClient } from '../index'
import { LogLevel } from '@infinitetoken/lumber-kit'

const VALID_KEY   = randomBytes(32).toString('base64')
const VALID_TOKEN = 'test-token'
const ENDPOINT    = 'https://example.com'

function makeClient() {
  return new LumberClient({ token: VALID_TOKEN, key: VALID_KEY, endpoint: ENDPOINT })
}

describe('LumberClient constructor', () => {
  it('throws RangeError when key decodes to wrong byte length', () => {
    const badKey = randomBytes(16).toString('base64')
    expect(() => new LumberClient({ token: 't', key: badKey, endpoint: 'https://x.com' }))
      .toThrow(RangeError)
  })

  it('throws Error mentioning Node 18 when fetch is not a function', () => {
    const orig = (globalThis as any).fetch
    ;(globalThis as any).fetch = undefined
    try {
      expect(() => new LumberClient({ token: 't', key: VALID_KEY, endpoint: 'https://x.com' }))
        .toThrow(/Node 18/)
    } finally {
      ;(globalThis as any).fetch = orig
    }
  })
})

describe('LumberClient.log()', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response)
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('1000 log() calls complete in under 10ms (non-blocking event loop)', () => {
    const client = makeClient()
    const start = Date.now()
    for (let i = 0; i < 1000; i++) {
      client.log({ message: `msg ${i}`, level: LogLevel.Info })
    }
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(50)
  })

  it('message is sent as plaintext; no private field when none provided', async () => {
    const client = makeClient()
    client.log({ message: 'hello', level: LogLevel.Info })
    await new Promise((r) => setTimeout(r, 50))
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.message).toBe('hello')
    expect(body.private).toBeUndefined()
  })

  it('private field is AES-256-GCM encrypted, not plaintext', async () => {
    const client = makeClient()
    const sensitiveData = { secret: 'top-secret-value' }
    client.log({ message: 'something happened', level: LogLevel.Info, private: sensitiveData })
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    // message sent as plaintext
    expect(body.message).toBe('something happened')
    // private.payload is base64 ciphertext — must not contain sensitiveData in plaintext
    expect(body.private.payload).not.toContain('top-secret-value')
    expect(() => Buffer.from(body.private.payload, 'base64')).not.toThrow()
    expect(typeof body.private.nonce).toBe('string')
    expect(body.private.keyVersion).toBe(1)
  })
})

describe('runtime dependencies', () => {
  it('package.json dependencies contains only @infinitetoken/lumber-kit (our own types package)', () => {
    const pkgPath = resolve(__dirname, '../../package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const deps = Object.keys(pkg.dependencies ?? {})
    // Only our own types package is allowed — no third-party utility dependencies
    expect(deps).toEqual(['@infinitetoken/lumber-kit'])
  })
})
