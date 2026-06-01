#!/usr/bin/env node
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const distDir = resolve(repoRoot, 'dist')
const dataDir = process.env.LUCKY_DRAW_DATA_DIR || '/Data/lucky-draw'
const cacheDir = process.env.LUCKY_DRAW_CACHE_DIR || join(dataDir, 'cache')
const ledgerPath = process.env.LUCKY_DRAW_LEDGER_PATH || join(dataDir, 'lucky-draw-ledger.json')
const port = Number(process.env.PORT || 3000)
const refreshMinutes = Math.max(1, Number(process.env.LUCKY_DRAW_REFRESH_MINUTES || 60))
const refreshIntervalMs = refreshMinutes * 60 * 1000
const blockChunk = process.env.LUCKY_DRAW_BLOCK_CHUNK || '20000'
const resolveConcurrency = process.env.LUCKY_DRAW_RESOLVE_CONCURRENCY || '3'
const delayMs = process.env.LUCKY_DRAW_DELAY_MS || '30'
const retries = process.env.LUCKY_DRAW_RETRIES || '8'
const backoffMs = process.env.LUCKY_DRAW_BACKOFF_MS || '1000'

let refreshRunning = false
let refreshTimer = null
let lastRefresh = {
  ok: false,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  error: null,
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
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
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
    lastRefresh = {
      ...lastRefresh,
      ok: code === 0,
      finishedAt: new Date().toISOString(),
      exitCode: code,
      error: code === 0 ? null : `ledger refresh exited with code ${code}`,
    }
    console.log(`[ledger-refresh] finish trigger=${trigger} code=${code}`)
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
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
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
      }),
    )
    return
  }

  if (url.pathname === '/lucky-draw-ledger.json') {
    sendFile(response, ledgerPath, {
      'cache-control': 'no-store',
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
  runLedgerRefresh('startup')
  refreshTimer = setInterval(() => runLedgerRefresh('interval'), refreshIntervalMs)
})

function shutdown() {
  if (refreshTimer) clearInterval(refreshTimer)
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
