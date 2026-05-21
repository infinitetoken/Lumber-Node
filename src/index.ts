/* eslint-disable no-console */
import os from 'node:os'

import { LogContext, LogEncrypted, LogLevel, LogLevelName, LogPayload } from '@infinitetoken/lumber-kit'

import { encryptPayload } from './encrypt'
import { AsyncQueue } from './queue'
import type { LumberConfig } from './types'

const logLevelToName: Record<number, LogLevelName> = {
  [LogLevel.Debug]: 'debug',
  [LogLevel.Info]: 'info',
  [LogLevel.Warn]: 'warn',
  [LogLevel.Error]: 'error',
  [LogLevel.Fatal]: 'fatal'
}

const LEVEL_COLORS: Record<LogLevelName, string> = {
  debug: '\x1b[2m', // dim
  info: '\x1b[36m', // cyan
  warn: '\x1b[93m', // bright yellow
  error: '\x1b[31m', // red
  fatal: '\x1b[35m' // magenta
}
const RESET = '\x1b[0m'

const LEVEL_BADGE: Record<LogLevelName, string> = {
  debug: '[DEBUG]',
  info: '[INFO] ',
  warn: '[WARN] ',
  error: '[ERROR]',
  fatal: '[FATAL]'
}

const _startTime = Date.now()

function formatTimestamp(mode: boolean | 'time' | 'iso' | 'relative'): string {
  if (!mode) return ''
  if (mode === 'iso') return `${new Date().toISOString()} `
  if (mode === 'relative') {
    const elapsed = ((Date.now() - _startTime) / 1000).toFixed(3)
    return `+${elapsed}s `
  }
  // true or 'time' → HH:MM:SS.mmm
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const ms = String(now.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms} `
}

export { LumberConfig } from './types'
export { LogLevel } from '@infinitetoken/lumber-kit'

export interface LogData {
  requestId?: string
  traceId?: string
  context?: LogContext
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export class LumberClient {
  private readonly config: LumberConfig
  private readonly queue: AsyncQueue
  private readonly baseContext: Partial<LogContext>

  constructor(config: LumberConfig) {
    if (typeof fetch !== 'function') {
      throw new Error(`Lumber requires Node 18 or later (built-in fetch). Current Node version: ${process.version}`)
    }
    const keyBytes = Buffer.from(config.encryptionKey, 'base64')
    if (keyBytes.length !== 32) {
      throw new RangeError(`Invalid encryptionKey: expected 32 bytes after base64 decode, got ${keyBytes.length}.`)
    }
    this.config = config
    this.queue = new AsyncQueue(config.apiKey, config.endpoint ?? 'https://lumber-api.vercel.app')
    this.baseContext = this.buildBaseContext()
  }

  private buildBaseContext(): Partial<LogContext> {
    const cfg = this.config.context
    if (cfg === false) return {}
    const envEnabled = cfg === undefined || cfg === true || (typeof cfg === 'object' && cfg.env !== false)
    if (!envEnabled) return {}
    const ctx: Record<string, unknown> = { pid: process.pid }
    try {
      ctx.hostname = os.hostname()
    } catch {
      /* non-fatal */
    }
    if (process.env.NODE_ENV) ctx.env = process.env.NODE_ENV
    return ctx
  }

  private getCallerContext(): Partial<LogContext> {
    const cfg = this.config.context
    if (cfg === false || cfg === true || cfg === undefined || !cfg.caller) return {}
    const depth = cfg.callerDepth ?? 0
    const err = new Error()
    const lines = err.stack?.split('\n') ?? []
    // [0]=Error [1]=getCallerContext [2]=enqueueLog [3]=debug/info/etc [4+depth]=actual caller
    const line = lines[4 + depth]
    const match = line?.match(/at .+ \((.+):(\d+):(\d+)\)/) ?? line?.match(/at (.+):(\d+):(\d+)/)
    if (!match) return {}
    return { code: match[1], line: parseInt(match[2], 10), column: parseInt(match[3], 10) }
  }

  private maybeConsoleLog(level: LogLevel, message: string, payload: LogPayload): void {
    const cfg = this.config.console
    if (!cfg) return
    const name = logLevelToName[level] as LogLevelName
    const opts = cfg === true ? {} : cfg

    const enabled = !opts.levels || !!opts.levels[name]
    if (!enabled) return

    const method = (name === 'debug' ? 'debug' : name === 'info' ? 'info' : name === 'warn' ? 'warn' : 'error') as 'debug' | 'info' | 'warn' | 'error'

    const tty = method === 'debug' || method === 'info' ? !!process.stdout.isTTY : !!process.stderr.isTTY
    const useColor = opts.color !== false && tty
    const showPrefix = opts.prefix !== false

    const ts = opts.timestamp ? formatTimestamp(opts.timestamp) : ''
    const badge = LEVEL_BADGE[name]
    const label = showPrefix ? (useColor ? `${ts}${LEVEL_COLORS[name]}${badge}${RESET} ` : `${ts}${badge} `) : ts
    const out = `${label}${message}`

    if (!opts.data && !opts.pretty) {
      console[method](out)
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { message: _m, level: _l, ...extras } = payload
    if (Object.keys(extras).length === 0) {
      console[method](out)
      return
    }

    if (opts.pretty) {
      console[method](`${out}\n${JSON.stringify(extras, null, 2)}`)
    } else {
      console[method](out, extras)
    }
  }

  private enqueueLog(message: string, level: LogLevel, data?: LogData): void {
    const { requestId, traceId, context, metadata, ...rest } = data ?? {}

    const mergedMetadata: Record<string, unknown> | undefined = Object.keys(rest).length > 0 ? { ...rest, ...(metadata ?? {}) } : metadata

    const autoCtx = { ...this.baseContext, ...this.getCallerContext() }
    const mergedCtx = Object.keys(autoCtx).length > 0 ? { ...autoCtx, ...(context ?? {}) } : context

    const payload: LogPayload = { level, message }
    if (requestId !== undefined) payload.requestId = requestId
    if (traceId !== undefined) payload.traceId = traceId
    if (mergedCtx !== undefined) payload.context = mergedCtx
    if (mergedMetadata !== undefined) payload.metadata = mergedMetadata

    this.maybeConsoleLog(level, message, payload)

    const encrypted = encryptPayload(payload, this.config.encryptionKey)
    const buf = Buffer.from(encrypted, 'base64')
    const logEncrypted: LogEncrypted = {
      nonce: buf.subarray(0, 12).toString('base64'),
      payload: buf.subarray(12).toString('base64'),
      keyVersion: 1
    }

    this.queue.enqueue({ level, encrypted: logEncrypted })
  }

  log(message: string, data?: LogData): void {
    this.enqueueLog(message, LogLevel.Info, data)
  }
  debug(message: string, data?: LogData): void {
    this.enqueueLog(message, LogLevel.Debug, data)
  }
  info(message: string, data?: LogData): void {
    this.enqueueLog(message, LogLevel.Info, data)
  }
  warn(message: string, data?: LogData): void {
    this.enqueueLog(message, LogLevel.Warn, data)
  }
  error(message: string, data?: LogData): void {
    this.enqueueLog(message, LogLevel.Error, data)
  }
  fatal(message: string, data?: LogData): void {
    this.enqueueLog(message, LogLevel.Fatal, data)
  }
  flush(): Promise<void> {
    return this.queue.flush()
  }
}

// --- Singleton ---

let _client: LumberClient | null = null

function getClient(): LumberClient {
  if (!_client) throw new Error('[lumber] Call lumber.config() before logging.')
  return _client
}

const lumber = {
  config(cfg: LumberConfig): void {
    _client = new LumberClient(cfg)
  },
  log(message: string, data?: LogData): void {
    getClient().log(message, data)
  },
  debug(message: string, data?: LogData): void {
    getClient().debug(message, data)
  },
  info(message: string, data?: LogData): void {
    getClient().info(message, data)
  },
  warn(message: string, data?: LogData): void {
    getClient().warn(message, data)
  },
  error(message: string, data?: LogData): void {
    getClient().error(message, data)
  },
  fatal(message: string, data?: LogData): void {
    getClient().fatal(message, data)
  },
  flush(): Promise<void> {
    return getClient().flush()
  }
}

export default lumber
