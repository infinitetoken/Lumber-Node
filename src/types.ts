import type { LogLevelName } from '@infinitetoken/lumber-kit'

/** Configuration passed to lumber.config(). */
export interface LumberConfig {
  /** Bearer token for API authentication (API key from app settings). */
  apiKey: string
  /** 32-byte symmetric key (base64) for AES-256-GCM encryption of the private log field. Required only if you use the private field on any log call. */
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

  /**
   * Protect common sensitive keys (password, token, email, ssn, etc.) found in metadata.
   * Default when encryptionKey is set: 'encrypt' — moves matching keys into the encrypted private field.
   * Default when no encryptionKey:    'redact'  — replaces the value with '[redacted]' in metadata.
   * 'redact'  — replaces the value with '[redacted]' in metadata.
   * false     — disables detection entirely.
   *
   * Object form for fine-grained control:
   *   behavior — override the action (omit = same smart default)
   *   add      — extend the built-in list with your own key names
   *   ignore   — remove keys from the built-in list
   */
  sensitiveKeys?:
    | false
    | 'warn'
    | 'redact'
    | 'encrypt'
    | {
        behavior?: 'warn' | 'redact' | 'encrypt'
        add?: string[]
        ignore?: string[]
      }
}
