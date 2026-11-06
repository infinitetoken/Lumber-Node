/* eslint-disable no-console */
import { logDelivery, logDeliveryOutcome, logRetryDelayMs } from '@infinitetoken/lumber-kit'

interface QueueItem {
  body: Record<string, unknown>
  attempts: number
}

type SendResult = 'sent' | 'retry' | 'drop'

/** How long a send waits for Lumber to answer before it counts as a failed attempt, as Lumber-Go and Lumber-Python wait. */
export const DEFAULT_SEND_TIMEOUT_MS = 10_000

export class AsyncQueue {
  private readonly queue: QueueItem[] = []
  private draining = false
  private readonly maxAttempts = logDelivery.maxAttempts
  private readonly token: string
  private readonly endpoint: string
  private readonly timeoutMs: number
  // Set by a 429 (the team has sent its plan's logs for the month): until then logs are dropped as they're logged,
  // rather than queued and retried, which would only grow the queue and the console
  private pausedUntil = 0

  constructor(token: string, endpoint: string, timeoutMs: number = DEFAULT_SEND_TIMEOUT_MS) {
    this.token = token
    this.endpoint = endpoint
    this.timeoutMs = timeoutMs
  }

  /** Synchronous — returns immediately; queue drains asynchronously in the background. */
  enqueue(item: QueueItem['body']): void {
    if (Date.now() < this.pausedUntil) return
    this.queue.push({ body: item, attempts: 0 })
    if (!this.draining) {
      void this.drain()
    }
  }

  /**
   * Resolves true once the queue is empty and every send has settled, or false when `timeoutMs` passes first. Logs still
   * queued then keep sending in the background while the process runs. With no `timeoutMs` it waits as long as it takes.
   */
  flush(timeoutMs?: number): Promise<boolean> {
    if (this.idle()) return Promise.resolve(true)
    const deadline = timeoutMs === undefined ? Infinity : Date.now() + Math.max(0, timeoutMs)
    return new Promise((resolve) => {
      const check = () => {
        if (this.idle()) return resolve(true)
        const left = deadline - Date.now()
        if (left <= 0) return resolve(false)
        setTimeout(check, Math.min(50, left))
      }
      check()
    })
  }

  private idle(): boolean {
    return !this.draining && this.queue.length === 0
  }

  private async drain(): Promise<void> {
    this.draining = true
    while (this.queue.length > 0) {
      const item = this.queue[0]
      const result = await this.send(item)
      if (result === 'sent' || result === 'drop') {
        this.queue.shift()
      } else {
        item.attempts++
        if (item.attempts >= this.maxAttempts) {
          console.warn(`[lumber] dropping log after ${this.maxAttempts} failed attempts`)
          this.queue.shift()
        } else {
          await this.sleep(logRetryDelayMs(item.attempts))
        }
      }
    }
    this.draining = false
  }

  private async send(item: QueueItem): Promise<SendResult> {
    try {
      const res = await fetch(`${this.endpoint}/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`
        },
        body: JSON.stringify(item.body),
        // A send with no answer counts as a failed attempt rather than holding the queue (and flush()) until the
        // platform's own timeout, which on serverless can be the function's whole run
        signal: AbortSignal.timeout(this.timeoutMs)
      })
      // What each answer means is Lumber-Kit's (logDeliveryOutcome), the same for every plugin
      const outcome = res.ok ? 'sent' : logDeliveryOutcome(res.status)
      if (outcome === 'sent') return 'sent'
      if (outcome === 'pause') {
        this.pause(res, await this.messageOf(res))
        return 'drop'
      }
      // Any other refusal (a bad key, a malformed log) won't go through on a later try
      if (outcome === 'drop') {
        const message = await this.messageOf(res)
        console.warn(`[lumber] log refused: HTTP ${res.status}${message ? ` (${message})` : ''}`)
        return 'drop'
      }
      console.warn(`[lumber] send failed: HTTP ${res.status}`)
      return 'retry'
    } catch (err) {
      // The signal's reason, a DOMException, which isn't always an instance of this realm's Error
      if ((err as { name?: unknown } | null)?.name === 'TimeoutError') {
        console.warn(`[lumber] send failed: no answer in ${this.timeoutMs / 1000}s`)
      } else {
        console.warn(`[lumber] send error:`, err)
      }
      return 'retry'
    }
  }

  // Stops sending until the API's Retry-After (the start of the next month, for the monthly cap), dropping what's
  // queued, with one warning for the whole pause
  private pause(res: Response, message: string | null): void {
    const seconds = Number(res.headers?.get?.('Retry-After'))
    this.pausedUntil = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : logDelivery.pauseMs)
    this.queue.splice(1)
    console.warn(`[lumber] ${message ?? 'Lumber is refusing logs for now (HTTP 429).'} Dropping logs until ${new Date(this.pausedUntil).toISOString()}.`)
  }

  // The API's error message ({ message }), if it sent one
  private async messageOf(res: Response): Promise<string | null> {
    try {
      const body: unknown = await res.json()
      return body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string' ? (body as { message: string }).message : null
    } catch {
      return null
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
