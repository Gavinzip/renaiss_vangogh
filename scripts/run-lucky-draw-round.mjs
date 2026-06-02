import { existsSync, readFileSync } from 'node:fs'
import { Contract, JsonRpcProvider, Wallet, ethers } from 'ethers'

const ARTIFACT_FILE = new URL('../artifacts/contracts/RenaissLuckyDraw.sol/RenaissLuckyDraw.json', import.meta.url)

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function loadEnvFile(envFilePath) {
  const envFile = new URL(`../${envFilePath}`, import.meta.url)
  if (!existsSync(envFile)) return {}
  return Object.fromEntries(
    readFileSync(envFile, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      }),
  )
}

function required(env, key) {
  const value = env[key]
  if (!value) throw new Error(`${key} is required.`)
  return value
}

function parseRoundStatus(status) {
  return {
    finalized: status.finalized,
    requested: status.requested,
    fulfilled: status.fulfilled,
    totalTickets: status.currentTotalTickets,
    firstWinningTicket: status.firstWinningTicket,
    ledgerHash: status.currentLedgerHash,
    prizeSlotCount: status.currentPrizeSlotCount,
    winnerCount: status.winnerCount,
  }
}

function parseRevealOrder(rawValue, prizeSlotCount) {
  const slotCount = Number(prizeSlotCount)
  if (!rawValue) return Array.from({ length: slotCount }, (_, index) => index)

  const slots = rawValue
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value))
  const uniqueSlots = new Set(slots)
  if (slots.length !== uniqueSlots.size) throw new Error('reveal order contains duplicate prize slots.')
  for (const slot of slots) {
    if (slot < 0 || slot >= slotCount) throw new Error(`reveal order slot out of range: ${slot}`)
  }

  return [
    ...slots,
    ...Array.from({ length: slotCount }, (_, index) => index).filter((slot) => !uniqueSlots.has(slot)),
  ]
}

async function waitForRandomnessReady(contract, timeoutMs, intervalMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const state = Number(await contract.state())
    if (state >= 3) return state
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`Timed out waiting for VRF fulfillment after ${Math.round(timeoutMs / 1000)} seconds.`)
}

const envFilePath = argValue('--env-file') || process.env.DEPLOY_ENV_FILE || '.env.deploy.local'
const env = { ...loadEnvFile(envFilePath), ...process.env }
const ledgerPath = argValue('--ledger') || env.LUCKY_DRAW_LEDGER_PATH || 'public/lucky-draw-ledger.json'
const contractAddress = argValue('--contract') || env.DRAW_CONTRACT_ADDRESS || ''
if (!contractAddress) {
  throw new Error('Draw contract address is required. Pass --contract <address> or set DRAW_CONTRACT_ADDRESS.')
}

const ledger = JSON.parse(readFileSync(new URL(`../${ledgerPath}`, import.meta.url), 'utf8'))
const ledgerHash = String(ledger.ledgerHash || '')
const totalTickets = BigInt(ledger.totalFinalTickets || 0)
const prizeSlotCount = BigInt(argValue('--prize-slots') || env.INITIAL_PRIZE_SLOT_COUNT || 21)
const batchSize = Math.max(1, Number(argValue('--batch-size') || env.DRAW_BATCH_SIZE || 1))
const revealOrder = parseRevealOrder(argValue('--reveal-order') || env.DRAW_REVEAL_ORDER || '', prizeSlotCount)
if (!/^0x[a-fA-F0-9]{64}$/.test(ledgerHash)) throw new Error('ledgerHash must be bytes32')
if (ledger.candidateSourceLimited) throw new Error('cannot run draw round with a limited candidate ledger')
if (totalTickets < prizeSlotCount) throw new Error('ledger total tickets must cover all prize slots')

const expectedChainId = BigInt(env.BSC_CHAIN_ID || 56)
const provider = new JsonRpcProvider(required(env, 'BSC_RPC_URL'), Number(expectedChainId))
const wallet = new Wallet(required(env, 'BSC_DEPLOYER_PRIVATE_KEY'), provider)
const network = await provider.getNetwork()
if (network.chainId !== expectedChainId) {
  throw new Error(`RPC chainId ${network.chainId} does not match expected ${expectedChainId}.`)
}

const artifact = JSON.parse(readFileSync(ARTIFACT_FILE, 'utf8'))
const raffle = new Contract(contractAddress, artifact.abi, wallet)
const txs = []

let status = parseRoundStatus(await raffle.roundStatus())
if (!status.finalized) {
  const finalizeTx = await raffle.finalizeLedger(ledgerHash, totalTickets, prizeSlotCount, ledgerPath)
  txs.push({ step: 'finalizeLedger', hash: finalizeTx.hash })
  await finalizeTx.wait()
  status = parseRoundStatus(await raffle.roundStatus())
}

if (status.ledgerHash.toLowerCase() !== ledgerHash.toLowerCase()) {
  throw new Error(`Contract ledger hash ${status.ledgerHash} does not match ${ledgerHash}.`)
}
if (status.totalTickets !== totalTickets) {
  throw new Error(`Contract total tickets ${status.totalTickets} does not match ${totalTickets}.`)
}
if (status.prizeSlotCount !== prizeSlotCount) {
  throw new Error(`Contract prize slots ${status.prizeSlotCount} does not match ${prizeSlotCount}.`)
}

if (!status.requested) {
  const requestTx = await raffle.requestDraw()
  txs.push({ step: 'requestDraw', hash: requestTx.hash })
  await requestTx.wait()
}

let state = Number(await raffle.state())
if (state === 2) {
  state = await waitForRandomnessReady(raffle, Number(argValue('--timeout-ms') || 10 * 60 * 1000), 10_000)
}
if (state < 3) throw new Error(`Round is not ready for drawNext. Current state: ${state}`)

status = parseRoundStatus(await raffle.roundStatus())
const revealedTickets = []
let revealedPrizeSlots = await raffle.revealedPrizeSlots()
while (!status.fulfilled && status.winnerCount < prizeSlotCount) {
  const alreadyRevealed = new Set(revealedPrizeSlots.map((slot) => Number(slot)))
  const nextPrizeSlots = revealOrder
    .filter((slot) => !alreadyRevealed.has(slot))
    .slice(0, Math.min(batchSize, Number(prizeSlotCount - status.winnerCount)))
  if (nextPrizeSlots.length === 0) throw new Error('no remaining prize slots to reveal.')

  const drawTx =
    nextPrizeSlots.length === 1
      ? await raffle.drawPrizeSlot(nextPrizeSlots[0])
      : await raffle.drawPrizeSlots(nextPrizeSlots)
  const receipt = await drawTx.wait()
  const winnerEvents = receipt.logs
    .map((log) => {
      try {
        return raffle.interface.parseLog(log)
      } catch {
        return null
      }
    })
    .filter((event) => event?.name === 'PrizeWinnerDrawn')
  if (winnerEvents.length !== nextPrizeSlots.length) {
    throw new Error(`expected ${nextPrizeSlots.length} PrizeWinnerDrawn events, got ${winnerEvents.length}.`)
  }
  for (let index = 0; index < winnerEvents.length; index++) {
    const winnerEvent = winnerEvents[index]
    if (Number(winnerEvent.args.prizeSlotIndex) !== nextPrizeSlots[index]) {
      throw new Error(`expected prize slot ${nextPrizeSlots[index]}, got ${winnerEvent.args.prizeSlotIndex}.`)
    }
    revealedTickets.push(winnerEvent.args.ticketNumber.toString())
  }
  txs.push({
    step: nextPrizeSlots.length === 1 ? 'drawPrizeSlot' : 'drawPrizeSlots',
    count: nextPrizeSlots.length,
    prizeSlotIndexes: winnerEvents.map((event) => event.args.prizeSlotIndex.toString()),
    revealIndexes: winnerEvents.map((event) => event.args.revealIndex.toString()),
    ticketNumbers: winnerEvents.map((event) => event.args.ticketNumber.toString()),
    hash: drawTx.hash,
  })
  status = parseRoundStatus(await raffle.roundStatus())
  revealedPrizeSlots = await raffle.revealedPrizeSlots()
}

const winnerTicketsBySlot = await raffle.winnerTicketsBySlot()
revealedPrizeSlots = await raffle.revealedPrizeSlots()
const storedRevealedTickets = await raffle.revealedTickets()
const winnerTickets = await raffle.winnerTickets()
const unique = new Set(winnerTicketsBySlot.map((ticket) => ticket.toString()))
if (winnerTicketsBySlot.length !== Number(prizeSlotCount)) {
  throw new Error(`expected ${prizeSlotCount} slot winners, got ${winnerTicketsBySlot.length}`)
}
if (storedRevealedTickets.length !== Number(prizeSlotCount)) {
  throw new Error(`expected ${prizeSlotCount} revealed winners, got ${storedRevealedTickets.length}`)
}
if (revealedPrizeSlots.length !== Number(prizeSlotCount)) {
  throw new Error(`expected ${prizeSlotCount} revealed prize slots, got ${revealedPrizeSlots.length}`)
}
if (unique.size !== Number(prizeSlotCount)) throw new Error('winner tickets are not unique')
for (const ticket of winnerTicketsBySlot) {
  if (ticket < 1n || ticket > totalTickets) throw new Error(`winner ticket out of range: ${ticket}`)
}
for (let revealIndex = 0; revealIndex < Number(prizeSlotCount); revealIndex++) {
  const prizeSlotIndex = Number(revealedPrizeSlots[revealIndex])
  if (winnerTickets[revealIndex] !== storedRevealedTickets[revealIndex]) {
    throw new Error(`legacy winnerTickets mismatch at reveal ${revealIndex}`)
  }
  if (storedRevealedTickets[revealIndex] !== winnerTicketsBySlot[prizeSlotIndex]) {
    throw new Error(`reveal/slot winner mismatch at reveal ${revealIndex}`)
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      envFile: envFilePath,
      network: network.name || `chain-${network.chainId}`,
      chainId: network.chainId.toString(),
      contract: contractAddress,
      ledgerHash,
      totalTickets: totalTickets.toString(),
      prizeSlotCount: prizeSlotCount.toString(),
      batchSize,
      revealOrder,
      winnerCount: winnerTicketsBySlot.length,
      firstFiveWinnerTicketsBySlot: winnerTicketsBySlot.slice(0, 5).map((ticket) => ticket.toString()),
      firstFiveRevealedTickets: storedRevealedTickets.slice(0, 5).map((ticket) => ticket.toString()),
      revealedPrizeSlots: revealedPrizeSlots.map((slot) => slot.toString()),
      revealedTickets,
      txs,
      balanceBNB: ethers.formatEther(await provider.getBalance(wallet.address)),
    },
    null,
    2,
  ),
)
