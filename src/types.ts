/** Configuration passed to LumberClient constructor. */
export interface LumberConfig {
  /** X25519 public key (base64) from POST /apps response — used as both app identifier and encryption key. */
  key: string
  /** Lumber API base URL, e.g. https://lumber-api.vercel.app/logs. Defaults to the official Lumber API. */
  endpoint?: string
}
