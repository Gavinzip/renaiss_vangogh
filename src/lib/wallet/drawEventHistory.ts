import type { DrawNetworkKey } from '../contracts/luckyDrawNetworks'

export type DrawChainTransactionKind = 'reset' | 'finalize' | 'request' | 'randomness' | 'reveal' | 'fulfilled'

export interface DrawChainEventTransaction {
  id: string
  hash: string
  kind: DrawChainTransactionKind
  status: 'confirmed'
  blockNumber: number
  logIndex: number
  transactionIndex: number
  slots: number[]
  ticketNumbers: string[]
  fulfilled?: boolean
}

export interface DrawChainRevealEvent {
  kind: 'reveal'
  name: string
  blockNumber: number
  logIndex: number
  transactionHash: string
  transactionIndex: number
  revealIndex: number
  prizeSlotIndex: number
  slotNumber: number
  ticketNumber: string
}

export interface DrawChainEventHistory {
  source: 'bscscan-v2'
  network: DrawNetworkKey
  contractAddress: string
  ledgerHash: string
  fromBlock: number
  roundStart: {
    blockNumber: number
    logIndex: number
    transactionHash: string
  } | null
  transactions: DrawChainEventTransaction[]
  revealEvents: DrawChainRevealEvent[]
  fetchedAt: number
}

export async function loadDrawEventHistory({
  networkKey,
  ledgerHash,
}: {
  networkKey: DrawNetworkKey
  ledgerHash: string
}) {
  const params = new URLSearchParams({ network: networkKey })
  if (ledgerHash) params.set('ledgerHash', ledgerHash)

  const response = await fetch(`/api/draw-events?${params.toString()}`, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || 'Could not load on-chain draw event history.')
  }
  if (!payload || !Array.isArray(payload.transactions)) {
    throw new Error('On-chain draw event history response was invalid.')
  }
  return payload as DrawChainEventHistory
}
