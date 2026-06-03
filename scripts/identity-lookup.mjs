import { existsSync, readFileSync, statSync } from 'node:fs'

const ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/
const ADDRESS_PREFIX_PATTERN = /^0x[a-f0-9]{2,40}$/
const DEFAULT_SUGGESTION_LIMIT = 8
const MIN_SUGGESTION_LENGTH = 2

let identityCache = {
  index: null,
  mtimeMs: -1,
  path: '',
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function normalizeAddress(value) {
  const address = String(value || '').trim().toLowerCase()
  return ADDRESS_PATTERN.test(address) ? address : ''
}

function normalizeAddressPrefix(value) {
  const address = String(value || '').trim().toLowerCase()
  return ADDRESS_PREFIX_PATTERN.test(address) ? address : ''
}

function normalizeHandle(value) {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase()
}

function normalizeDiscord(value) {
  return String(value || '').trim().toLowerCase().replace(/#0$/, '')
}

function displayDiscord(value) {
  const normalized = normalizeDiscord(value)
  return normalized ? `${normalized}#0` : ''
}

function addLookup(map, key, address) {
  if (!key || !address) return
  const current = map.get(key)
  if (current) {
    if (!current.includes(address)) current.push(address)
    return
  }
  map.set(key, [address])
}

function addressIdentityName(identity) {
  return identity?.username || identity?.linkedTwitter || identity?.linkedDiscord || ''
}

function suggestionDetail(kind, addressCount, identity) {
  const suffix = addressCount > 1 ? `${addressCount} wallets` : '1 wallet'
  if (kind === 'address') return addressIdentityName(identity) || suffix
  if (kind === 'twitter') return `Twitter · ${suffix}`
  if (kind === 'discord') return `Discord · ${suffix}`
  return `Renaiss username · ${suffix}`
}

function buildSuggestion(kind, key, addresses, index) {
  const identity = index.byAddress.get(addresses[0]) || null
  const label =
    kind === 'address'
      ? addresses[0]
      : kind === 'twitter'
        ? `@${key}`
        : kind === 'discord'
          ? displayDiscord(key)
          : identity?.username || key

  return {
    kind,
    label,
    value: kind === 'address' ? addresses[0] : kind === 'twitter' ? `@${key}` : key,
    detail: suggestionDetail(kind, addresses.length, identity),
    addressCount: addresses.length,
    sampleAddress: addresses[0],
  }
}

function lookupEntries(map, kind, index) {
  return [...map.entries()]
    .map(([key, addresses]) => buildSuggestion(kind, key, addresses, index))
}

function suggestionSearchKey(suggestion) {
  return suggestion.kind === 'discord' ? normalizeDiscord(suggestion.value) : normalizeHandle(suggestion.value)
}

function bucketSuggestions(entries, prefixLength) {
  const buckets = new Map()
  for (const suggestion of entries) {
    const key = suggestionSearchKey(suggestion)
    const prefix = key.slice(0, prefixLength)
    if (prefix.length < prefixLength) continue
    const current = buckets.get(prefix)
    if (current) current.push(suggestion)
    else buckets.set(prefix, [suggestion])
  }
  return buckets
}

function buildIndex(payload) {
  const identities = payload?.identities && typeof payload.identities === 'object' ? payload.identities : {}
  const byAddress = new Map()
  const byUsername = new Map()
  const byTwitter = new Map()
  const byDiscord = new Map()

  for (const [rawAddress, identity] of Object.entries(identities)) {
    const address = normalizeAddress(rawAddress)
    if (!address) continue

    const normalizedIdentity = {
      username: identity?.username || identity?.u || null,
      linkedTwitter: identity?.linkedTwitter || identity?.t || null,
      linkedDiscord: identity?.linkedDiscord || identity?.d || null,
    }

    byAddress.set(address, normalizedIdentity)
    addLookup(byUsername, normalizeHandle(normalizedIdentity.username), address)
    addLookup(byTwitter, normalizeHandle(normalizedIdentity.linkedTwitter), address)
    addLookup(byDiscord, normalizeDiscord(normalizedIdentity.linkedDiscord), address)
  }

  const index = {
    meta: payload?.meta || {},
    byAddress,
    byUsername,
    byTwitter,
    byDiscord,
  }

  const suggestionEntries = [
    ...lookupEntries(byUsername, 'username', index),
    ...lookupEntries(byTwitter, 'twitter', index),
    ...lookupEntries(byDiscord, 'discord', index),
  ]
  const addressSuggestionEntries = [...byAddress.keys()].map((address) => buildSuggestion('address', address, [address], index))

  return {
    ...index,
    suggestionBuckets: bucketSuggestions(suggestionEntries, 2),
    suggestionEntries,
    addressSuggestionBuckets: bucketSuggestions(addressSuggestionEntries, 4),
    addressSuggestionEntries,
  }
}

export function readIdentityIndex(identityPath) {
  if (!identityPath || !existsSync(identityPath)) return null

  const stat = statSync(identityPath)
  if (identityCache.index && identityCache.path === identityPath && identityCache.mtimeMs === stat.mtimeMs) {
    return identityCache.index
  }

  const payload = JSON.parse(readFileSync(identityPath, 'utf8'))
  const index = buildIndex(payload)
  identityCache = {
    index,
    mtimeMs: stat.mtimeMs,
    path: identityPath,
  }
  return index
}

export function identityForAddress(index, address) {
  const normalized = normalizeAddress(address)
  return normalized && index ? index.byAddress.get(normalized) || null : null
}

export function resolveIdentityQuery(index, query) {
  if (!index) return null

  const normalizedAddress = normalizeAddress(query)
  if (normalizedAddress) {
    return {
      kind: 'address',
      query: normalizedAddress,
      addresses: [normalizedAddress],
      identity: identityForAddress(index, normalizedAddress),
    }
  }

  const handle = normalizeHandle(query)
  const discord = normalizeDiscord(query)
  if (!handle && !discord) return null

  const usernameAddresses = index.byUsername.get(handle) || []
  const twitterAddresses = index.byTwitter.get(handle) || []
  const discordAddresses = index.byDiscord.get(discord) || []
  const addresses = unique([...usernameAddresses, ...twitterAddresses, ...discordAddresses])
  if (!addresses.length) return null

  const kind = usernameAddresses.length ? 'username' : twitterAddresses.length ? 'twitter' : 'discord'
  return {
    kind,
    query: kind === 'discord' ? discord : handle,
    addresses,
    identity: identityForAddress(index, addresses[0]),
  }
}

export function suggestIdentityQueries(index, query, limit = DEFAULT_SUGGESTION_LIMIT) {
  if (!index) return []

  const boundedLimit = Math.max(1, Math.min(20, Math.floor(Number(limit) || DEFAULT_SUGGESTION_LIMIT)))
  const addressPrefix = normalizeAddressPrefix(query)
  const handle = normalizeHandle(query)
  const discord = normalizeDiscord(query)

  if (addressPrefix && addressPrefix.length >= 4) {
    const candidates = index.addressSuggestionBuckets.get(addressPrefix.slice(0, 4)) || []
    return candidates.filter((suggestion) => suggestion.value.startsWith(addressPrefix)).slice(0, boundedLimit)
  }

  const normalized = handle || discord
  if (normalized.length < MIN_SUGGESTION_LENGTH) return []

  const results = []
  const seen = new Set()
  const candidates = index.suggestionBuckets.get(normalized.slice(0, 2)) || []
  for (const suggestion of candidates) {
    const compareValue = suggestionSearchKey(suggestion)
    if (!compareValue.startsWith(normalized)) continue

    const key = `${suggestion.kind}:${compareValue}`
    if (seen.has(key)) continue
    seen.add(key)
    results.push(suggestion)
    if (results.length >= boundedLimit) break
  }

  return results
}
