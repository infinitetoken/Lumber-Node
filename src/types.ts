import type { LogLevelName } from '@infinitetoken/lumber-kit'

/** Configuration passed to lumber.config(). */
export interface LumberConfig {
  /**
   * API key from the app's Secrets screen in Lumber: its token and the app's encryption key, joined by a dot. Only the
   * token is sent to the API; the encryption key (32 bytes, base64) encrypts all log content with AES-256-GCM.
   */
  apiKey: string
  /** The app's encryption key (32 bytes, base64), for an apiKey that's only a token. If apiKey carries one, they must match. */
  encryptionKey?: string
  /** Lumber API base URL (no trailing path). Defaults to the official Lumber API. */
  endpoint?: string

  /**
   * Echo logs to the console.
   * true = all levels, message only, with prefix and auto-color.
   * Object form for fine-grained control:
   *   levels — which levels to echo (omit = all)
   *   prefix — show [lumber:level] label (default true)
   *   color  — ANSI color when TTY (default true, auto-detected per stream)
   *   data   — append extras after message (default false)
   *   pretty — pretty-print extras with indentation (default false, implies data)
   */
  console?:
    | boolean
    | {
        levels?: Partial<Record<LogLevelName, boolean>>
        prefix?: boolean
        color?: boolean
        data?: boolean
        pretty?: boolean
        timestamp?: boolean | 'time' | 'iso' | 'relative'
      }

  /**
   * Auto-attach environment context (hostname, pid, NODE_ENV) to every log.
   * Captured once at config() time — zero per-call overhead.
   * Defaults to true. Set false to disable entirely.
   * { caller: true } also captures file/line/column from the call site per log.
   * callerDepth: extra stack frames to skip (default 0) — increment per wrapper layer.
   */
  context?: boolean | { env?: boolean; caller?: boolean; callerDepth?: number }
}
