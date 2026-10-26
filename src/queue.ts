/* eslint-disable no-console */
interface QueueItem {
  body: Record<string, unknown>
  attempts: number
}

type SendResult = 'sent' | 'retry' | 'drop'

// How long to stop sending after a 429 that says nothing of when to try again
const DEFAULT_PAUSE_MS = 60 * 60 * 1000

export class AsyncQueue {
  private readonly queue: QueueItem[] = []
  private draining = false
  private readonly maxAttempts = 5
  private readonly token: string
  private readonly endpoint: string
  // Set by a 429 (the team has sent its plan's logs for the month): until then logs are dropped as they're logged,
  // rather than queued and retried, which would only grow the queue and the console
  private pausedUntil = 0

  constructor(token: string, endpoint: string) {
    this.token = token
    this.endpoint = endpoint
  }

  /** Synchronous — returns immediately; queue drains asynchronously in the background. */
  enqueue(item: QueueItem['body']): void {
    if (Date.now() < this.pausedUntil) return
    this.queue.push({ body: item, attempts: 0 })
    if (!this.draining) {
      void this.drain()
    }
  }

  /** Resolves when the queue is empty and all in-flight sends have settled. */
  flush(): Promise<void> {
    if (!this.draining && this.queue.length === 0) return Promise.resolve()
    return new Promise((resolve) => {
      const check = () => {
        if (!this.draining && this.queue.length === 0) {
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
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
          await this.sleep(Math.min(1000 * Math.pow(2, item.attempts - 1), 30_000))
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
        body: JSON.stringify(item.body)
      })
      if (res.ok) return 'sent'
      if (res.status === 429) {
        this.pause(res, await this.messageOf(res))
        return 'drop'
      }
      // Any other refusal (a bad key, a malformed log) won't go through on a later try
      if (res.status >= 400 && res.status < 500) {
        const message = await this.messageOf(res)
        console.warn(`[lumber] log refused: HTTP ${res.status}${message ? ` (${message})` : ''}`)
        return 'drop'
      }
      console.warn(`[lumber] send failed: HTTP ${res.status}`)
      return 'retry'
    } catch (err) {
      console.warn(`[lumber] send error:`, err)
      return 'retry'
    }
  }

  // Stops sending until the API's Retry-After (the start of the next month, for the monthly cap), dropping what's
  // queued, with one warning for the whole pause
  private pause(res: Response, message: string | null): void {
    const seconds = Number(res.headers?.get?.('Retry-After'))
    this.pausedUntil = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_PAUSE_MS)
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
