import { join } from 'node:path'

import { isFreshCache, readJsonCache, writeJsonCache } from './cache.mjs'
import { CAMPAIGN_START, RENAISS_ACTIVITY_URL } from './rules.mjs'
import { normalizeAddress, sleep, toNumber } from './utils.mjs'

function isRateLimitResponse(response, text) {
  return response.status === 429 || text.includes('429') || text.toLowerCase().includes('query allowance')
}

async function fetchJson(url, args) {
  const maxAttempts = Math.max(1, toNumber(args.retries) || 1)
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, { headers: { accept: 'application/json' } })
    if (response.ok) return response.json()

    const text = await response.text()
    const rateLimited = isRateLimitResponse(response, text)
    lastError = new Error(`${url} returned ${response.status}: ${text.slice(0, 240)}`)
    if (!rateLimited || attempt >= maxAttempts) break

    const retryAfterSeconds = toNumber(response.headers.get('retry-after'))
    const retryAfterMs = retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 0
    const delayMs = Math.max(retryAfterMs, toNumber(args.backoffMs) || 0, 10_000)
    await sleep(delayMs)
  }

  throw lastError
}

export function createRenaissActivityFetcher(args) {
  const cachePath = args.noCache ? '' : args.activityCachePath || (args.cacheDir ? join(args.cacheDir, 'activities.json') : '')
  const cache = readJsonCache(cachePath, { version: 1, addresses: {} }) || {
    version: 1,
    addresses: {},
  }
  cache.addresses ||= {}

  const stats = {
    fetchedAddresses: 0,
    cachedAddresses: 0,
    rows: 0,
  }

  async function fetchActivities(address) {
    const normalized = normalizeAddress(address)
    if (!normalized) return []

    const cached = args.refreshCache ? null : cache.addresses[normalized]
    if (isFreshCache(cached, args.activityCacheTtlMs)) {
      stats.cachedAddresses += 1
      stats.rows += Array.isArray(cached.activities) ? cached.activities.length : 0
      return cached.activities || []
    }

    const activities = []
    let cursor = ''
    const safePageSize = Math.min(50, Math.max(1, toNumber(args.activityPageSize) || 50))

    while (true) {
      const payload = { 0: { json: { address: normalized, limit: safePageSize } } }
      if (cursor) payload[0].json.cursor = cursor
      const input = encodeURIComponent(JSON.stringify(payload))
      const data = await fetchJson(`${RENAISS_ACTIVITY_URL}?batch=1&input=${input}`, args)
      const json = data?.[0]?.result?.data?.json
      const rows = Array.isArray(json?.activities) ? json.activities : []
      activities.push(...rows)
      cursor = json?.nextCursor || ''

      const oldestTimestamp = rows.reduce((oldest, row) => {
        const ts = toNumber(row.timestamp)
        return ts > 0 ? Math.min(oldest, ts) : oldest
      }, Number.MAX_SAFE_INTEGER)

      if (args.delayMs > 0) await sleep(args.delayMs)
      if (!cursor || rows.length === 0 || oldestTimestamp < CAMPAIGN_START) break
    }

    stats.fetchedAddresses += 1
    stats.rows += activities.length
    cache.addresses[normalized] = {
      fetchedAt: Date.now(),
      activities,
    }
    writeCache()
    return activities
  }

  function writeCache() {
    if (cachePath) writeJsonCache(cachePath, cache)
  }

  return { fetchActivities, writeCache, stats }
}
