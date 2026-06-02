#!/usr/bin/env node
import { copyFileSync, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const distDir = resolve(repoRoot, 'dist')
const dataDir = process.env.LUCKY_DRAW_DATA_DIR || '/Data/lucky-draw'
const cacheDir = process.env.LUCKY_DRAW_CACHE_DIR || join(dataDir, 'cache')
const ledgerPath = process.env.LUCKY_DRAW_LEDGER_PATH || join(dataDir, 'lucky-draw-ledger.json')
const snapshotDir = process.env.LUCKY_DRAW_SNAPSHOT_DIR || join(dataDir, 'snapshots')
const port = Number(process.env.PORT || 3000)
const refreshMinutes = Math.max(1, Number(process.env.LUCKY_DRAW_REFRESH_MINUTES || 60))
const refreshIntervalMs = refreshMinutes * 60 * 1000
const backupIntervalMinutes = Math.max(1, Number(process.env.DATA_BACKUP_INTERVAL_MINUTES || 60))
const backupIntervalMs = backupIntervalMinutes * 60 * 1000
const backupRepoUrl = process.env.DATA_BACKUP_REPO_URL || process.env.LUCKY_DRAW_BACKUP_REPO_URL || ''
const backupEnabled = Boolean(
  backupRepoUrl && (process.env.DATA_BACKUP_GITHUB_TOKEN || process.env.LUCKY_DRAW_BACKUP_GITHUB_TOKEN),
)
const blockChunk = process.env.LUCKY_DRAW_BLOCK_CHUNK || '20000'
const resolveConcurrency = process.env.LUCKY_DRAW_RESOLVE_CONCURRENCY || '3'
const delayMs = process.env.LUCKY_DRAW_DELAY_MS || '30'
const retries = process.env.LUCKY_DRAW_RETRIES || '8'
const backoffMs = process.env.LUCKY_DRAW_BACKOFF_MS || '1000'

let refreshRunning = false
let refreshTimer = null
let backupRunning = false
let backupTimer = null
let lastRefresh = {
  ok: false,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  error: null,
}
let lastBackup = {
  ok: false,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  error: null,
  trigger: null,
}

function contentType(path) {
  const ext = extname(path).toLowerCase()
  if (ext === '.html') return 'text/html; charset=utf-8'
  if (ext === '.js') return 'text/javascript; charset=utf-8'
  if (ext === '.css') return 'text/css; charset=utf-8'
  if (ext === '.json') return 'application/json; charset=utf-8'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'application/octet-stream'
}

function sendFile(response, path, headers = {}) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8',
      ...headers,
    })
    response.end('Not found')
    return
  }
  response.writeHead(200, {
    'content-type': contentType(path),
    ...headers,
  })
  createReadStream(path).pipe(response)
}

function distPathForUrl(url) {
  const rawPath = decodeURIComponent(new URL(url, 'http://localhost').pathname)
  const safePath = normalize(rawPath).replace(/^(\.\.[/\\])+/, '')
  const candidate = resolve(distDir, `.${safePath}`)
  return candidate.startsWith(distDir) ? candidate : null
}

function snapshotLedger() {
  if (!existsSync(ledgerPath)) return null
  mkdirSync(snapshotDir, { recursive: true })
  const id = new Date().toISOString().replace(/[:.]/g, '-')
  const snapshotPath = join(snapshotDir, `lucky-draw-ledger-${id}.json`)
  copyFileSync(ledgerPath, snapshotPath)
  return snapshotPath
}

function runDataBackup(trigger) {
  if (!backupEnabled || backupRunning) return
  backupRunning = true
  lastBackup = {
    ok: false,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    error: null,
    trigger,
  }

  const args = [
    fileURLToPath(new URL('./backup-lucky-draw-data.mjs', import.meta.url)),
    '--data-dir',
    dataDir,
  ]

  console.log(`[data-backup] start trigger=${trigger} data=${dataDir}`)
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  })
  child.on('close', (code) => {
    backupRunning = false
    lastBackup = {
      ...lastBackup,
      ok: code === 0,
      finishedAt: new Date().toISOString(),
      exitCode: code,
      error: code === 0 ? null : `data backup exited with code ${code}`,
    }
    console.log(`[data-backup] finish trigger=${trigger} code=${code}`)
  })
  child.on('error', (error) => {
    backupRunning = false
    lastBackup = {
      ...lastBackup,
      ok: false,
      finishedAt: new Date().toISOString(),
      exitCode: null,
      error: error.message,
    }
    console.error('[data-backup] failed', error)
  })
}

function runLedgerRefresh(trigger) {
  if (refreshRunning) return
  refreshRunning = true
  lastRefresh = {
    ok: false,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    error: null,
  }
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(cacheDir, { recursive: true })

  const args = [
    fileURLToPath(new URL('./fetch-lucky-draw-ledger.mjs', import.meta.url)),
    '--cache-dir',
    cacheDir,
    '--out',
    ledgerPath,
    '--block-chunk',
    blockChunk,
    '--resolve-concurrency',
    resolveConcurrency,
    '--delay-ms',
    delayMs,
    '--retries',
    retries,
    '--backoff-ms',
    backoffMs,
  ]

  console.log(`[ledger-refresh] start trigger=${trigger} data=${dataDir} cache=${cacheDir}`)
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  })
  child.on('close', (code) => {
    refreshRunning = false
    let snapshotPath = null
    if (code === 0) snapshotPath = snapshotLedger()
    lastRefresh = {
      ...lastRefresh,
      ok: code === 0,
      finishedAt: new Date().toISOString(),
      exitCode: code,
      error: code === 0 ? null : `ledger refresh exited with code ${code}`,
      snapshotPath,
    }
    if (snapshotPath) console.log(`[ledger-refresh] snapshot ${snapshotPath}`)
    console.log(`[ledger-refresh] finish trigger=${trigger} code=${code}`)
    if (code === 0) runDataBackup('ledger-refresh')
  })
  child.on('error', (error) => {
    refreshRunning = false
    lastRefresh = {
      ...lastRefresh,
      ok: false,
      finishedAt: new Date().toISOString(),
      exitCode: null,
      error: error.message,
    }
    console.error('[ledger-refresh] failed', error)
  })
}

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  if (url.pathname === '/health') {
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    })
    response.end(
      JSON.stringify({
        ok: true,
        dataDir,
        cacheDir,
        ledgerPath,
        ledgerExists: existsSync(ledgerPath),
        refreshMinutes,
        refreshRunning,
        lastRefresh,
        backupEnabled,
        backupIntervalMinutes,
        backupRunning,
        lastBackup,
      }),
    )
    return
  }

  if (url.pathname === '/lucky-draw-ledger.json') {
    sendFile(response, ledgerPath, {
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    })
    return
  }

  const filePath = distPathForUrl(request.url || '/')
  if (filePath && existsSync(filePath) && statSync(filePath).isFile()) {
    sendFile(response, filePath)
    return
  }

  sendFile(response, join(distDir, 'index.html'), {
    'cache-control': 'no-cache',
  })
})

server.listen(port, () => {
  console.log(`[server] listening on :${port}`)
  console.log(`[server] data dir ${dataDir}`)
  console.log(`[server] ledger path ${ledgerPath}`)
  console.log(`[server] backup ${backupEnabled ? 'enabled' : 'disabled'}`)
  runLedgerRefresh('startup')
  refreshTimer = setInterval(() => runLedgerRefresh('interval'), refreshIntervalMs)
  if (backupEnabled) backupTimer = setInterval(() => runDataBackup('interval'), backupIntervalMs)
})

function shutdown() {
  if (refreshTimer) clearInterval(refreshTimer)
  if (backupTimer) clearInterval(backupTimer)
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
