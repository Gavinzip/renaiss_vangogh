import { createRenaissActivityFetcher } from './activity-source.mjs'
import { blockByTimestamp, fetchLogsWindow } from './bscscan.mjs'
import { readJsonCache, writeJsonCache } from './cache.mjs'
import { CAMPAIGN_END, CAMPAIGN_START, PACK_EVENT_SOURCES } from './rules.mjs'
import {
  hexToBigIntText,
  mapWithConcurrency,
  normalizeAddress,
  normalizeHash,
  toNumber,
  topicToAddress,
} from './utils.mjs'

const BUYBACK_ACTIVITY_TYPES = new Set(['PerpetualBuybackActivity', 'BuybackActivity'])

function sourceCacheKey(source) {
  return [
    source.contract,
    source.eventTopic,
    source.topic1 || '',
    source.topic2 || '',
    source.topic3 || '',
    source.pack,
    source.ticketWeight,
    source.eventKind === 'legacy-pack-open' ? 'checkout-v2' : '',
    CAMPAIGN_START,
    CAMPAIGN_END,
  ].join('|')
}

function eventKey(event) {
  return `${event.contractAddress}:${event.txHash}:${event.logIndex}`
}

function sortEvents(events) {
  return events.sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) return left.blockNumber - right.blockNumber
    if (left.transactionIndex !== right.transactionIndex) return left.transactionIndex - right.transactionIndex
    if (left.logIndex !== right.logIndex) return left.logIndex - right.logIndex
    if (left.txHash !== right.txHash) return left.txHash.localeCompare(right.txHash)
    return left.id.localeCompare(right.id)
  })
}

function dedupeEvents(events) {
  const byKey = new Map()
  for (const event of events) byKey.set(eventKey(event), event)
  return sortEvents([...byKey.values()])
}

function decodeBuybackEventLog(log, contractConfig) {
  const topics = Array.isArray(log.topics) ? log.topics : []
  const userAddress = topicToAddress(topics[1])
  const txHash = normalizeHash(log.transactionHash)
  if (!userAddress || !txHash) return null

  const data = String(log.data || '').replace(/^0x/, '')
  const words = data.match(/.{1,64}/g) || []
  const paymentToken = words[0] ? normalizeAddress(`0x${words[0].slice(-40)}`) : ''
  const priceInUsdt = words[1] ? BigInt(`0x${words[1]}`).toString() : null
  const fmvPriceInUsd = words[2] ? BigInt(`0x${words[2]}`).toString() : null

  return {
    id: `${txHash}-${toNumber(log.logIndex)}`,
    canonicalAddress: userAddress,
    sourceAddress: userAddress,
    txHash,
    timestamp: toNumber(log.timeStamp),
    blockNumber: toNumber(log.blockNumber),
    transactionIndex: toNumber(log.transactionIndex),
    logIndex: toNumber(log.logIndex),
    ordinal: toNumber(log.logIndex),
    contractAddress: normalizeAddress(log.address),
    pack: contractConfig.pack,
    ticketWeight: contractConfig.ticketWeight,
    itemName: contractConfig.label,
    eventKind: contractConfig.eventKind,
    checkoutId: String(topics[2] || '').toLowerCase() || null,
    tokenId: hexToBigIntText(topics[3]) || null,
    priceInUsdt,
    fmvPriceInUsd,
    paymentToken,
  }
}

function decodeLegacyPackOpenLog(log, contractConfig) {
  const topics = Array.isArray(log.topics) ? log.topics : []
  const userAddress = topicToAddress(topics[1])
  const checkoutId = normalizeHash(topics[3])
  const txHash = normalizeHash(log.transactionHash)
  if (!userAddress || !checkoutId || !txHash) return null

  const data = String(log.data || '').replace(/^0x/, '')
  const words = data.match(/.{1,64}/g) || []
  const priceInUsdt = words[0] ? BigInt(`0x${words[0]}`).toString() : null

  return {
    id: `${txHash}-${toNumber(log.logIndex)}`,
    canonicalAddress: userAddress,
    sourceAddress: userAddress,
    txHash,
    timestamp: toNumber(log.timeStamp),
    blockNumber: toNumber(log.blockNumber),
    transactionIndex: toNumber(log.transactionIndex),
    logIndex: toNumber(log.logIndex),
    ordinal: toNumber(log.logIndex),
    contractAddress: normalizeAddress(log.address),
    pack: contractConfig.pack,
    ticketWeight: contractConfig.ticketWeight,
    itemName: contractConfig.label,
    eventKind: contractConfig.eventKind,
    checkoutId,
    tokenId: null,
    priceInUsdt,
    fmvPriceInUsd: null,
    paymentToken: '',
  }
}

function decodeTicketEventLog(log, contractConfig) {
  if (contractConfig.eventKind === 'legacy-pack-open') return decodeLegacyPackOpenLog(log, contractConfig)
  return decodeBuybackEventLog(log, contractConfig)
}

function buybackActivityFromRows(rows) {
  const byCheckoutId = new Map()
  for (const activity of rows) {
    if (!BUYBACK_ACTIVITY_TYPES.has(activity?.__typename)) continue
    const checkoutId = normalizeHash(activity.checkoutId)
    const txHash = normalizeHash(activity.txHash)
    const timestamp = toNumber(activity.timestamp)
    if (!checkoutId || !txHash) continue
    if (timestamp < CAMPAIGN_START || timestamp > CAMPAIGN_END) continue

    const existing = byCheckoutId.get(checkoutId)
    if (existing && toNumber(existing.timestamp) <= timestamp) continue
    byCheckoutId.set(checkoutId, activity)
  }
  return byCheckoutId
}

async function matchLegacyBuybackEvents(openEvents, args, activityFetcher) {
  if (!openEvents.length) {
    return {
      events: [],
      checkedAddresses: 0,
      matchedBuybacks: 0,
      unmatchedOpens: 0,
      activityStats: activityFetcher.stats,
    }
  }

  const sourceAddresses = [...new Set(openEvents.map((event) => event.sourceAddress).filter(Boolean))]
  const byAddress = new Map()
  await mapWithConcurrency(sourceAddresses, Math.max(1, Math.min(4, args.resolveConcurrency)), async (address) => {
    const rows = await activityFetcher.fetchActivities(address)
    byAddress.set(address, buybackActivityFromRows(rows))
  })

  const matchedEvents = []
  let unmatchedOpens = 0

  for (const openEvent of openEvents) {
    const checkoutId = normalizeHash(openEvent.checkoutId)
    const buybackActivity = byAddress.get(openEvent.sourceAddress)?.get(checkoutId)
    if (!buybackActivity) {
      unmatchedOpens += 1
      continue
    }

    const txHash = normalizeHash(buybackActivity.txHash)
    const timestamp = toNumber(buybackActivity.timestamp)
    const ordinal = toNumber(buybackActivity.ordinal) || openEvent.ordinal
    matchedEvents.push({
      ...openEvent,
      id: String(buybackActivity.id || `${txHash}-${ordinal}`),
      txHash,
      timestamp,
      blockNumber: toNumber(buybackActivity.blockNumber) || openEvent.blockNumber,
      transactionIndex: 0,
      logIndex: ordinal,
      ordinal,
      contractAddress: normalizeAddress(buybackActivity.contractAddress) || openEvent.contractAddress,
      itemName: String(buybackActivity.item?.name || buybackActivity.itemName || openEvent.itemName),
      eventKind: 'legacy-buyback-activity',
      tokenId: buybackActivity.nftTokenId ? String(buybackActivity.nftTokenId) : openEvent.tokenId,
      priceInUsdt: buybackActivity.priceInUsdt
        ? String(buybackActivity.priceInUsdt)
        : buybackActivity.amount
          ? String(buybackActivity.amount)
          : openEvent.priceInUsdt,
      legacyOpenTxHash: openEvent.txHash,
      legacyOpenTimestamp: openEvent.timestamp,
    })
  }

  return {
    events: matchedEvents,
    checkedAddresses: sourceAddresses.length,
    matchedBuybacks: matchedEvents.length,
    unmatchedOpens,
    activityStats: activityFetcher.stats,
  }
}

export async function scanOnchainTicketEvents(args) {
  if (!args.bscscanApiKey) {
    throw new Error(
      'BSCSCAN_API_KEY is required for complete contract log scans. Pass --env-file or set BSCSCAN_API_KEY.',
    )
  }

  const bscscanConfig = {
    apiUrl: args.bscscanApiUrl,
    apiKey: args.bscscanApiKey,
    chainId: args.bscscanChainId,
    retries: args.retries,
    backoffMs: args.backoffMs,
  }
  const nowTs = Math.floor(Date.now() / 1000)
  const windowEndTs = Math.min(CAMPAIGN_END, nowTs)
  const fromBlock = args.fromBlock || (await blockByTimestamp(bscscanConfig, CAMPAIGN_START, 'after'))
  const toBlock = args.toBlock || (await blockByTimestamp(bscscanConfig, windowEndTs, 'before'))
  const contracts = PACK_EVENT_SOURCES.filter(
    (source) => !args.contracts.length || args.contracts.includes(source.contract),
  )

  if (!contracts.length) throw new Error('No eligible ticket event sources configured for scan.')

  const allEvents = []
  const scanStats = []
  const activityFetcher = createRenaissActivityFetcher(args)
  const blockChunk = Math.max(100, toNumber(args.blockChunk) || 5000)
  const offset = Math.max(1, Math.min(1000, toNumber(args.pageSize) || 1000))
  const eventCachePath = args.noCache ? '' : args.eventCachePath
  const eventCache = readJsonCache(eventCachePath, { version: 1, sources: {} }) || {
    version: 1,
    sources: {},
  }
  eventCache.sources ||= {}
  const overlapBlocks = Math.max(0, toNumber(args.eventCacheOverlapBlocks) || 0)

  for (const contract of contracts) {
    const cacheKey = sourceCacheKey(contract)
    const cachedSource = args.refreshCache ? null : eventCache.sources[cacheKey]
    const cachedEventsAll = Array.isArray(cachedSource?.events) ? cachedSource.events : []
    const cachedFromBlock = toNumber(cachedSource?.fromBlock)
    const cachedToBlock = toNumber(cachedSource?.toBlock)
    let scanStart = fromBlock
    let cachedEvents = []

    if (cachedEventsAll.length > 0 && cachedFromBlock <= fromBlock && cachedToBlock >= fromBlock) {
      scanStart = Math.max(fromBlock, Math.min(toBlock + 1, cachedToBlock - overlapBlocks + 1))
      cachedEvents = cachedEventsAll.filter((event) => {
        const block = toNumber(event.blockNumber)
        return block >= fromBlock && block < scanStart && block <= toBlock
      })
    }

    let cursor = scanStart
    const fetchedEvents = []
    let calls = 0
    while (cursor <= toBlock) {
      const chunkEnd = Math.min(toBlock, cursor + blockChunk - 1)
      let page = 1

      while (true) {
        const rows = await fetchLogsWindow(bscscanConfig, {
          address: contract.contract,
          fromBlock: cursor,
          toBlock: chunkEnd,
          topic0: contract.eventTopic,
          topic1: contract.topic1,
          topic2: contract.topic2,
          topic3: contract.topic3,
          page,
          offset,
        })
        calls += 1

        for (const row of rows) {
          const event = decodeTicketEventLog(row, contract)
          if (!event) continue
          if (event.timestamp < CAMPAIGN_START || event.timestamp > CAMPAIGN_END) continue
          fetchedEvents.push(event)
        }

        if (rows.length < offset) break
        page += 1
      }

      if (args.progress && (calls === 1 || calls % 25 === 0)) {
        console.log(
          `[onchain] ${contract.label}: block ${cursor}-${chunkEnd}, cached=${cachedEvents.length} fetched=${fetchedEvents.length}`,
        )
      }

      cursor = chunkEnd + 1
    }

    const sourceEvents = dedupeEvents([...cachedEvents, ...fetchedEvents])
    if (eventCachePath) {
      const retainedEvents = args.refreshCache
        ? []
        : cachedEventsAll.filter((event) => {
            const block = toNumber(event.blockNumber)
            return block < scanStart || block > toBlock
          })
      const mergedCacheEvents = dedupeEvents([...retainedEvents, ...sourceEvents])
      eventCache.sources[cacheKey] = {
        contract: contract.contract,
        label: contract.label,
        pack: contract.pack,
        eventKind: contract.eventKind,
        fromBlock:
          cachedFromBlock && !args.refreshCache ? Math.min(cachedFromBlock, fromBlock) : fromBlock,
        toBlock: cachedToBlock && !args.refreshCache ? Math.max(cachedToBlock, toBlock) : toBlock,
        updatedAt: Date.now(),
        events: mergedCacheEvents,
      }
      writeJsonCache(eventCachePath, eventCache)
    }

    const legacyMatch =
      contract.eventKind === 'legacy-pack-open'
        ? await matchLegacyBuybackEvents(sourceEvents, args, activityFetcher)
        : null
    const ledgerEvents = legacyMatch ? legacyMatch.events : sourceEvents
    allEvents.push(...ledgerEvents)

    scanStats.push({
      contract: contract.contract,
      label: contract.label,
      pack: contract.pack,
      eventKind: contract.eventKind,
      calls,
      events: ledgerEvents.length,
      openEvents: legacyMatch ? sourceEvents.length : undefined,
      matchedBuybacks: legacyMatch?.matchedBuybacks,
      unmatchedOpens: legacyMatch?.unmatchedOpens,
      checkedAddresses: legacyMatch?.checkedAddresses,
      cachedEvents: cachedEvents.length,
      fetchedEvents: fetchedEvents.length,
      activityFetchedAddresses: legacyMatch?.activityStats.fetchedAddresses,
      activityCachedAddresses: legacyMatch?.activityStats.cachedAddresses,
      cacheToBlock: eventCache.sources[cacheKey]?.toBlock ?? null,
    })
  }

  if (eventCachePath) writeJsonCache(eventCachePath, eventCache)
  activityFetcher.writeCache()

  sortEvents(allEvents)

  return {
    events: allEvents,
    source: {
      mode: 'contract-events',
      fromBlock,
      toBlock,
      contracts: scanStats,
    },
  }
}
