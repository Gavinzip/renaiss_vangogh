export type IdentityLookupKind = 'address' | 'username' | 'twitter' | 'discord'

export interface IdentityRecord {
  username: string | null
  linkedTwitter: string | null
  linkedDiscord: string | null
}

export interface IdentitySuggestion {
  kind: IdentityLookupKind
  label: string
  value: string
  detail: string
  addressCount: number
  sampleAddress: string
}

export interface IdentityResolution {
  kind: IdentityLookupKind
  query: string
  addresses: string[]
  identity: IdentityRecord | null
}

export interface IdentityIndex {
  meta: Record<string, unknown>
}

export function readIdentityIndex(identityPath: string): IdentityIndex | null
export function identityForAddress(index: IdentityIndex | null, address: string): IdentityRecord | null
export function resolveIdentityQuery(index: IdentityIndex | null, query: string): IdentityResolution | null
export function suggestIdentityQueries(index: IdentityIndex | null, query: string, limit?: number): IdentitySuggestion[]
