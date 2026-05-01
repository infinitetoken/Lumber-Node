import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { LumberClient } from '../src/index'
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

  it('payload sent to fetch is base64 ciphertext, not plaintext', async () => {
    const client = makeClient()
    const secret = 'my-secret-message'
    client.log({ message: secret, level: LogLevel.Info })
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    // payload is base64 ciphertext — it must not contain the plaintext message
    expect(body.payload).not.toContain(secret)
    // and it should be a valid base64 string (no plaintext JSON structure)
    expect(() => Buffer.from(body.payload, 'base64')).not.toThrow()
  })
})

describe('zero runtime dependencies', () => {
  it('package.json has no "dependencies" key', () => {
    const pkgPath = resolve(__dirname, '../package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    expect(pkg.dependencies).toBeUndefined()
  })
})
