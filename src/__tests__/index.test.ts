import { createDecipheriv, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { LogLevel, LogPayload } from '@infinitetoken/lumber-kit'

import { LogData, LumberClient } from '../index'

const VALID_ENCRYPTION_KEY = randomBytes(32).toString('base64')
const VALID_API_KEY = 'test-token'
const ENDPOINT = 'https://example.com'

function makeClient(cfg: Record<string, unknown> = {}) {
  return new LumberClient({ apiKey: VALID_API_KEY, encryptionKey: VALID_ENCRYPTION_KEY, endpoint: ENDPOINT, context: false, ...cfg })
}

function fetchedBody(spy: jest.SpyInstance, callIndex = 0): Record<string, unknown> {
  const [, init] = spy.mock.calls[callIndex] as [string, RequestInit]
  return JSON.parse(init.body as string)
}

function decryptedPayload(spy: jest.SpyInstance, callIndex = 0): LogPayload {
  const body = fetchedBody(spy, callIndex)
  const enc = body.encrypted as { nonce: string; payload: string; keyVersion: number }
  const nonce = Buffer.from(enc.nonce, 'base64')
  const combined = Buffer.from(enc.payload, 'base64')
  const authTag = combined.subarray(0, 16)
  const ciphertext = combined.subarray(16)
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(VALID_ENCRYPTION_KEY, 'base64'), nonce)
  decipher.setAuthTag(authTag)
  const plain = decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8')
  return JSON.parse(plain) as LogPayload
}

// ─── Constructor ──────────────────────────────────────────────────────────────

describe('LumberClient constructor', () => {
  it('throws RangeError when key decodes to wrong byte length', () => {
    const badKey = randomBytes(16).toString('base64')
    expect(() => new LumberClient({ apiKey: 't', encryptionKey: badKey, endpoint: ENDPOINT })).toThrow(RangeError)
  })

  it('throws Error mentioning Node 18 when fetch is not a function', () => {
    const orig = (globalThis as any).fetch
    ;(globalThis as any).fetch = undefined
    try {
      expect(() => new LumberClient({ apiKey: 't', encryptionKey: VALID_ENCRYPTION_KEY, endpoint: ENDPOINT })).toThrow(/Node 18/)
    } finally {
      ;(globalThis as any).fetch = orig
    }
  })
})

// ─── API key ──────────────────────────────────────────────────────────────────

describe('API key with its encryption key joined', () => {
  const JOINED_API_KEY = `${VALID_API_KEY}.${VALID_ENCRYPTION_KEY}`
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response)
  })
  afterEach(() => fetchSpy.mockRestore())

  it('encrypts with the key after the dot and sends only the token', async () => {
    const client = makeClient({ apiKey: JOINED_API_KEY, encryptionKey: undefined })
    client.info('joined')
    await client.flush()
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${VALID_API_KEY}`)
    expect(init.body as string).not.toContain(VALID_ENCRYPTION_KEY)
    expect(decryptedPayload(fetchSpy).message).toBe('joined')
  })

  it('accepts encryptionKey alongside it when they match', () => {
    expect(() => makeClient({ apiKey: JOINED_API_KEY })).not.toThrow()
  })

  it('throws when encryptionKey disagrees with the joined key', () => {
    expect(() => makeClient({ apiKey: JOINED_API_KEY, encryptionKey: randomBytes(32).toString('base64') })).toThrow(/different encryption key/)
  })

  it('throws when neither apiKey nor encryptionKey carries an encryption key', () => {
    expect(() => makeClient({ encryptionKey: undefined })).toThrow(/no encryption key/)
  })

  it('throws when apiKey is missing', () => {
    expect(() => makeClient({ apiKey: undefined })).toThrow(/Missing apiKey/)
  })
})

// ─── Level methods ────────────────────────────────────────────────────────────

describe('level shorthand methods', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response)
  })
  afterEach(() => fetchSpy.mockRestore())

  it.each([
    ['debug', LogLevel.Debug],
    ['info', LogLevel.Info],
    ['warn', LogLevel.Warn],
    ['error', LogLevel.Error],
    ['fatal', LogLevel.Fatal]
  ] as const)('%s() sends correct level', async (method, expectedLevel) => {
    const client = makeClient()
    ;(client[method] as (m: string) => void)('test message')
    await new Promise((r) => setTimeout(r, 50))
    const payload = decryptedPayload(fetchSpy)
    expect(payload.message).toBe('test message')
    expect(payload.level).toBe(expectedLevel)
  })

  it('log() defaults to Info level', async () => {
    const client = makeClient()
    client.log('default level')
    await new Promise((r) => setTimeout(r, 50))
    expect(decryptedPayload(fetchSpy).level).toBe(LogLevel.Info)
  })

  it('body contains only level and encrypted fields', async () => {
    const client = makeClient()
    client.info('msg')
    await new Promise((r) => setTimeout(r, 50))
    const body = fetchedBody(fetchSpy)
    expect(Object.keys(body).sort()).toEqual(['encrypted', 'level'])
    expect(typeof (body.level as any)).toBe('number')
    expect(typeof (body.encrypted as any).nonce).toBe('string')
    expect(typeof (body.encrypted as any).payload).toBe('string')
    expect((body.encrypted as any).keyVersion).toBe(1)
  })
})

// ─── LogData spreading ────────────────────────────────────────────────────────

describe('LogData field spreading', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response)
  })
  afterEach(() => fetchSpy.mockRestore())

  it('known fields pass through into encrypted payload', async () => {
    const client = makeClient()
    client.warn('msg', { requestId: 'req-123', context: { code: 'app.ts' }, metadata: { version: 2 } })
    await new Promise((r) => setTimeout(r, 50))
    const payload = decryptedPayload(fetchSpy)
    expect(payload.requestId).toBe('req-123')
    expect(payload.context?.code).toBe('app.ts')
    expect(payload.metadata?.version).toBe(2)
  })

  it('unknown extra keys are merged into metadata', async () => {
    const client = makeClient()
    client.info('msg', { userId: '123', action: 'login' })
    await new Promise((r) => setTimeout(r, 50))
    const payload = decryptedPayload(fetchSpy)
    expect(payload.metadata?.userId).toBe('123')
    expect(payload.metadata?.action).toBe('login')
  })

  it('explicit metadata wins over extra-key collision', async () => {
    const client = makeClient()
    client.info('msg', { userId: 'from-extra', metadata: { userId: 'from-metadata' } })
    await new Promise((r) => setTimeout(r, 50))
    expect(decryptedPayload(fetchSpy).metadata?.userId).toBe('from-metadata')
  })

  it('no metadata in payload when no extra data provided', async () => {
    const client = makeClient()
    client.info('plain message')
    await new Promise((r) => setTimeout(r, 50))
    expect(decryptedPayload(fetchSpy).metadata).toBeUndefined()
  })

  // A string context was spread character by character, into { 0: 'b', 1: 'i', ... }
  it('a context or metadata that is not an object lands in metadata as it is', async () => {
    const client = makeClient()
    client.info('msg', { context: 'billing', metadata: ['a', 'b'], userId: '123' } as unknown as LogData)
    await new Promise((r) => setTimeout(r, 50))
    const payload = decryptedPayload(fetchSpy)
    expect(payload.metadata).toEqual({ context: 'billing', metadata: ['a', 'b'], userId: '123' })
    expect(payload.context).toBeUndefined()
  })

  it('a null context or metadata is left out', async () => {
    const client = makeClient()
    client.info('msg', { context: null, metadata: null } as unknown as LogData)
    await new Promise((r) => setTimeout(r, 50))
    expect(decryptedPayload(fetchSpy).metadata).toBeUndefined()
  })

  it('traceId is included in encrypted payload', async () => {
    const client = makeClient()
    client.info('msg', { traceId: 'trace-abc' })
    await new Promise((r) => setTimeout(r, 50))
    expect(decryptedPayload(fetchSpy).traceId).toBe('trace-abc')
  })
})

// ─── Encryption structure ─────────────────────────────────────────────────────

describe('encryption', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response)
  })
  afterEach(() => fetchSpy.mockRestore())

  it('encrypted payload round-trips correctly', async () => {
    const client = makeClient()
    client.info('secret message', { metadata: { key: 'value' } })
    await new Promise((r) => setTimeout(r, 50))
    const body = fetchedBody(fetchSpy)
    expect((body.encrypted as any).payload).not.toContain('secret message')
    const payload = decryptedPayload(fetchSpy)
    expect(payload.message).toBe('secret message')
    expect(payload.metadata?.key).toBe('value')
  })

  it('each log produces a unique nonce', async () => {
    const client = makeClient()
    client.info('first')
    client.info('second')
    await new Promise((r) => setTimeout(r, 50))
    const nonce1 = (fetchedBody(fetchSpy, 0).encrypted as any).nonce
    const nonce2 = (fetchedBody(fetchSpy, 1).encrypted as any).nonce
    expect(nonce1).not.toBe(nonce2)
  })
})

// ─── Console mirroring ────────────────────────────────────────────────────────

describe('console mirroring', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response)
  })
  afterEach(() => fetchSpy.mockRestore())

  it('console: true outputs message only — no data appended', () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {})
    const client = makeClient({ console: true })
    client.info('hello info', { userId: '123' })
    client.warn('hello warn')
    client.error('hello error')
    client.fatal('hello fatal')
    client.debug('hello debug')
    expect(infoSpy).toHaveBeenCalledWith('[INFO]  hello info')
    expect(warnSpy).toHaveBeenCalledWith('[WARN]  hello warn')
    expect(errorSpy).toHaveBeenCalledWith('[ERROR] hello error')
    expect(errorSpy).toHaveBeenCalledWith('[FATAL] hello fatal')
    expect(debugSpy).toHaveBeenCalledWith('[DEBUG] hello debug')
    infoSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    debugSpy.mockRestore()
  })

  it('console: { data: true } appends extras as second arg', () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
    const client = makeClient({ console: { data: true } })
    client.info('msg', { userId: '123' })
    expect(infoSpy).toHaveBeenCalledWith('[INFO]  msg', expect.objectContaining({ metadata: { userId: '123' } }))
    infoSpy.mockRestore()
  })

  it('console: { pretty: true } outputs indented JSON on a new line', () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
    const client = makeClient({ console: { pretty: true } })
    client.info('msg', { userId: '123' })
    const call = infoSpy.mock.calls[0][0] as string
    expect(call).toMatch(/^\[INFO\]  msg\n\{/)
    expect(call).toContain('"userId": "123"')
    infoSpy.mockRestore()
  })

  it('console: { levels: { warn: true } } only fires for that level', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
    const client = makeClient({ console: { levels: { warn: true } } })
    client.info('should be silent')
    client.warn('should log')
    expect(infoSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith('[WARN]  should log')
    warnSpy.mockRestore()
    infoSpy.mockRestore()
  })

  it('console: { levels: { error: true }, data: true } — level filter + data combined', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const client = makeClient({ console: { levels: { error: true }, data: true } })
    client.warn('ignored', { x: 1 })
    client.error('shown', { x: 1 })
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith('[ERROR] shown', expect.objectContaining({ metadata: { x: 1 } }))
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })
})

// ─── Auto-context ─────────────────────────────────────────────────────────────

describe('auto-context', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response)
  })
  afterEach(() => fetchSpy.mockRestore())

  it('env context is on by default (pid + hostname present)', async () => {
    const client = new LumberClient({ apiKey: VALID_API_KEY, encryptionKey: VALID_ENCRYPTION_KEY, endpoint: ENDPOINT })
    client.info('msg')
    await new Promise((r) => setTimeout(r, 50))
    const ctx = decryptedPayload(fetchSpy).context as any
    expect(ctx.pid).toBe(process.pid)
    expect(typeof ctx.hostname).toBe('string')
  })

  it('context: false disables auto-context entirely', async () => {
    const client = makeClient()
    client.info('msg')
    await new Promise((r) => setTimeout(r, 50))
    expect(decryptedPayload(fetchSpy).context).toBeUndefined()
  })

  it('user-supplied context is merged on top of auto-context', async () => {
    const client = new LumberClient({ apiKey: VALID_API_KEY, encryptionKey: VALID_ENCRYPTION_KEY, endpoint: ENDPOINT })
    client.info('msg', { context: { code: 'custom.ts' } })
    await new Promise((r) => setTimeout(r, 50))
    const ctx = decryptedPayload(fetchSpy).context as any
    expect(ctx.code).toBe('custom.ts')
    expect(ctx.pid).toBe(process.pid)
  })

  it('context: { caller: true } adds code/line/column', async () => {
    const client = new LumberClient({ apiKey: VALID_API_KEY, encryptionKey: VALID_ENCRYPTION_KEY, endpoint: ENDPOINT, context: { caller: true } })
    client.info('msg')
    await new Promise((r) => setTimeout(r, 50))
    const ctx = decryptedPayload(fetchSpy).context as any
    expect(typeof ctx.code).toBe('string')
    expect(typeof ctx.line).toBe('number')
    expect(typeof ctx.column).toBe('number')
  })
})

// ─── Singleton ────────────────────────────────────────────────────────────────

describe('singleton (lumber default export)', () => {
  it('throws before config() is called', () => {
    jest.resetModules()
    const { default: lumber } = require('../index')
    expect(() => lumber.info('too early')).toThrow(/lumber\.config\(\)/)
  })
})

// ─── Performance ──────────────────────────────────────────────────────────────

describe('performance', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response)
  })
  afterEach(() => fetchSpy.mockRestore())

  it('1000 info() calls complete in under 50ms (non-blocking)', async () => {
    const client = makeClient()
    const start = Date.now()
    for (let i = 0; i < 1000; i++) client.info(`msg ${i}`)
    expect(Date.now() - start).toBeLessThan(50)
    await client.flush()
  })
})

// ─── Runtime dependencies ─────────────────────────────────────────────────────

describe('runtime dependencies', () => {
  it('package.json dependencies contains only @infinitetoken/lumber-kit', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'))
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['@infinitetoken/lumber-kit'])
  })
})
