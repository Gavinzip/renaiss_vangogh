export const OPEN_MONITOR_URL = 'https://open-monitor-rmrm.pages.dev/api/lucky-draw/leaderboard'
export const WALLET_RESOLVE_URL = 'https://open-monitor-rmrm.pages.dev/api/wallet-migration/resolve'
export const WALLET_MIGRATIONS_URL = 'https://tcgpro.zeabur.app/api/wallet-migrations.json'
export const RENAISS_ACTIVITY_URL =
  'https://www.renaiss.xyz/api/trpc/activity.getSubgraphUserActivities'

export const CAMPAIGN_START = 1778743800
export const CAMPAIGN_END = 1781422200

export const BUYBACK_EVENT_TOPIC =
  '0xca4650c272ed248c5917e9ad8c3cca3b69d42f25071c9e6c85a2abc7427030cf'
export const LEGACY_PACK_OPEN_EVENT_TOPIC =
  '0xd505514c5f9bb134a66621a7fd46a679442a1a0e45f5ad5dff0724e4b4588fed'
export const COSTUME_PACK_ID =
  '0x6ab417f10cac2e525f9beb854e47a9672bbe06470014432b2cf271157c183332'
export const MAGMA_PACK_ID =
  '0x26a4c27796a0e13e0188178750ef4d8d1d3828eb1d7bfe02692bdbeeda1e677c'

export const PACK_WEIGHTS = {
  omega: 1,
  eden: 3,
  'costume-pack': 2,
  magma: 2,
}

export const PACK_EVENT_SOURCES = [
  {
    contract: '0x94e7732b0b2e7c51ffd0d56580067d9c2e2b7910',
    pack: 'omega',
    label: 'OMEGA buyback',
    ticketWeight: PACK_WEIGHTS.omega,
    eventTopic: BUYBACK_EVENT_TOPIC,
    eventKind: 'buyback-event',
  },
  {
    contract: '0xfda4a907d23d9f24271bc47483c5b983831e325e',
    pack: 'eden',
    label: 'EDEN buyback',
    ticketWeight: PACK_WEIGHTS.eden,
    eventTopic: BUYBACK_EVENT_TOPIC,
    eventKind: 'buyback-event',
  },
  {
    contract: '0xaab5f5fa75437a6e9e7004c12c9c56cda4b4885a',
    pack: 'costume-pack',
    label: 'Costume Pack buyback',
    ticketWeight: PACK_WEIGHTS['costume-pack'],
    eventTopic: LEGACY_PACK_OPEN_EVENT_TOPIC,
    topic2: COSTUME_PACK_ID,
    eventKind: 'legacy-pack-open',
  },
  {
    contract: '0xaab5f5fa75437a6e9e7004c12c9c56cda4b4885a',
    pack: 'magma',
    label: 'MAGMA buyback',
    ticketWeight: PACK_WEIGHTS.magma,
    eventTopic: LEGACY_PACK_OPEN_EVENT_TOPIC,
    topic2: MAGMA_PACK_ID,
    eventKind: 'legacy-pack-open',
  },
]

const PACK_CONTRACT_COUNTS = PACK_EVENT_SOURCES.reduce((counts, source) => {
  counts[source.contract] = (counts[source.contract] || 0) + 1
  return counts
}, {})

export const PACK_CONTRACTS = Object.fromEntries(
  PACK_EVENT_SOURCES.filter((source) => PACK_CONTRACT_COUNTS[source.contract] === 1).map((source) => [
    source.contract,
    source,
  ]),
)

export const LEGACY_PACK_IDS = {
  'legacy:0x6ab417f10cac2e525f9beb854e47a9672bbe06470014432b2cf271157c183332':
    'costume-pack',
  'legacy:0x26a4c27796a0e13e0188178750ef4d8d1d3828eb1d7bfe02692bdbeeda1e677c': 'magma',
}

export function getSbtTier(rawTickets) {
  if (rawTickets >= 600) return { sbt: 'rainbow', multiplier: 3 }
  if (rawTickets >= 250) return { sbt: 'gold', multiplier: 2 }
  if (rawTickets >= 100) return { sbt: 'silver', multiplier: 1.5 }
  if (rawTickets >= 40) return { sbt: 'brown', multiplier: 1.2 }
  return { sbt: 'none', multiplier: 1 }
}
