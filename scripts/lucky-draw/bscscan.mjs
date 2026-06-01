import { sleep, toNumber } from './utils.mjs'

const DEFAULT_BSCSCAN_API_URL = 'https://api.etherscan.io/v2/api'

function sanitizedParams(params) {
  const out = new URLSearchParams(params)
  if (out.has('apikey')) out.set('apikey', '[redacted]')
  return out.toString()
}

export async function bscscanJson(config, params) {
  const query = new URLSearchParams({
    chainid: String(config.chainId || 56),
    ...params,
    apikey: config.apiKey,
  })
  const apiUrl = config.apiUrl || DEFAULT_BSCSCAN_API_URL
  let lastError = null

  for (let attempt = 1; attempt <= config.retries; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl}?${query}`, {
        headers: { accept: 'application/json' },
      })
      if (response.status >= 500 || response.status === 429) {
        throw new Error(`HTTP ${response.status}`)
      }
      const data = await response.json()
      const result = data?.result
      const message = String(data?.message || '').trim()
      const resultText = typeof result === 'string' ? result.toLowerCase() : ''

      if (
        message === 'No records found' ||
        resultText.includes('no records found') ||
        resultText.includes('no transactions found')
      ) {
        return { ...data, result: [] }
      }

      if (data?.status === '1' || Array.isArray(result)) return data

      if (
        resultText.includes('max rate limit') ||
        resultText.includes('query timeout') ||
        resultText.includes('temporarily unavailable')
      ) {
        throw new Error(String(result || message || 'BscScan rate limited'))
      }

      throw new Error(`BscScan error: ${message || result || sanitizedParams(query)}`)
    } catch (error) {
      lastError = error
      if (attempt < config.retries) {
        await sleep(config.backoffMs * 2 ** (attempt - 1))
        continue
      }
    }
  }

  throw new Error(`BscScan request failed: ${lastError?.message || lastError}`)
}

export async function blockByTimestamp(config, timestamp, closest) {
  const data = await bscscanJson(config, {
    module: 'block',
    action: 'getblocknobytime',
    timestamp: String(timestamp),
    closest,
  })
  const block = toNumber(data.result)
  if (!block) throw new Error(`Could not resolve block for timestamp ${timestamp}`)
  return block
}

export async function fetchLogsWindow(config, params) {
  const query = {
    module: 'logs',
    action: 'getLogs',
    address: params.address,
    fromBlock: String(params.fromBlock),
    toBlock: String(params.toBlock),
    topic0: params.topic0,
    page: String(params.page),
    offset: String(params.offset),
  }
  for (const key of ['topic1', 'topic2', 'topic3']) {
    if (params[key]) query[key] = params[key]
  }

  const data = await bscscanJson(config, query)
  return Array.isArray(data.result) ? data.result : []
}
