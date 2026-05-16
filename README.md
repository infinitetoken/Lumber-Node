# @infinitetoken/lumber

Node.js client for [Lumber](https://www.infinitetoken.com/apps/lumber) — cloud logging with AES-256-GCM encrypted private fields, async queue, and zero runtime dependencies.

## Installation

```bash
npm install @infinitetoken/lumber
```

## Quick start

Call `lumber.config()` once at app startup. Every other import in your project shares the same configured client automatically.

> **Warning:** Calling `lumber.config()` a second time replaces the client immediately. Any logs queued in the previous client that have not yet been sent are silently dropped. Call `await lumber.flush()` before reconfiguring if you need to preserve them.

```js
// ESM
import lumber from '@infinitetoken/lumber'

// CJS
const { default: lumber } = require('@infinitetoken/lumber')

lumber.config({
  apiKey:        process.env.LUMBER_API_KEY,
  encryptionKey: process.env.LUMBER_ENCRYPTION_KEY, // optional — only needed if you use the private field
})

lumber.info('Server started', { port: 3000 })
lumber.warn('Rate limit approaching', { flagged: true, userId: '123' })
lumber.error('Payment failed', { context: { traceId: 'abc' }, orderId: '456' })

// Drain the queue before process exit
await lumber.flush()
```

## Log methods

| Method | Level |
|--------|-------|
| `lumber.debug(message, data?)` | Debug |
| `lumber.info(message, data?)` | Info |
| `lumber.log(message, data?)` | Info (alias) |
| `lumber.warn(message, data?)` | Warn |
| `lumber.error(message, data?)` | Error |
| `lumber.fatal(message, data?)` | Fatal |
| `lumber.flush()` | Returns `Promise<void>` — waits for queue to drain |

## LogData

The second argument is an optional `LogData` object. Named fields are routed to specific parts of the wire payload; any other keys are merged into `metadata`.

```ts
lumber.info('User action', {
  flagged:  true,                   // → body.flagged
  context:  { traceId: 'abc' },     // → body.context (merged with auto-context)
  private:  { ssn: '000-00-0000' }, // → encrypted body.private
  metadata: { version: 2 },         // → body.metadata
  userId:   '123',                  // → body.metadata.userId (extra key)
  action:   'login',                // → body.metadata.action (extra key)
})
```

Explicit `metadata` keys win over colliding extra keys.

## Config

```ts
lumber.config({
  apiKey:         string,   // API key from Lumber app settings
  encryptionKey?: string,   // 32-byte AES key, base64-encoded — required only if using the private field
  endpoint?:      string,   // override API base URL (default: official Lumber API)
  console?:       boolean | ConsoleConfig,
  context?:       boolean | ContextConfig,
})
```

### Console mirroring

Echo logs to the terminal as they are enqueued.

```js
// Simple — all levels, badge only
lumber.config({ ..., console: true })

// Fine-grained
lumber.config({
  ...,
  console: {
    levels:     { warn: true, error: true, fatal: true }, // omit = all levels
    prefix:     true,      // show [LEVEL] badge (default: true)
    color:      true,      // ANSI color when TTY (default: true, auto-detected)
    data:       true,      // append metadata/context as second console arg
    pretty:     true,      // pretty-print data with indentation (implies data)
    timestamp:  true,      // prepend HH:MM:SS.mmm timestamp
    // timestamp: 'time'      → HH:MM:SS.mmm (same as true)
    // timestamp: 'iso'       → full ISO 8601
    // timestamp: 'relative'  → +1.234s since process start
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

Lumber captures `pid`, `hostname`, and `NODE_ENV` once at `config()` time and attaches them to every log. No per-call overhead.

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

### Private field encryption

Any value passed as `private` in `LogData` is encrypted client-side with AES-256-GCM before leaving the process. The plaintext never reaches the API.

```js
lumber.info('User updated', {
  private: { email: 'user@example.com', ip: '1.2.3.4' },
})
```

The `encryptionKey` in your config must be a base64-encoded 32-byte symmetric key. Keep it out of source control — it is required to decrypt logs in the Lumber app.

Generate a key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Sensitive key protection

Lumber automatically detects common sensitive keys in metadata (`password`, `token`, `email`, `ssn`, `creditCard`, etc.) and acts on them based on your config.

**Default behavior:**
- `encryptionKey` present → `'encrypt'` — silently moves matching keys into the encrypted private field
- No `encryptionKey` → `'redact'` — replaces the value with `'[redacted]'` in metadata

```js
// Simple string form
lumber.config({ ..., sensitiveKeys: 'warn' })    // always warn
lumber.config({ ..., sensitiveKeys: 'redact' })  // replace value with '[redacted]'
lumber.config({ ..., sensitiveKeys: 'encrypt' }) // move to encrypted private field
lumber.config({ ..., sensitiveKeys: false })     // disable entirely

// Object form — fine-grained control
lumber.config({
  ...,
  sensitiveKeys: {
    behavior: 'redact',                           // omit = same smart default
    add:    ['legacyPin', 'internalToken'],        // extend the built-in list
    ignore: ['email'],                            // remove from the built-in list
  },
})
```

Built-in list covers: `password`, `secret`, `token`, `apiKey`, `privateKey`, `sessionId`, `otp`, `mfa`, `ssn`, `creditCard`, `cvv`, `email`, `phone`, `dob`, `connectionString`, and common variants/casing.

Key names are normalized before matching — `access_token`, `accessToken`, and `ACCESSTOKEN` all match `accesstoken`.

## Queue behavior

Logs are enqueued in memory and sent sequentially in the background. Failed sends are retried up to 5 times with exponential backoff (1 s → 2 s → 4 s → 8 s). Call `flush()` before process exit to ensure all queued logs are delivered.

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

Node 18.17 or later.

## License

MIT — [See LICENSE](https://github.com/infinitetoken/Lumber-Node/blob/master/LICENSE)
