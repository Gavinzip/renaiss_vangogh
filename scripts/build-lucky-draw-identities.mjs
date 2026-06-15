import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_LEDGER_PATH = 'public/lucky-draw-ledger.json'
const DEFAULT_OUT_PATH = 'public/lucky-draw-identities.json'

function parseArgs() {
  const args = process.argv.slice(2)
  const values = {
    csv: '',
    ledger: DEFAULT_LEDGER_PATH,
    out: DEFAULT_OUT_PATH,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--csv') values.csv = args[++index] ?? ''
    if (arg === '--ledger') values.ledger = args[++index] ?? DEFAULT_LEDGER_PATH
    if (arg === '--out') values.out = args[++index] ?? DEFAULT_OUT_PATH
  }

  if (!values.csv) {
    throw new Error('Usage: node scripts/build-lucky-draw-identities.mjs --csv /path/to/wallet-export.csv')
  }

  return values
}

function parseCsv(text) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        value += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
      continue
    }

    if (char === ',') {
      row.push(value)
      value = ''
      continue
    }

    if (char === '\n') {
      row.push(value)
      rows.push(row)
      row = []
      value = ''
      continue
    }

    if (char !== '\r') value += char
  }

  if (value || row.length > 0) {
    row.push(value)
    rows.push(row)
  }

  const [headers, ...body] = rows
  return body.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])))
}

function normalizeAddress(value) {
  const address = value.trim().toLowerCase()
  return /^0x[a-f0-9]{40}$/.test(address) ? address : ''
}

const { csv, ledger, out } = parseArgs()
const ledgerJson = JSON.parse(fs.readFileSync(ledger, 'utf8'))
const neededAddresses = new Set()

for (const entry of ledgerJson.entries ?? []) {
  const addresses = [entry.userAddress, ...(entry.sourceAddresses ?? [])]
  for (const address of addresses) {
    const normalized = normalizeAddress(address ?? '')
    if (normalized) neededAddresses.add(normalized)
  }
}

const rows = parseCsv(fs.readFileSync(csv, 'utf8'))
const identities = {}

function firstFilled(row, keys) {
  for (const key of keys) {
    const value = row[key]?.trim()
    if (value) return value
  }
  return ''
}

function rowIdentity(row) {
  return {
    username: firstFilled(row, ['username', 'platform_user_name']) || null,
    linkedTwitter: firstFilled(row, ['linked_twitter', 'twitter_handle']) || null,
    linkedDiscord: firstFilled(row, ['linked_discord', 'discord_username']) || null,
  }
}

const addressColumns = [
  'old_wallet',
  'new_wallet',
  'renaiss_current_address',
  'safe_account_address',
  'old_external_wallet',
  'new_embedded_wallet',
]

for (const row of rows) {
  const identity = rowIdentity(row)

  for (const key of addressColumns) {
    const address = normalizeAddress(row[key] ?? '')
    if (!address || !neededAddresses.has(address)) continue
    identities[address] = identity
  }
}

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(
  out,
  `${JSON.stringify(
    {
      generatedAt: Date.now(),
      sourceCsv: path.basename(csv),
      ledgerHash: ledgerJson.ledgerHash ?? null,
      totalLedgerAddresses: neededAddresses.size,
      matchedAddresses: Object.keys(identities).length,
      identities,
    },
    null,
    2,
  )}\n`,
)

console.log(`Wrote ${Object.keys(identities).length}/${neededAddresses.size} identities to ${out}`)
