interface QueueItem {
  body: { payload: string; level: number; flagged?: boolean }
  attempts: number
}

export class AsyncQueue {
  private readonly queue: QueueItem[] = []
  private draining = false
  private readonly maxAttempts = 5
  private readonly appKey: string
  private readonly endpoint: string

  constructor(appKey: string, endpoint: string) {
    this.appKey = appKey
    this.endpoint = endpoint
  }

  /** Synchronous — returns immediately; queue drains asynchronously in the background. */
  enqueue(item: QueueItem['body']): void {
    this.queue.push({ body: item, attempts: 0 })
    if (!this.draining) {
      void this.drain()
    }
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
          Authorization: `Bearer ${this.appKey}`,
        },
        body: JSON.stringify(item.body),
      })
      return res.ok
    } catch {
      return false
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
