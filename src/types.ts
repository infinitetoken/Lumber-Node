/** Configuration passed to LumberClient constructor. */
export interface LumberConfig {
  /** App bearer token from POST /apps response. */
  token: string
  /** Base64-encoded 32-byte AES-256-GCM key from POST /apps response (displayed once). */
  key: string
  /** Lumber API base URL, e.g. https://lumber-api.vercel.app/logs. Defaults to the official Lumber API. */
  endpoint?: string
}
