#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_OUT_PATH = 'scripts/data/lucky-draw-wallet-identities.json'

function parseArgs() {
  const args = process.argv.slice(2)
  const values = {
    csv: '',
    out: DEFAULT_OUT_PATH,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--csv') values.csv = args[++index] ?? ''
    if (arg === '--out') values.out = args[++index] ?? DEFAULT_OUT_PATH
  }

  if (!values.csv) {
    throw new Error('Usage: node scripts/build-wallet-identity-lookup.mjs --csv /path/to/wallet-export.csv')
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
  const address = String(value || '').trim().toLowerCase()
  return /^0x[a-f0-9]{40}$/.test(address) ? address : ''
}

function mergeIdentity(current, next) {
  if (!current) return next
  return {
    u: current.u || next.u,
    t: current.t || next.t,
    d: current.d || next.d,
  }
}

function firstFilled(row, keys) {
  for (const key of keys) {
    const value = row[key]?.trim()
    if (value) return value
  }
  return ''
}

function rowIdentity(row) {
  return {
    u: firstFilled(row, ['username', 'platform_user_name']) || null,
    t: firstFilled(row, ['linked_twitter', 'twitter_handle']) || null,
    d: firstFilled(row, ['linked_discord', 'discord_username']) || null,
  }
}

const { csv, out } = parseArgs()
const rows = parseCsv(fs.readFileSync(csv, 'utf8'))
const identities = {}
let duplicateAddressRows = 0
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
    if (!address) continue
    if (identities[address]) duplicateAddressRows += 1
    identities[address] = mergeIdentity(identities[address], identity)
  }
}

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(
  out,
  `${JSON.stringify({
    meta: {
      generatedAt: Date.now(),
      sourceCsv: path.basename(csv),
      totalRows: rows.length,
      totalAddresses: Object.keys(identities).length,
      duplicateAddressRows,
    },
    identities,
  })}\n`,
)

console.log(`Wrote ${Object.keys(identities).length} identities from ${rows.length} rows to ${out}`)
