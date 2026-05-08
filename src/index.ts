import { LogLevel, LogPayload } from '@infinitetoken/lumber-kit'
import { encryptPayload } from './encrypt'
import { AsyncQueue } from './queue'
import type { LumberConfig } from './types'

export { LumberConfig } from './types'
export { LogLevel } from '@infinitetoken/lumber-kit'

export class LumberClient {
  private readonly config: LumberConfig
  private readonly queue: AsyncQueue

  constructor(config: LumberConfig) {
    // Fail fast: Node < 18 has no global fetch
    if (typeof fetch !== 'function') {
      throw new Error(
        `Lumber requires Node 18 or later (built-in fetch). ` +
        `Current Node version: ${process.version}`,
      )
    }
    // Fail fast: X25519 public keys are always 32 raw bytes
    const keyBytes = Buffer.from(config.key, 'base64')
    if (keyBytes.length !== 32) {
      throw new RangeError(
        `Invalid key: expected 32 bytes after base64 decode, got ${keyBytes.length}. ` +
        `Pass the public_key exactly as returned by POST /apps.`,
      )
    }
    this.config = config
    this.queue = new AsyncQueue(config.key, config.endpoint ?? 'https://lumber-api.vercel.app/logs')
  }

  /**
   * Encrypts payload and enqueues it for async HTTP send to the Lumber API.
   * Returns immediately — never throws. Failures are retried internally.
   */
  log(input: LogPayload & { level?: LogLevel }, flagged?: boolean): void {
    const { level = LogLevel.Info, ...payload } = input
    let encrypted: string
    try {
      encrypted = encryptPayload(payload, this.config.key)
    } catch {
      // encryptPayload only throws on key errors caught at construction — this is defensive
      return
    }
    this.queue.enqueue({ payload: encrypted, level, flagged })
  }
}

export default LumberClient
