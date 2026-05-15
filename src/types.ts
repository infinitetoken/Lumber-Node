/** Configuration passed to LumberClient constructor. */
export interface LumberConfig {
  /** Bearer token for API authentication (API key from app settings). */
  token: string
  /** 32-byte symmetric key (base64) for AES-256-GCM encryption of the private log field. */
  key: string
  /** Lumber API base URL (no trailing path). Defaults to the official Lumber API. */
  endpoint?: string
}
