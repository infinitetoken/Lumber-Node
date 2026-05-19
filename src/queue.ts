/* eslint-disable no-console */
interface QueueItem {
  body: Record<string, unknown>
  attempts: number
}

export class AsyncQueue {
  private readonly queue: QueueItem[] = []
  private draining = false
  private readonly maxAttempts = 5
  private readonly token: string
  private readonly endpoint: string

  constructor(token: string, endpoint: string) {
    this.token = token
    this.endpoint = endpoint
  }

  /** Synchronous — returns immediately; queue drains asynchronously in the background. */
  enqueue(item: QueueItem['body']): void {
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
      const sent = await this.send(item)
      if (sent) {
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

  private async send(item: QueueItem): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`
        },
        body: JSON.stringify(item.body)
      })
      if (!res.ok) console.warn(`[lumber] send failed: HTTP ${res.status}`)
      return res.ok
    } catch (err) {
      console.warn(`[lumber] send error:`, err)
      return false
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
