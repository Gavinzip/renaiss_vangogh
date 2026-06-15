import { id, Interface } from 'ethers'
import { fetchLogsWindow } from './bscscan.mjs'

const EVENT_ABI = [
  'event LedgerFinalized(bytes32 indexed ledgerHash, uint256 totalTickets, uint256 prizeSlotCount, string ledgerUri)',
  'event DrawRequested(uint256 indexed requestId, address indexed caller)',
  'event RandomnessFulfilled(uint256 indexed requestId, uint256 randomWord)',
  'event PrizeWinnerDrawn(uint256 indexed revealIndex, uint256 indexed prizeSlotIndex, uint256 ticketNumber)',
  'event DrawFulfilled(uint256 indexed requestId, uint256 randomWord, uint256[] winnerTickets)',
  'event RoundReset()',
]

const eventInterface = new Interface(EVENT_ABI)
const pageSize = 1000

export const DRAW_EVENT_NETWORKS = {
  testnet: {
    key: 'testnet',
    label: 'BSC Testnet',
    chainId: 97,
    contractAddress: '0x01970483eC82b666F4E1c5824D9aB5DE1797d372',
    deploymentBlock: 113363119,
  },
  mainnet: {
    key: 'mainnet',
    label: 'BSC Mainnet',
    chainId: 56,
    contractAddress: '0x0C7c73F527D407aA6AEB8721F7C30C6b2AAF5484',
    deploymentBlock: 104218834,
  },
}

const EVENT_TOPICS = {
  finalize: id('LedgerFinalized(bytes32,uint256,uint256,string)'),
  request: id('DrawRequested(uint256,address)'),
  randomness: id('RandomnessFulfilled(uint256,uint256)'),
  reveal: id('PrizeWinnerDrawn(uint256,uint256,uint256)'),
  fulfilled: id('DrawFulfilled(uint256,uint256,uint256[])'),
  reset: id('RoundReset()'),
}

const EVENT_KIND_BY_NAME = {
  LedgerFinalized: 'finalize',
  DrawRequested: 'request',
  RandomnessFulfilled: 'randomness',
  PrizeWinnerDrawn: 'reveal',
  DrawFulfilled: 'fulfilled',
  RoundReset: 'reset',
}

export class DrawEventHistoryConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DrawEventHistoryConfigError'
  }
}

export function drawEventNetworkForKey(value) {
  return DRAW_EVENT_NETWORKS[value] ?? null
}

export function drawEventBscscanConfigForNetwork(network, env = process.env) {
  const apiKey = env.BSCSCAN_API_KEY || env.ETHERSCAN_API_KEY || env.ONCHAIN_API_KEY || ''
  if (!apiKey) {
    throw new DrawEventHistoryConfigError('BSCSCAN_API_KEY is required to load on-chain draw event history.')
  }

  return {
    apiUrl: env.BSCSCAN_API_URL || env.ONCHAIN_API_URL || 'https://api.etherscan.io/v2/api',
    apiKey,
    chainId: network.chainId,
    retries: Math.max(1, Number(env.LUCKY_DRAW_EVENT_RETRIES || env.LUCKY_DRAW_RETRIES || 4)),
    backoffMs: Math.max(1, Number(env.LUCKY_DRAW_EVENT_BACKOFF_MS || env.LUCKY_DRAW_BACKOFF_MS || 1000)),
    requestTimeoutMs: Math.max(1, Number(env.LUCKY_DRAW_EVENT_TIMEOUT_MS || env.BSCSCAN_REQUEST_TIMEOUT_MS || 30_000)),
  }
}

export async function fetchDrawEventHistory({ network, ledgerHash = '', bscscanConfig }) {
  const normalizedLedgerHash = normalizeLedgerHash(ledgerHash)
  const roundStart = normalizedLedgerHash
    ? await findLatestRoundStart({ network, ledgerHash: normalizedLedgerHash, bscscanConfig })
    : null
  const fromBlock = roundStart?.blockNumber ?? network.deploymentBlock
  const topicLogs = await Promise.all(
    Object.values(EVENT_TOPICS).map((topic0) =>
      fetchAllTopicLogs(bscscanConfig, {
        address: network.contractAddress,
        fromBlock,
        toBlock: 'latest',
        topic0,
      }),
    ),
  )
  const logs = topicLogs
    .flat()
    .filter((log) => !roundStart || compareLogPosition(readLogPosition(log), roundStart) >= 0)
    .sort((left, right) => compareLogPosition(readLogPosition(left), readLogPosition(right)))

  const decodedEvents = logs.flatMap((log) => decodeDrawEvent(log))
  const transactions = buildDrawEventTransactions(decodedEvents)

  return {
    source: 'bscscan-v2',
    network: network.key,
    contractAddress: network.contractAddress,
    ledgerHash: normalizedLedgerHash,
    fromBlock,
    roundStart,
    transactions,
    revealEvents: decodedEvents.filter((event) => event.kind === 'reveal'),
    fetchedAt: Date.now(),
  }
}

async function findLatestRoundStart({ network, ledgerHash, bscscanConfig }) {
  const logs = await fetchAllTopicLogs(bscscanConfig, {
    address: network.contractAddress,
    fromBlock: network.deploymentBlock,
    toBlock: 'latest',
    topic0: EVENT_TOPICS.finalize,
    topic1: ledgerHash,
  })
  const sortedLogs = logs.sort((left, right) => compareLogPosition(readLogPosition(left), readLogPosition(right)))
  const latestLog = sortedLogs.at(-1)
  if (!latestLog) return null

  return {
    blockNumber: readBlockNumber(latestLog),
    logIndex: readLogIndex(latestLog),
    transactionHash: latestLog.transactionHash,
  }
}

async function fetchAllTopicLogs(config, params) {
  const logs = []
  for (let page = 1; ; page += 1) {
    const batch = await fetchLogsWindow(config, {
      ...params,
      page,
      offset: pageSize,
    })
    logs.push(...batch)
    if (batch.length < pageSize) break
  }
  return logs
}

function decodeDrawEvent(log) {
  try {
    const parsed = eventInterface.parseLog({
      data: log.data || '0x',
      topics: log.topics || [],
    })
    if (!parsed) return []

    const kind = EVENT_KIND_BY_NAME[parsed.name]
    if (!kind) return []

    const baseEvent = {
      kind,
      name: parsed.name,
      blockNumber: readBlockNumber(log),
      logIndex: readLogIndex(log),
      transactionHash: log.transactionHash,
      transactionIndex: readTransactionIndex(log),
    }

    if (parsed.name === 'LedgerFinalized') {
      return [
        {
          ...baseEvent,
          ledgerHash: String(parsed.args.ledgerHash),
          totalTickets: numericString(parsed.args.totalTickets),
          prizeSlotCount: numericString(parsed.args.prizeSlotCount),
        },
      ]
    }

    if (parsed.name === 'DrawRequested') {
      return [
        {
          ...baseEvent,
          requestId: numericString(parsed.args.requestId),
          caller: String(parsed.args.caller),
        },
      ]
    }

    if (parsed.name === 'RandomnessFulfilled') {
      return [
        {
          ...baseEvent,
          requestId: numericString(parsed.args.requestId),
        },
      ]
    }

    if (parsed.name === 'PrizeWinnerDrawn') {
      const prizeSlotIndex = safeNumber(parsed.args.prizeSlotIndex)
      return [
        {
          ...baseEvent,
          revealIndex: safeNumber(parsed.args.revealIndex),
          prizeSlotIndex,
          slotNumber: prizeSlotIndex + 1,
          ticketNumber: numericString(parsed.args.ticketNumber),
        },
      ]
    }

    if (parsed.name === 'DrawFulfilled') {
      return [
        {
          ...baseEvent,
          requestId: numericString(parsed.args.requestId),
          winnerTickets: Array.from(parsed.args.winnerTickets ?? []).map(numericString),
        },
      ]
    }

    return [baseEvent]
  } catch {
    return []
  }
}

function buildDrawEventTransactions(events) {
  const transactionMap = new Map()
  for (const event of events) {
    const key = event.transactionHash
    const current =
      transactionMap.get(key) ??
      {
        id: `chain-${key}`,
        hash: key,
        kind: event.kind,
        status: 'confirmed',
        blockNumber: event.blockNumber,
        logIndex: event.logIndex,
        transactionIndex: event.transactionIndex,
        slots: [],
        ticketNumbers: [],
      }

    if (event.kind === 'reveal') {
      current.kind = 'reveal'
      current.slots.push(event.slotNumber)
      current.ticketNumbers.push(event.ticketNumber)
    } else if (current.kind !== 'reveal') {
      current.kind = event.kind
    }

    if (event.kind === 'fulfilled') current.fulfilled = true
    current.blockNumber = Math.min(current.blockNumber, event.blockNumber)
    current.logIndex = Math.min(current.logIndex, event.logIndex)
    transactionMap.set(key, current)
  }

  return Array.from(transactionMap.values())
    .map((transaction) => ({
      ...transaction,
      slots: sortUniqueNumbers(transaction.slots),
      ticketNumbers: Array.from(new Set(transaction.ticketNumbers)),
    }))
    .sort((left, right) => {
      if (left.blockNumber !== right.blockNumber) return left.blockNumber - right.blockNumber
      if (left.transactionIndex !== right.transactionIndex) return left.transactionIndex - right.transactionIndex
      return left.logIndex - right.logIndex
    })
}

function normalizeLedgerHash(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error('ledgerHash must be a 32-byte hex string.')
  }
  return trimmed.toLowerCase()
}

function readLogPosition(log) {
  return {
    blockNumber: readBlockNumber(log),
    logIndex: readLogIndex(log),
    transactionHash: log.transactionHash,
  }
}

function compareLogPosition(left, right) {
  if (left.blockNumber !== right.blockNumber) return left.blockNumber - right.blockNumber
  return left.logIndex - right.logIndex
}

function readBlockNumber(log) {
  return safeNumber(log.blockNumber)
}

function readLogIndex(log) {
  return safeNumber(log.logIndex)
}

function readTransactionIndex(log) {
  return safeNumber(log.transactionIndex)
}

function numericString(value) {
  return BigInt(value.toString()).toString()
}

function safeNumber(value) {
  const parsed = typeof value === 'number' ? BigInt(value) : BigInt(String(value || 0))
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Value exceeds safe integer range: ${parsed.toString()}`)
  }
  return Number(parsed)
}

function sortUniqueNumbers(values) {
  return Array.from(new Set(values)).sort((left, right) => left - right)
}
