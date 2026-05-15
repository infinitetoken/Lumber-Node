import { LogLevel, LogPrivate } from '@infinitetoken/lumber-kit'
import { encryptPayload } from './encrypt'
import { AsyncQueue } from './queue'
import type { LumberConfig } from './types'

export { LumberConfig } from './types'
export { LogLevel } from '@infinitetoken/lumber-kit'

export interface LogInput {
  message: string
  level?: LogLevel
  flagged?: boolean
  private?: Record<string, unknown>
}

export class LumberClient {
  private readonly config: LumberConfig
  private readonly queue: AsyncQueue

  constructor(config: LumberConfig) {
    if (typeof fetch !== 'function') {
      throw new Error(
        `Lumber requires Node 18 or later (built-in fetch). ` +
        `Current Node version: ${process.version}`,
      )
    }
    const keyBytes = Buffer.from(config.key, 'base64')
    if (keyBytes.length !== 32) {
      throw new RangeError(
        `Invalid key: expected 32 bytes after base64 decode, got ${keyBytes.length}.`,
      )
    }
    this.config = config
    this.queue = new AsyncQueue(config.token, config.endpoint ?? 'https://lumber-api.vercel.app')
  }

  /**
   * Enqueues a log for async HTTP delivery. Returns immediately — never throws.
   * If input.private is provided it is AES-256-GCM encrypted before transmission.
   */
  log(input: LogInput): void {
    const { message, level = LogLevel.Info, flagged, private: privateData } = input

    const body: Record<string, unknown> = { message, level }
    if (flagged !== undefined) body.flagged = flagged

    if (privateData !== undefined) {
      let encrypted: string
      try {
        encrypted = encryptPayload(privateData, this.config.key)
      } catch {
        return
      }
      const buf = Buffer.from(encrypted, 'base64')
      const logPrivate: LogPrivate = {
        nonce: buf.subarray(0, 12).toString('base64'),
        payload: buf.subarray(12).toString('base64'),
        keyVersion: 1,
      }
      body.private = logPrivate
    }

    this.queue.enqueue(body)
  }
}

export default LumberClient
