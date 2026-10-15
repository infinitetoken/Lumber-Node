# @infinitetoken/lumber

Node.js client for Lumber: cloud logging with full E2E encryption and an async queue. Its one runtime dependency is `@infinitetoken/lumber-kit`, Lumber's shared types and constants package, which has no dependencies of its own. Encryption and delivery use Node's built-in `crypto` and `fetch`.

All log content is encrypted with AES-256-GCM before leaving the process. The API stores only the ciphertext plus each log's level (kept unencrypted for filtering and push alerts), so it cannot read your logs.

Logs are viewed in the Lumber mobile app for iOS and Android, which decrypts them on your device. The app is coming soon to the App Store.

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
  apiKey:        process.env.LUMBER_API_KEY,
  encryptionKey: process.env.LUMBER_ENCRYPTION_KEY, // required: 32-byte key, base64-encoded
})

lumber.info('Server started', { port: 3000 })
lumber.warn('Rate limit approaching', { requestId: 'req-123', metadata: { userId: '456' } })
lumber.error('Payment failed', { traceId: 'trace-abc', orderId: '789' })

// Drain the queue before process exit
await lumber.flush()
```

## Getting your keys

Both values come from the Lumber mobile app:

1. Create an app in Lumber. The app generates its encryption key on your device and shows it once on the **Your Encryption Key** screen, with a copy button. You can copy it again later from the app's **Secrets** screen on any of your devices that holds the key.
2. On the app's **Secrets** screen, add an API key. It's shown only once, so copy it right away.

The encryption key never leaves your devices except wrapped (encrypted) to the account key of each person with access to the app, so Lumber's servers can't read it. Teammates and guests you share the app with get the key automatically, end-to-end encrypted, once anyone who already has it opens Lumber. No copy-pasting needed.

## Log methods

| Method | Level |
|--------|-------|
| `lumber.debug(message, data?)` | Debug |
| `lumber.info(message, data?)` | Info |
| `lumber.log(message, data?)` | Info (alias) |
| `lumber.warn(message, data?)` | Warn |
| `lumber.error(message, data?)` | Error |
| `lumber.fatal(message, data?)` | Fatal |
| `lumber.flush()` | Returns `Promise<void>`, waits for queue to drain |

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

Explicit `metadata` keys win over colliding extra keys. The entire payload (including `message`, `requestId`, `context`, and `metadata`) is encrypted before it leaves the process.

## Config

```ts
lumber.config({
  apiKey:        string,  // API key from the app's Secrets screen in Lumber
  encryptionKey: string,  // 32-byte AES key, base64-encoded, required
  endpoint?:     string,  // override API base URL (default: official Lumber API)
  console?:      boolean | ConsoleConfig,
  context?:      boolean | ContextConfig,
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

Logs are enqueued in memory and sent sequentially in the background, one `POST /logs` request per log. A network error or any non-2xx response counts as a failed attempt. Each log gets up to 5 attempts, waiting 1 s, 2 s, 4 s, then 8 s between them; after the fifth failure the log is dropped with a console warning. Call `flush()` before process exit to ensure all queued logs are delivered.

```js
process.on('SIGINT', async () => {
  await lumber.flush()
  process.exit(0)
})
```

## Power users: multiple instances

`LumberClient` is exported for cases where you need more than one configured instance.

```ts
import { LumberClient } from '@infinitetoken/lumber'

const client = new LumberClient({ apiKey, encryptionKey, console: true })
client.info('hello')
await client.flush()
```

## Requirements

Node 18 or later (uses the built-in `fetch`).

## License

MIT. See the `LICENSE` file included in the package.
