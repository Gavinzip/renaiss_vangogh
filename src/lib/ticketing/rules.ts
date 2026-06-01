import type { PackCounts, PackKey, SbtTier } from './types'

export const CAMPAIGN_START = 1778743800
export const CAMPAIGN_END = 1781422200

export const PACK_WEIGHTS: Record<PackKey, number> = {
  omega: 1,
  'costume-pack': 2,
}

export const PACK_LABELS: Record<PackKey, string> = {
  omega: 'OMEGA',
  'costume-pack': 'Costume Pack',
}

export const PACK_CONTRACTS: Record<string, PackKey> = {
  '0x94e7732b0b2e7c51ffd0d56580067d9c2e2b7910': 'omega',
  '0xaab5f5fa75437a6e9e7004c12c9c56cda4b4885a': 'costume-pack',
}

export const LEGACY_PACK_IDS: Record<string, PackKey> = {
  'legacy:0x6ab417f10cac2e525f9beb854e47a9672bbe06470014432b2cf271157c183332':
    'costume-pack',
}

export const ZERO_PACK_COUNTS: PackCounts = {
  omega: 0,
  'costume-pack': 0,
}

export const SBT_TIERS: Array<{ tier: SbtTier; threshold: number; multiplier: number }> = [
  { tier: 'rainbow', threshold: 600, multiplier: 3 },
  { tier: 'gold', threshold: 250, multiplier: 2 },
  { tier: 'silver', threshold: 100, multiplier: 1.5 },
  { tier: 'brown', threshold: 40, multiplier: 1.2 },
]

export const SBT_LABELS: Record<SbtTier, string> = {
  none: 'No bonus',
  brown: 'Brown',
  silver: 'Silver',
  gold: 'Gold',
  rainbow: 'Rainbow',
}

export function normalizeAddress(value: string | null | undefined): string {
  const text = String(value || '').trim().toLowerCase()
  return /^0x[a-f0-9]{40}$/.test(text) ? text : ''
}

export function normalizeHash(value: string | null | undefined): string {
  const text = String(value || '').trim().toLowerCase()
  return /^0x[a-f0-9]{64}$/.test(text) ? text : ''
}

export function emptyPackCounts(): PackCounts {
  return { ...ZERO_PACK_COUNTS }
}

export function getSbtTier(rawTickets: number): { tier: SbtTier; multiplier: number } {
  const raw = Math.max(0, Math.floor(rawTickets || 0))
  const match = SBT_TIERS.find((row) => raw >= row.threshold)
  return match ? { tier: match.tier, multiplier: match.multiplier } : { tier: 'none', multiplier: 1 }
}

export function calculateRawTickets(packs: PackCounts): number {
  return (Object.keys(PACK_WEIGHTS) as PackKey[]).reduce((sum, pack) => {
    return sum + Math.max(0, Math.floor(packs[pack] || 0)) * PACK_WEIGHTS[pack]
  }, 0)
}

export function calculateFinalTickets(rawTickets: number, multiplier: number): number {
  return Math.ceil(Math.max(0, rawTickets || 0) * Math.max(1, multiplier || 1))
}

export function packFromContract(contractAddress: string | null | undefined): PackKey | null {
  const address = normalizeAddress(contractAddress)
  return address ? PACK_CONTRACTS[address] ?? null : null
}

export function packFromLegacyId(value: string | null | undefined): PackKey | null {
  const key = String(value || '').trim().toLowerCase()
  return LEGACY_PACK_IDS[key] ?? null
}

export function packFromActivity(value: {
  contractAddress?: string | null
  packId?: string | null
  itemName?: string | null
}): PackKey | null {
  const byContract = packFromContract(value.contractAddress)
  if (byContract) return byContract
  const byLegacy = packFromLegacyId(value.packId)
  if (byLegacy) return byLegacy

  const name = String(value.itemName || '').toLowerCase()
  if (name.includes('omega')) return 'omega'
  if (name.includes('costume')) return 'costume-pack'
  return null
}

export function formatSbtTier(tier: SbtTier, multiplier: number): string {
  if (tier === 'none') return SBT_LABELS.none
  return `${SBT_LABELS[tier]} x${multiplier}`
}

export function formatAddress(value: string): string {
  const address = normalizeAddress(value)
  if (!address) return '-'
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function formatTicketRange(start: number | null, end: number | null): string {
  if (!start || !end) return '-'
  if (start === end) return `#${start.toLocaleString()}`
  return `#${start.toLocaleString()}-${end.toLocaleString()}`
}

export function formatDateTime(timestampSeconds: number | null | undefined): string {
  const ts = Number(timestampSeconds || 0)
  if (!Number.isFinite(ts) || ts <= 0) return '-'
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts * 1000))
}
