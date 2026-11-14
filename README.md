# @infinitetoken/lumber

Node.js client for [Lumber](https://lumber.infinitetoken.com): cloud logging with full E2E encryption and an async queue. Its one runtime dependency is `@infinitetoken/lumber-kit`, Lumber's shared types and constants package, which has no dependencies of its own. Encryption and delivery use Node's built-in `crypto` and `fetch`.

All log content is encrypted with AES-256-GCM before leaving the process. The API stores only the ciphertext plus each log's level (kept unencrypted for filtering and push alerts), so it cannot read your logs.

Logs are viewed in the [Lumber app](https://lumber.infinitetoken.com/download) for iPhone, iPad, Mac, Windows and Linux, which decrypts them on your device, or read from the terminal and by AI agents with [the lumber command](https://lumber.infinitetoken.com/docs/cli). Full docs are at [lumber.infinitetoken.com/docs](https://lumber.infinitetoken.com/docs/getting-started).

## Installation

```bash
npm install @infinitetoken/lumber
```

## Quick start

Call `lumber.config()` once at app startup. Every other import in your project shares the same configured client automatically.

> **Warning:** Calling `lumber.config()` a second time replaces the client immediately. Logs still queued in the previous client keep sending in the background, but `lumber.flush()` only waits for the new client's queue. Call `await lumber.flush()` before reconfiguring if you need to be sure they're delivered.

```js
// ESM
import lumber from '@infinitetoken/lumber'

// CJS
const { default: lumber } = require('@infinitetoken/lumber')

lumber.config({
  apiKey: process.env.LUMBER_API_KEY, // from your app's Secrets screen in Lumber
})

lumber.info('Server started', { port: 3000 })
lumber.warn('Rate limit approaching', { requestId: 'req-123', metadata: { userId: '456' } })
lumber.error('Payment failed', { traceId: 'trace-abc', orderId: '789' })

// Drain the queue before process exit
await lumber.flush()
```

## Getting your API key

Create an app in the Lumber app, and it takes you straight to adding an API key. The key is shown only once, so copy it right away. Any device holding the app's key can add more from the app's **Secrets** screen, one per deployment if you like, each deleted on its own.

An API key is two values joined by a dot: a token, then the app's encryption key, which the app generates on your device when you create the app. The plugin sends only the token to Lumber's API and encrypts every log with the rest, so the encryption key never leaves your process. Beyond your devices and your servers, it only exists wrapped (encrypted) to the account key of each person with access to the app, so Lumber's servers can't read it. Teammates and guests you share the app with get the key automatically, end-to-end encrypted, once anyone who already has it opens Lumber.

## Log methods

| Method | Level |
|--------|-------|
| `lumber.debug(message, data?)` | Debug |
| `lumber.info(message, data?)` | Info |
| `lumber.log(message, data?)` | Info (alias) |
| `lumber.warn(message, data?)` | Warn |
| `lumber.error(message, data?)` | Error |
| `lumber.fatal(message, data?)` | Fatal |
| `lumber.flush(timeoutMs?)` | Waits for the queue to drain: resolves `true` once every log is sent or dropped, `false` if `timeoutMs` passes first |

## LogData

The second argument is an optional `LogData` object. Named fields are routed to specific parts of the encrypted payload; any other keys are merged into `metadata`.

```ts
lumber.info('User action', {
  requestId: 'req-abc',          // → payload.requestId
  traceId:   'trace-xyz',        // → payload.traceId
  context:   { code: 'app.ts' }, // → payload.context (merged with auto-context)
  metadata:  { version: 2 },     // → payload.metadata
  userId:    '123',              // → payload.metadata.userId (extra key)
  action:    'login',            // → payload.metadata.action (extra key)
})
```

Explicit `metadata` keys win over colliding extra keys. A `context` or `metadata` that isn't an object (a string, an array) is kept as an ordinary key in `metadata`, so `{ context: 'billing' }` lands as `metadata.context`. The entire payload (including `message`, `requestId`, `context`, and `metadata`) is encrypted before it leaves the process.

## Config

```ts
lumber.config({
  apiKey:         string,  // API key from the app's Secrets screen in Lumber (token.encryptionKey)
  endpoint?:      string,  // override API base URL (default: official Lumber API)
  timeout?:       number,  // ms to wait for Lumber to answer one log (default 10000)
  console?:       boolean | ConsoleConfig,
  context?:       boolean | ContextConfig,
})
```

### Console mirroring

Echo logs to the terminal as they are enqueued.

```js
// Simple: all levels, badge only
lumber.config({ ..., console: true })

// Fine-grained
lumber.config({
  ...,
  console: {
    levels:    { warn: true, error: true, fatal: true }, // omit = all levels
    prefix:    true,      // show [LEVEL] badge (default: true)
    color:     true,      // ANSI color when TTY (default: true, auto-detected)
    data:      true,      // append metadata/context as second console arg
    pretty:    true,      // pretty-print data with indentation (implies data)
    timestamp: true,      // prepend HH:MM:SS.mmm timestamp
    // timestamp: 'time'     → HH:MM:SS.mmm (same as true)
    // timestamp: 'iso'      → full ISO 8601
    // timestamp: 'relative' → +1.234s since process start
  },
})
```

Example output with `timestamp: true`:

```
14:32:01.000 [DEBUG] Cache miss
14:32:02.105 [INFO]  User signed in
14:32:03.820 [WARN]  Rate limit approaching
14:32:05.001 [ERROR] Payment failed
14:32:05.002 [FATAL] DB connection lost
```

### Auto-context

Lumber captures `pid`, `hostname`, and `NODE_ENV` once at `config()` time and attaches them to every log's encrypted payload. No per-call overhead.

```js
// Default: on
lumber.config({ ... })

// Disable entirely
lumber.config({ ..., context: false })

// Also capture file/line/column from the call site
lumber.config({ ..., context: { caller: true } })

// If lumber is wrapped in a project-level logger, shift the stack frame
lumber.config({ ..., context: { caller: true, callerDepth: 1 } })
```

User-supplied `context` in `LogData` is merged on top of auto-context, so you can always override specific fields per call.

## Queue behavior

Logs are enqueued in memory and sent sequentially in the background, one `POST /logs` request per log. A network error, a 5xx response or no answer within `timeout` (10 seconds unless set) counts as a failed attempt: each log gets up to 5 attempts, waiting 1 s, 2 s, 4 s, then 8 s between them, and after the fifth failure it's dropped with a console warning. A log Lumber refuses (a 4xx, such as an invalid API key, or a 413 for a log over 16 KB once encrypted) is dropped at once with a warning, since sending it again won't help. Errors always get through: past your team's monthly logs, Lumber still takes error and fatal logs, and answers the rest 200 without keeping them, so the plugin carries on with no warning (the Lumber app shows when your team is at its limit). At twice your team's monthly logs Lumber answers 429: the plugin warns once and drops logs until the month turns (the response's `Retry-After`), rather than queueing them. Call `flush()` before process exit to ensure all queued logs are delivered; `flush(5000)` waits at most 5 seconds and resolves `false` if logs were still queued then. These rules, and how a log's data becomes its encrypted payload, come from `@infinitetoken/lumber-kit`, whose contract Lumber's Python and Go clients are tested against too.

```js
process.on('SIGINT', async () => {
  await lumber.flush()
  process.exit(0)
})
```

## Serverless

A serverless platform can freeze or stop a function as soon as it responds, with logs still queued. Keep the function running until they're sent with the platform's own hook, giving `flush()` a time limit so a slow answer can't hold the function to its maximum duration. On Vercel, with `waitUntil` from `@vercel/functions`:

```js
import { waitUntil } from '@vercel/functions'

export default async function handler(req, res) {
  lumber.info('Handled request', { path: req.url })
  res.send('ok')
  waitUntil(lumber.flush(10_000))
}
```

Where there's no such hook (AWS Lambda), `await lumber.flush(10_000)` before returning.

## Power users: multiple instances

`LumberClient` is exported for cases where you need more than one configured instance.

```ts
import { LumberClient } from '@infinitetoken/lumber'

const client = new LumberClient({ apiKey, console: true })
client.info('hello')
await client.flush()
```

## Requirements

Node 18 or later (uses the built-in `fetch`).

## License

MIT. See the `LICENSE` file included in the package.
