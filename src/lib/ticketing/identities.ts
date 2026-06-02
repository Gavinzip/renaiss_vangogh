export interface WalletIdentity {
  username: string | null
  linkedTwitter: string | null
  linkedDiscord: string | null
}

export type WalletIdentityMap = Record<string, WalletIdentity>

interface WalletIdentitiesPayload {
  identities?: WalletIdentityMap
}

const WALLET_IDENTITIES_URL = '/lucky-draw-identities.json'

export async function loadWalletIdentities(): Promise<WalletIdentityMap> {
  const response = await fetch(WALLET_IDENTITIES_URL, { cache: 'no-store' })
  if (!response.ok) return {}

  const payload = (await response.json()) as WalletIdentitiesPayload
  return payload.identities ?? {}
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}
