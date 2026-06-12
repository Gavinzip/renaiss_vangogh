#!/usr/bin/env node
import { execFile } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { stableStringify } from './lucky-draw/utils.mjs'

const execFileAsync = promisify(execFile)
const DEFAULT_BACKUP_EXCLUDE_DIRS = 'cache,snapshots'

function parseArgs(argv) {
  const args = {
    dataDir: process.env.LUCKY_DRAW_DATA_DIR || '/data/lucky-draw',
    repoUrl:
      process.env.DATA_BACKUP_REPO_URL ||
      process.env.LUCKY_DRAW_BACKUP_REPO_URL ||
      'https://github.com/Gavinzip/renaiss_vangogh_data.git',
    branch: process.env.DATA_BACKUP_BRANCH || 'main',
    worktree: process.env.DATA_BACKUP_WORKTREE || '/tmp/lucky-draw-backup-repo',
    excludeDirs: parseExcludeDirs(process.env.DATA_BACKUP_EXCLUDE_DIRS || DEFAULT_BACKUP_EXCLUDE_DIRS),
    dryRun: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--data-dir') args.dataDir = argv[++index] || args.dataDir
    else if (arg === '--repo-url') args.repoUrl = argv[++index] || args.repoUrl
    else if (arg === '--branch') args.branch = argv[++index] || args.branch
    else if (arg === '--worktree') args.worktree = argv[++index] || args.worktree
    else if (arg === '--exclude-dir') args.excludeDirs.add(argv[++index] || '')
    else if (arg === '--dry-run') args.dryRun = true
  }

  args.excludeDirs.delete('')
  args.dataDir = resolve(args.dataDir)
  args.worktree = resolve(args.worktree)
  return args
}

function parseExcludeDirs(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry && entry !== '.' && entry !== '..' && !entry.includes('/')),
  )
}

function timestampId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
}

function redactUrl(url) {
  return String(url || '').replace(/\/\/[^/@]+@/, '//[redacted]@')
}

function githubUrlWithUsername(url) {
  if (!url.startsWith('https://github.com/')) return url
  return url.replace('https://github.com/', 'https://x-access-token@github.com/')
}

function assertSafeSyncRoot(worktree, dataDir) {
  if (!worktree || worktree === '/' || worktree.length < 8) {
    throw new Error(`Refusing unsafe backup worktree: ${worktree}`)
  }
  if (dataDir === worktree || dataDir.startsWith(`${worktree}/`)) {
    throw new Error('Backup worktree must not contain the data directory.')
  }
}

function removeWorktreeContents(worktree) {
  for (const name of readdirSync(worktree)) {
    if (name === '.git') continue
    rmSync(join(worktree, name), { recursive: true, force: true })
  }
}

function copyDirectory(source, target, options = {}) {
  mkdirSync(target, { recursive: true })
  for (const name of readdirSync(source)) {
    if (name === '.git') continue
    if (options.excludeDirs?.has(name)) continue

    const sourcePath = join(source, name)
    const targetPath = join(target, name)
    const stat = statSync(sourcePath)
    if (stat.isDirectory()) {
      copyDirectory(sourcePath, targetPath, options)
      continue
    }
    if (stat.isFile()) copyFileSync(sourcePath, targetPath)
  }
}

function writeAskpassScript() {
  const path = `/tmp/lucky-draw-git-askpass-${process.pid}.sh`
  writeFileSync(
    path,
    [
      '#!/bin/sh',
      'case "$1" in',
      '  *Username*) printf "%s\\n" "x-access-token" ;;',
      '  *) printf "%s\\n" "$DATA_BACKUP_GITHUB_TOKEN" ;;',
      'esac',
      '',
    ].join('\n'),
    { mode: 0o700 },
  )
  return path
}

async function git(args, options) {
  const { stdout, stderr } = await execFileAsync('git', args, {
    ...options,
    maxBuffer: 1024 * 1024 * 12,
  })
  return { stdout, stderr }
}

async function ensureWorktree(args, gitEnv) {
  const repoUrl = githubUrlWithUsername(args.repoUrl)
  if (!existsSync(args.worktree)) {
    mkdirSync(resolve(args.worktree, '..'), { recursive: true })
    await git(['clone', '--depth', '1', '--single-branch', '--branch', args.branch, repoUrl, args.worktree], {
      env: gitEnv,
    })
  }

  if (!existsSync(join(args.worktree, '.git'))) {
    throw new Error(`Backup worktree is not a git checkout: ${args.worktree}`)
  }

  await git(['-C', args.worktree, 'remote', 'set-url', 'origin', repoUrl], { env: gitEnv })
  await git(['-C', args.worktree, 'fetch', '--depth', '1', 'origin', args.branch], { env: gitEnv })
  await git(['-C', args.worktree, 'checkout', '-B', args.branch, 'FETCH_HEAD'], { env: gitEnv })
  await git(['-C', args.worktree, 'config', 'user.name', 'Renaiss Lucky Draw Backup'], { env: gitEnv })
  await git(['-C', args.worktree, 'config', 'user.email', 'backup@renaiss.xyz'], { env: gitEnv })
}

function summarizeDataDir(dataDir) {
  const ledgerPath = join(dataDir, 'lucky-draw-ledger.json')
  if (!existsSync(ledgerPath)) return { ledgerExists: false }
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  return {
    ledgerExists: true,
    generatedAt: ledger.generatedAt,
    ledgerHash: ledger.ledgerHash,
    totalEntries: ledger.totalEntries,
    totalRawTickets: ledger.totalRawTickets,
    totalBonusTickets: ledger.totalBonusTickets,
    totalFinalTickets: ledger.totalFinalTickets,
    bonusShuffleVersion: ledger.bonusShuffleVersion,
    bonusShuffleSeed: ledger.bonusShuffleSeed,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const token = process.env.DATA_BACKUP_GITHUB_TOKEN || process.env.LUCKY_DRAW_BACKUP_GITHUB_TOKEN || ''
  const requiresToken = args.repoUrl.startsWith('https://github.com/')

  if (!existsSync(args.dataDir)) throw new Error(`Data directory does not exist: ${args.dataDir}`)
  if (!args.repoUrl) throw new Error('DATA_BACKUP_REPO_URL is required.')
  if (requiresToken && !token && !args.dryRun) throw new Error('DATA_BACKUP_GITHUB_TOKEN is required.')
  assertSafeSyncRoot(args.worktree, args.dataDir)

  const summary = summarizeDataDir(args.dataDir)
  console.log(
    `[data-backup] ${args.dryRun ? 'dry-run ' : ''}source=${args.dataDir} repo=${redactUrl(args.repoUrl)} branch=${args.branch}`,
  )
  console.log(`[data-backup] worktree=${args.worktree}`)
  console.log(`[data-backup] excluding directories=${Array.from(args.excludeDirs).join(',') || 'none'}`)
  console.log(`[data-backup] ledger=${summary.ledgerHash || 'missing'} entries=${summary.totalEntries || 0}`)
  if (args.dryRun) return

  const askpassPath = writeAskpassScript()
  const gitEnv = {
    ...process.env,
    GIT_ASKPASS: askpassPath,
    GIT_TERMINAL_PROMPT: '0',
    DATA_BACKUP_GITHUB_TOKEN: token,
  }

  try {
    await ensureWorktree(args, gitEnv)
    removeWorktreeContents(args.worktree)
    copyDirectory(args.dataDir, args.worktree, { excludeDirs: args.excludeDirs })
    writeFileSync(
      join(args.worktree, 'backup-meta.json'),
      `${stableStringify({
        backedUpAt: Math.floor(Date.now() / 1000),
        source: basename(args.dataDir),
        repo: args.repoUrl,
        branch: args.branch,
        excludedDirectories: Array.from(args.excludeDirs).sort(),
        summary,
      })}\n`,
    )

    await git(['-C', args.worktree, 'add', '-A'], { env: gitEnv })
    const { stdout: status } = await git(['-C', args.worktree, 'status', '--porcelain'], {
      env: gitEnv,
    })
    if (!status.trim()) {
      console.log('[data-backup] no changes to commit')
      return
    }

    const id = timestampId()
    await git(['-C', args.worktree, 'commit', '-m', `Backup lucky draw data ${id}`], {
      env: gitEnv,
    })
    await git(['-C', args.worktree, 'push', 'origin', `HEAD:${args.branch}`], { env: gitEnv })
    console.log(`[data-backup] pushed ${id}`)
  } finally {
    rmSync(askpassPath, { force: true })
  }
}

main().catch((error) => {
  console.error(`[data-backup] failed: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
