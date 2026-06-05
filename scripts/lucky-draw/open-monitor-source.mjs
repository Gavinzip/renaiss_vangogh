import {
  CAMPAIGN_END,
  CAMPAIGN_START,
  OPEN_MONITOR_URL,
  RENAISS_ACTIVITY_URL,
  describePackEventSources,
  getLegacyPackIds,
  getPackContracts,
  getPackEventSources,
  getPackWeights,
} from './rules.mjs'
import { normalizeAddress, normalizeHash, sleep, toNumber } from './utils.mjs'

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${url} returned ${response.status}: ${text.slice(0, 240)}`)
  }
  return response.json()
}

export async function loadOpenMonitorCandidates() {
  const data = await fetchJson(OPEN_MONITOR_URL)
  const candidates = new Map()
  for (const row of data.entries || []) {
    const canonical = normalizeAddress(row.user_address)
    if (!canonical) continue
    const sourceAddresses = new Set([canonical])
    for (const merged of row.merged_from || []) {
      const address = normalizeAddress(merged)
      if (address) sourceAddresses.add(address)
    }
    candidates.set(canonical, {
      canonical,
      sourceAddresses,
      openMonitorRow: row,
    })
  }

  return {
    candidates,
    totalEntries: toNumber(data.total_entries),
    sourceRows: toNumber(data.entries?.length),
  }
}

function packFromActivity(activity, lookups) {
  const packId = String(activity.packId || activity.item?.packId || '').trim().toLowerCase()
  if (packId && lookups.legacyPackIds[packId]) return lookups.legacyPackIds[packId]

  const name = String(activity.item?.name || activity.itemName || '').toLowerCase()
  if (name.includes('omega')) return 'omega'
  if (name.includes('eden')) return 'eden'
  if (name.includes('costume')) return 'costume-pack'
  if (name.includes('magma')) return 'magma'
  if (name.includes('starry')) return 'starry-pack'

  const contract = normalizeAddress(activity.contractAddress)
  if (contract && lookups.packContracts[contract]) return lookups.packContracts[contract].pack
  return null
}

async function fetchActivities(address, pageSize) {
  const activities = []
  let cursor = ''
  let done = false
  const safePageSize = Math.min(50, Math.max(1, toNumber(pageSize) || 50))

  while (!done) {
    const payload = { 0: { json: { address, limit: safePageSize } } }
    if (cursor) payload[0].json.cursor = cursor
    const input = encodeURIComponent(JSON.stringify(payload))
    const url = `${RENAISS_ACTIVITY_URL}?batch=1&input=${input}`
    const data = await fetchJson(url)
    const json = data?.[0]?.result?.data?.json
    const rows = Array.isArray(json?.activities) ? json.activities : []
    activities.push(...rows)
    cursor = json?.nextCursor || ''

    const oldestTimestamp = rows.reduce((oldest, row) => {
      const ts = toNumber(row.timestamp)
      return ts > 0 ? Math.min(oldest, ts) : oldest
    }, Number.MAX_SAFE_INTEGER)
    done = !cursor || rows.length === 0 || oldestTimestamp < CAMPAIGN_START
  }

  return activities
}

export async function scanOpenMonitorCandidateEvents(candidates, args) {
  const allEvents = []
  let index = 0
  const packEventSources = getPackEventSources(args.extraLegacyPacksRaw)
  const lookups = {
    legacyPackIds: getLegacyPackIds(packEventSources),
    packContracts: getPackContracts(packEventSources),
    packWeights: getPackWeights(packEventSources),
  }

  for (const candidate of candidates) {
    index += 1
    for (const sourceAddress of candidate.sourceAddresses) {
      const activities = await fetchActivities(sourceAddress, args.activityPageSize)
      for (const activity of activities) {
        if (activity.__typename !== 'PerpetualBuybackActivity') continue
        const timestamp = toNumber(activity.timestamp)
        if (timestamp < CAMPAIGN_START || timestamp > CAMPAIGN_END) continue
        const pack = packFromActivity(activity, lookups)
        if (!pack) continue
        const txHash = normalizeHash(activity.txHash)
        if (!txHash) continue
        const ticketWeight = lookups.packWeights[pack]
        if (!ticketWeight) continue
        allEvents.push({
          id: String(activity.id || `${txHash}-${activity.ordinal || activity.nftTokenId || index}`),
          canonicalAddress: candidate.canonical,
          sourceAddress,
          txHash,
          timestamp,
          blockNumber: toNumber(activity.blockNumber),
          transactionIndex: 0,
          logIndex: toNumber(activity.ordinal),
          ordinal: toNumber(activity.ordinal),
          contractAddress: normalizeAddress(activity.contractAddress),
          pack,
          ticketWeight,
          itemName: String(activity.item?.name || ''),
          checkoutId: activity.checkoutId || null,
          tokenId: activity.nftTokenId ? String(activity.nftTokenId) : null,
          priceInUsdt: activity.priceInUsdt ? String(activity.priceInUsdt) : null,
        })
      }
      if (args.delayMs > 0) await sleep(args.delayMs)
    }
    console.log(`[${index}/${candidates.length}] ${candidate.canonical}`)
  }

  return {
    events: allEvents,
    source: {
      mode: 'open-monitor-candidate-activities',
      sourceEntries: candidates.length,
      packEventSources: describePackEventSources(packEventSources),
    },
  }
}
