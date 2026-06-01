#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000

function parseArgs(argv) {
  const args = {
    intervalMs: DEFAULT_INTERVAL_MS,
    passThrough: [],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--interval-ms') {
      args.intervalMs = Math.max(60_000, Number(argv[++index] || DEFAULT_INTERVAL_MS))
    } else if (arg === '--interval-minutes') {
      args.intervalMs = Math.max(1, Number(argv[++index] || 15)) * 60 * 1000
    } else {
      args.passThrough.push(arg)
    }
  }

  return args
}

function runFetch(passThrough) {
  const scriptPath = fileURLToPath(new URL('./fetch-lucky-draw-ledger.mjs', import.meta.url))
  const child = spawn(process.execPath, [scriptPath, ...passThrough], {
    stdio: 'inherit',
  })

  return new Promise((resolve) => {
    child.on('close', (code) => resolve(code || 0))
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let stopped = false

  process.on('SIGINT', () => {
    stopped = true
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    stopped = true
    process.exit(0)
  })

  while (!stopped) {
    const startedAt = new Date()
    console.log(`[watch] lucky draw ledger scan start ${startedAt.toISOString()}`)
    const code = await runFetch(args.passThrough)
    console.log(`[watch] lucky draw ledger scan finished code=${code}`)
    if (stopped) break
    await new Promise((resolve) => setTimeout(resolve, args.intervalMs))
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

