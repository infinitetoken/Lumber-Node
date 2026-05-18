import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { LumberClient } from '../index'
import { LogLevel } from '@infinitetoken/lumber-kit'

const VALID_ENCRYPTION_KEY = randomBytes(32).toString('base64')
const VALID_API_KEY        = 'test-token'
const ENDPOINT             = 'https://example.com'

function makeClient(_overrides: unknown = {}, cfg: Record<string, unknown> = {}) {
  return new LumberClient({ apiKey: VALID_API_KEY, encryptionKey: VALID_ENCRYPTION_KEY, endpoint: ENDPOINT, context: false, ...cfg })
}

function fetchedBody(spy: jest.SpyInstance, callIndex = 0): Record<string, unknown> {
  const [, init] = spy.mock.calls[callIndex] as [string, RequestInit]
  return JSON.parse(init.body as string)
}

// ─── Constructor ──────────────────────────────────────────────────────────────

describe('LumberClient constructor', () => {
  it('throws RangeError when key decodes to wrong byte length', () => {
    const badKey = randomBytes(16).toString('base64')
    expect(() => new LumberClient({ apiKey: 't', encryptionKey: badKey, endpoint: ENDPOINT }))
      .toThrow(RangeError)
  })

  it('throws Error mentioning Node 18 when fetch is not a function', () => {
    const orig = (globalThis as any).fetch
    ;(globalThis as any).fetch = undefined
    try {
      expect(() => new LumberClient({ apiKey: 't', encryptionKey: VALID_ENCRYPTION_KEY, endpoint: ENDPOINT }))
        .toThrow(/Node 18/)
    } finally {
      ;(globalThis as any).fetch = orig
    }
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
    ['info',  LogLevel.Info],
    ['warn',  LogLevel.Warn],
    ['error', LogLevel.Error],
    ['fatal', LogLevel.Fatal],
  ] as const)('%s() sends correct level', async (method, expectedLevel) => {
    const client = makeClient()
    ;(client[method] as (m: string) => void)('test message')
    await new Promise((r) => setTimeout(r, 50))
    const body = fetchedBody(fetchSpy)
    expect(body.message).toBe('test message')
    expect(body.level).toBe(expectedLevel)
  })

  it('log() defaults to Info level', async () => {
    const client = makeClient()
    client.log('default level')
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchedBody(fetchSpy).level).toBe(LogLevel.Info)
  })
})

// ─── LogData spreading ────────────────────────────────────────────────────────

describe('LogData field spreading', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response)
  })
  afterEach(() => fetchSpy.mockRestore())

  it('known fields pass through to correct body keys', async () => {
    const client = makeClient()
    client.warn('msg', { flagged: true, context: { code: 'app.ts' }, metadata: { version: 2 } })
    await new Promise((r) => setTimeout(r, 50))
    const body = fetchedBody(fetchSpy)
    expect(body.flagged).toBe(true)
    expect((body.context as any).code).toBe('app.ts')
    expect((body.metadata as any).version).toBe(2)
  })

  it('unknown extra keys are merged into metadata', async () => {
    const client = makeClient()
    client.info('msg', { userId: '123', action: 'login' })
    await new Promise((r) => setTimeout(r, 50))
    const body = fetchedBody(fetchSpy)
    expect((body.metadata as any).userId).toBe('123')
    expect((body.metadata as any).action).toBe('login')
  })

  it('explicit metadata wins over extra-key collision', async () => {
    const client = makeClient()
    client.info('msg', { userId: 'from-extra', metadata: { userId: 'from-metadata' } })
    await new Promise((r) => setTimeout(r, 50))
    const body = fetchedBody(fetchSpy)
    expect((body.metadata as any).userId).toBe('from-metadata')
  })

  it('no metadata key in body when no extra data provided', async () => {
    const client = makeClient()
    client.info('plain message')
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchedBody(fetchSpy).metadata).toBeUndefined()
  })
})

// ─── Private encryption ───────────────────────────────────────────────────────

describe('private field encryption', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response)
  })
  afterEach(() => fetchSpy.mockRestore())

  it('encrypts private data — plaintext not present in payload', async () => {
    const client = makeClient()
    client.info('something happened', { private: { secret: 'top-secret-value' } })
    await new Promise((r) => setTimeout(r, 50))
    const body = fetchedBody(fetchSpy)
    expect(body.message).toBe('something happened')
    expect((body.private as any).payload).not.toContain('top-secret-value')
    expect(typeof (body.private as any).nonce).toBe('string')
    expect((body.private as any).keyVersion).toBe(1)
  })

  it('no private key in body when none provided', async () => {
    const client = makeClient()
    client.info('hello')
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchedBody(fetchSpy).private).toBeUndefined()
  })

  it('warns and omits private field when no encryptionKey configured', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const client = new LumberClient({ apiKey: VALID_API_KEY, endpoint: ENDPOINT, context: false })
    client.info('msg', { private: { secret: 'oops' } })
    await new Promise((r) => setTimeout(r, 50))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no encryptionKey'))
    expect(fetchedBody(fetchSpy).private).toBeUndefined()
    expect(fetchedBody(fetchSpy).message).toBe('msg') // log still sent
    warnSpy.mockRestore()
  })
})

// ─── Sensitive key detection ──────────────────────────────────────────────────

describe('sensitive key detection', () => {
  let fetchSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response)
    warnSpy  = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => { fetchSpy.mockRestore(); warnSpy.mockRestore() })

  it('redacts by default when no encryptionKey and sensitive key found', async () => {
    const client = new LumberClient({ apiKey: VALID_API_KEY, endpoint: ENDPOINT, context: false })
    client.info('msg', { password: 'hunter2' })
    await new Promise((r) => setTimeout(r, 50))
    expect(warnSpy).not.toHaveBeenCalled()
    expect((fetchedBody(fetchSpy).metadata as any).password).toBe('[redacted]')
  })

  it('auto-encrypts by default when encryptionKey is set', async () => {
    const client = makeClient() // encryptionKey present → default 'encrypt'
    client.info('msg', { password: 'hunter2', userId: 'abc' })
    await new Promise((r) => setTimeout(r, 50))
    const body = fetchedBody(fetchSpy)
    expect(warnSpy).not.toHaveBeenCalled()
    expect((body.metadata as any)?.password).toBeUndefined()  // removed from metadata
    expect((body.metadata as any).userId).toBe('abc')         // non-sensitive stays
    expect(typeof (body.private as any).nonce).toBe('string') // encrypted
  })

  it('redact mode replaces value with [redacted]', async () => {
    const client = makeClient({}, { sensitiveKeys: 'redact' })
    client.info('msg', { email: 'user@example.com', userId: '123' })
    await new Promise((r) => setTimeout(r, 50))
    const metadata = fetchedBody(fetchSpy).metadata as any
    expect(metadata.email).toBe('[redacted]')
    expect(metadata.userId).toBe('123')
  })

  it('warn mode explicitly set — warns, value unchanged', async () => {
    const client = makeClient({}, { sensitiveKeys: 'warn' })
    client.info('msg', { token: 'abc123' })
    await new Promise((r) => setTimeout(r, 50))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('token'))
    expect((fetchedBody(fetchSpy).metadata as any).token).toBe('abc123')
  })

  it('sensitiveKeys: false disables detection', async () => {
    const client = makeClient({}, { sensitiveKeys: false })
    client.info('msg', { password: 'hunter2' })
    await new Promise((r) => setTimeout(r, 50))
    expect(warnSpy).not.toHaveBeenCalled()
    expect((fetchedBody(fetchSpy).metadata as any).password).toBe('hunter2')
  })

  it('non-sensitive keys are unaffected', async () => {
    const client = makeClient()
    client.info('msg', { userId: '123', action: 'login' })
    await new Promise((r) => setTimeout(r, 50))
    expect(warnSpy).not.toHaveBeenCalled()
    const metadata = fetchedBody(fetchSpy).metadata as any
    expect(metadata.userId).toBe('123')
    expect(metadata.action).toBe('login')
  })

  it('normalizes key variants — access_token, accessToken, ACCESSTOKEN all match', async () => {
    const client = new LumberClient({ apiKey: VALID_API_KEY, endpoint: ENDPOINT, context: false, sensitiveKeys: 'warn' })
    client.info('a', { access_token: 'x' })
    client.info('b', { accessToken: 'x' })
    client.info('c', { ACCESSTOKEN: 'x' })
    await new Promise((r) => setTimeout(r, 50))
    expect(warnSpy).toHaveBeenCalledTimes(3)
  })

  it('add: extends the built-in list with custom keys', async () => {
    const client = makeClient({}, { sensitiveKeys: { behavior: 'redact', add: ['legacyPin', 'internalToken'] } })
    client.info('msg', { legacyPin: '1234', userId: 'abc' })
    await new Promise((r) => setTimeout(r, 50))
    const metadata = fetchedBody(fetchSpy).metadata as any
    expect(metadata.legacyPin).toBe('[redacted]')
    expect(metadata.userId).toBe('abc')
  })

  it('ignore: removes a key from the built-in list', async () => {
    const client = makeClient({}, { sensitiveKeys: { behavior: 'redact', ignore: ['email'] } })
    client.info('msg', { email: 'user@example.com', password: 'secret' })
    await new Promise((r) => setTimeout(r, 50))
    const metadata = fetchedBody(fetchSpy).metadata as any
    expect(metadata.email).toBe('user@example.com') // not redacted
    expect(metadata.password).toBe('[redacted]')    // still caught
  })

  it('auto-encrypted sensitive keys merge with explicit private field', async () => {
    const client = makeClient()
    client.info('msg', { password: 'secret', private: { extra: 'data' } })
    await new Promise((r) => setTimeout(r, 50))
    const body = fetchedBody(fetchSpy)
    expect((body.metadata as any)?.password).toBeUndefined()
    expect(typeof (body.private as any).nonce).toBe('string')
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
    const infoSpy  = jest.spyOn(console, 'info').mockImplementation(() => {})
    const warnSpy  = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {})
    const client = makeClient({}, { console: true })
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
    infoSpy.mockRestore(); warnSpy.mockRestore(); errorSpy.mockRestore(); debugSpy.mockRestore()
  })

  it('console: { data: true } appends extras as second arg', () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
    const client = makeClient({}, { console: { data: true } })
    client.info('msg', { userId: '123' })
    expect(infoSpy).toHaveBeenCalledWith('[INFO]  msg', expect.objectContaining({ metadata: { userId: '123' } }))
    infoSpy.mockRestore()
  })

  it('console: { pretty: true } outputs indented JSON on a new line', () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
    const client = makeClient({}, { console: { pretty: true } })
    client.info('msg', { userId: '123' })
    const call = infoSpy.mock.calls[0][0] as string
    expect(call).toMatch(/^\[INFO\]  msg\n\{/)
    expect(call).toContain('"userId": "123"')
    infoSpy.mockRestore()
  })

  it('console: { levels: { warn: true } } only fires for that level', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
    const client = makeClient({}, { console: { levels: { warn: true } } })
    client.info('should be silent')
    client.warn('should log')
    expect(infoSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith('[WARN]  should log')
    warnSpy.mockRestore(); infoSpy.mockRestore()
  })

  it('console: { levels: { error: true }, data: true } — level filter + data combined', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy  = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const client = makeClient({}, { console: { levels: { error: true }, data: true } })
    client.warn('ignored', { x: 1 })
    client.error('shown', { x: 1 })
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith('[ERROR] shown', expect.objectContaining({ metadata: { x: 1 } }))
    errorSpy.mockRestore(); warnSpy.mockRestore()
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
    const ctx = fetchedBody(fetchSpy).context as any
    expect(ctx.pid).toBe(process.pid)
    expect(typeof ctx.hostname).toBe('string')
  })

  it('context: false disables auto-context entirely', async () => {
    const client = makeClient() // context: false
    client.info('msg')
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchedBody(fetchSpy).context).toBeUndefined()
  })

  it('user-supplied context is merged on top of auto-context', async () => {
    const client = new LumberClient({ apiKey: VALID_API_KEY, encryptionKey: VALID_ENCRYPTION_KEY, endpoint: ENDPOINT })
    client.info('msg', { context: { code: 'custom.ts' } })
    await new Promise((r) => setTimeout(r, 50))
    const ctx = fetchedBody(fetchSpy).context as any
    expect(ctx.code).toBe('custom.ts')
    expect(ctx.pid).toBe(process.pid) // auto-context still present
  })

  it('context: { caller: true } adds code/line/column', async () => {
    const client = new LumberClient({ apiKey: VALID_API_KEY, encryptionKey: VALID_ENCRYPTION_KEY, endpoint: ENDPOINT, context: { caller: true } })
    client.info('msg')
    await new Promise((r) => setTimeout(r, 50))
    const ctx = fetchedBody(fetchSpy).context as any
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
