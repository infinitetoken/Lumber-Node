import { AsyncQueue } from '../queue'

const TOKEN = 'test-token'
const ENDPOINT = 'https://example.com'

function makeItem() {
  return { payload: Buffer.from('test').toString('base64'), level: 1 }
}

describe('AsyncQueue', () => {
  let fetchSpy: jest.SpyInstance

  afterEach(() => {
    fetchSpy?.mockRestore()
  })

  it('enqueue() returns synchronously before any fetch completes', () => {
    let fetchResolve: () => void
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((res) => {
          fetchResolve = () => res({ ok: true } as Response)
        })
    )
    const queue = new AsyncQueue(TOKEN, ENDPOINT)
    const start = Date.now()
    queue.enqueue(makeItem())
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(5)
    fetchResolve!()
  })

  it('removes item after successful send', async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response)
    const queue = new AsyncQueue(TOKEN, ENDPOINT)
    queue.enqueue(makeItem())
    // give the async drain a microtask turn to complete
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('retries and drops after maxAttempts without throwing', async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response)
    // Patch sleep to resolve immediately so test doesn't take 31 seconds
    // We do this by spying on the private sleep via prototype
    const sleepSpy = jest.spyOn(AsyncQueue.prototype as any, 'sleep').mockResolvedValue(undefined)
    const queue = new AsyncQueue(TOKEN, ENDPOINT)
    let threw = false
    try {
      queue.enqueue(makeItem())
      await new Promise((r) => setTimeout(r, 100))
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    // 5 attempts total
    expect(fetchSpy).toHaveBeenCalledTimes(5)
    sleepSpy.mockRestore()
  })

  it('handles fetch rejection without throwing to caller', async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    const sleepSpy = jest.spyOn(AsyncQueue.prototype as any, 'sleep').mockResolvedValue(undefined)
    const queue = new AsyncQueue(TOKEN, ENDPOINT)
    let threw = false
    try {
      queue.enqueue(makeItem())
      await new Promise((r) => setTimeout(r, 100))
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    sleepSpy.mockRestore()
  })

  describe('when Lumber refuses logs', () => {
    let warnSpy: jest.SpyInstance

    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      warnSpy.mockRestore()
    })

    const refused = (status: number, message: string, retryAfter?: string) =>
      ({
        ok: false,
        status,
        headers: { get: (name: string) => (name === 'Retry-After' ? (retryAfter ?? null) : null) },
        json: async () => ({ message })
      }) as unknown as Response

    it('stops at the monthly cap: warns once, drops what is queued and new logs until Retry-After', async () => {
      fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(refused(429, 'This team has sent its 10,000 logs for the month.', '3600'))
      const queue = new AsyncQueue(TOKEN, ENDPOINT)
      queue.enqueue(makeItem())
      queue.enqueue(makeItem())
      queue.enqueue(makeItem())
      await queue.flush()
      queue.enqueue(makeItem())
      await queue.flush()
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toContain('This team has sent its 10,000 logs for the month.')
    })

    it('sends again once the pause is over', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(refused(429, 'Over the cap.', '60'))
        .mockResolvedValue({ ok: true } as Response)
      const queue = new AsyncQueue(TOKEN, ENDPOINT)
      queue.enqueue(makeItem())
      await queue.flush()
      now.mockReturnValue(1_000_000 + 61_000)
      queue.enqueue(makeItem())
      await queue.flush()
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      now.mockRestore()
    })

    it('drops a log the API refuses for another reason without retrying', async () => {
      fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(refused(401, 'Invalid API key'))
      const queue = new AsyncQueue(TOKEN, ENDPOINT)
      queue.enqueue(makeItem())
      await queue.flush()
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toContain('HTTP 401 (Invalid API key)')
    })
  })
})
