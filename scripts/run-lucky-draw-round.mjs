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
while (!status.fulfilled && status.winnerCount < prizeSlotCount) {
  const remainingSlots = prizeSlotCount - status.winnerCount
  const drawCount = Math.min(batchSize, Number(remainingSlots))
  const drawTx = drawCount === 1 ? await raffle.drawNext() : await raffle.drawBatch(drawCount)
  const receipt = await drawTx.wait()
  const winnerEvents = receipt.logs
    .map((log) => {
      try {
        return raffle.interface.parseLog(log)
      } catch {
        return null
      }
    })
    .filter((event) => event?.name === 'WinnerDrawn')
  if (winnerEvents.length !== drawCount) {
    throw new Error(`expected ${drawCount} WinnerDrawn events, got ${winnerEvents.length}.`)
  }
  for (const winnerEvent of winnerEvents) {
    revealedTickets.push(winnerEvent.args.ticketNumber.toString())
  }
  txs.push({
    step: drawCount === 1 ? 'drawNext' : 'drawBatch',
    count: drawCount,
    firstSlotIndex: winnerEvents[0].args.slotIndex.toString(),
    ticketNumbers: winnerEvents.map((event) => event.args.ticketNumber.toString()),
    hash: drawTx.hash,
  })
  status = parseRoundStatus(await raffle.roundStatus())
}

const winnerTickets = await raffle.winnerTickets()
const unique = new Set(winnerTickets.map((ticket) => ticket.toString()))
if (winnerTickets.length !== Number(prizeSlotCount)) {
  throw new Error(`expected ${prizeSlotCount} winners, got ${winnerTickets.length}`)
}
if (unique.size !== Number(prizeSlotCount)) throw new Error('winner tickets are not unique')
for (const ticket of winnerTickets) {
  if (ticket < 1n || ticket > totalTickets) throw new Error(`winner ticket out of range: ${ticket}`)
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
      winnerCount: winnerTickets.length,
      firstFiveWinnerTickets: winnerTickets.slice(0, 5).map((ticket) => ticket.toString()),
      revealedTickets,
      txs,
      balanceBNB: ethers.formatEther(await provider.getBalance(wallet.address)),
    },
    null,
    2,
  ),
)
