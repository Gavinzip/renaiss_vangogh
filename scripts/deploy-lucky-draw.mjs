import { existsSync, readFileSync } from 'node:fs'
import { Contract, ContractFactory, JsonRpcProvider, Wallet, ethers } from 'ethers'

const ARTIFACT_FILE = new URL('../artifacts/contracts/RenaissLuckyDraw.sol/RenaissLuckyDraw.json', import.meta.url)

const COORDINATOR_ABI = [
  'function createSubscription() external returns (uint256 subId)',
  'function fundSubscriptionWithNative(uint256 subId) external payable',
  'function addConsumer(uint256 subId, address consumer) external',
  'event SubscriptionCreated(uint256 indexed subId, address owner)',
]

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

const envFilePath = argValue('--env-file') || process.env.DEPLOY_ENV_FILE || '.env.deploy.local'
const ENV_FILE = new URL(`../${envFilePath}`, import.meta.url)

function loadEnvFile() {
  if (!existsSync(ENV_FILE)) return {}
  return Object.fromEntries(
    readFileSync(ENV_FILE, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      }),
  )
}

const fileEnv = loadEnvFile()
const env = { ...fileEnv, ...process.env }
const broadcast = process.argv.includes('--broadcast')

function required(key) {
  const value = env[key]
  if (!value) throw new Error(`${key} is required. Run npm run wallet:create first.`)
  return value
}

function optionalInt(key, fallback) {
  const value = env[key]
  return value ? Number(value) : fallback
}

function optionalBool(key, fallback) {
  const value = env[key]
  if (!value) return fallback
  return ['1', 'true', 'yes'].includes(value.toLowerCase())
}

function optionalAddress(key, fallback) {
  const value = env[key] || fallback
  if (!value) return ''
  if (!ethers.isAddress(value)) throw new Error(`${key} must be a valid EVM address.`)
  return ethers.getAddress(value)
}

function parseSubscriptionId(receipt, coordinator) {
  for (const log of receipt.logs) {
    try {
      const parsed = coordinator.interface.parseLog(log)
      if (parsed?.name === 'SubscriptionCreated') return parsed.args.subId
    } catch {
      // Ignore logs from other contracts in the same receipt.
    }
  }
  return 0n
}

const rpcUrl = required('BSC_RPC_URL')
const privateKey = required('BSC_DEPLOYER_PRIVATE_KEY')
const expectedChainId = BigInt(optionalInt('BSC_CHAIN_ID', 56))
const provider = new JsonRpcProvider(rpcUrl, Number(expectedChainId))
const wallet = new Wallet(privateKey, provider)

const network = await provider.getNetwork()
if (network.chainId !== expectedChainId) {
  throw new Error(`RPC chainId ${network.chainId} does not match expected ${expectedChainId}.`)
}

const balance = await provider.getBalance(wallet.address)
const coordinatorAddress = required('VRF_COORDINATOR')
const keyHash = required('VRF_KEY_HASH')
const requestConfirmations = optionalInt('VRF_REQUEST_CONFIRMATIONS', 3)
const callbackGasLimit = optionalInt('VRF_CALLBACK_GAS_LIMIT', 750000)
const nativePayment = optionalBool('VRF_NATIVE_PAYMENT', true)
const initialPrizeSlotCount = optionalInt('INITIAL_PRIZE_SLOT_COUNT', 21)
const configuredSubscriptionId = env.VRF_SUBSCRIPTION_ID ? BigInt(env.VRF_SUBSCRIPTION_ID) : 0n
const targetDrawOperator = optionalAddress('DRAW_OPERATOR_ADDRESS', '0x88b620388698490764fd85cfa482b5e3a8ad63b5')
const targetOwner = optionalAddress('DRAW_OWNER_ADDRESS', env.DRAW_OPERATOR_ADDRESS || targetDrawOperator)

const safeConfig = {
  envFile: envFilePath,
  deployer: wallet.address,
  network: network.name || `chain-${network.chainId}`,
  chainId: network.chainId.toString(),
  balanceBNB: ethers.formatEther(balance),
  vrfCoordinator: coordinatorAddress,
  keyHash,
  configuredSubscriptionId: configuredSubscriptionId.toString(),
  requestConfirmations,
  callbackGasLimit,
  nativePayment,
  initialPrizeSlotCount,
  targetDrawOperator,
  targetOwner,
}

if (!broadcast) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        broadcast: false,
        message: 'No transaction sent. Fund the deployer and rerun this command with --broadcast to deploy.',
        ...safeConfig,
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

if (balance === 0n) {
  throw new Error(`Deployment wallet has 0 BNB: ${wallet.address}`)
}

const coordinator = new Contract(coordinatorAddress, COORDINATOR_ABI, wallet)
let subscriptionId = configuredSubscriptionId
const txs = []

if (subscriptionId === 0n) {
  const createTx = await coordinator.createSubscription()
  txs.push({ step: 'createSubscription', hash: createTx.hash })
  const createReceipt = await createTx.wait()
  subscriptionId = parseSubscriptionId(createReceipt, coordinator)
  if (subscriptionId === 0n) throw new Error('Could not read SubscriptionCreated event from VRF coordinator.')

  const fundAmount = ethers.parseEther(env.VRF_NATIVE_FUND_BNB || '0.05')
  if (fundAmount > 0n) {
    const fundTx = await coordinator.fundSubscriptionWithNative(subscriptionId, { value: fundAmount })
    txs.push({ step: 'fundSubscriptionWithNative', hash: fundTx.hash, amountBNB: ethers.formatEther(fundAmount) })
    await fundTx.wait()
  }
}

const artifact = JSON.parse(readFileSync(ARTIFACT_FILE, 'utf8'))
const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet)
const raffle = await factory.deploy(
  coordinatorAddress,
  keyHash,
  subscriptionId,
  requestConfirmations,
  callbackGasLimit,
  nativePayment,
  initialPrizeSlotCount,
)
txs.push({ step: 'deployRenaissLuckyDraw', hash: raffle.deploymentTransaction()?.hash || '' })
await raffle.waitForDeployment()
const raffleAddress = await raffle.getAddress()

const addConsumerTx = await coordinator.addConsumer(subscriptionId, raffleAddress)
txs.push({ step: 'addConsumer', hash: addConsumerTx.hash })
await addConsumerTx.wait()

if (targetDrawOperator && targetDrawOperator.toLowerCase() !== wallet.address.toLowerCase()) {
  const operatorTx = await raffle.setDrawOperator(targetDrawOperator)
  txs.push({ step: 'setDrawOperator', operator: targetDrawOperator, hash: operatorTx.hash })
  await operatorTx.wait()
}

let ownerTransferPending = false
if (targetOwner && targetOwner.toLowerCase() !== wallet.address.toLowerCase()) {
  const ownerTx = await raffle.transferOwnership(targetOwner)
  txs.push({ step: 'transferOwnership', pendingOwner: targetOwner, hash: ownerTx.hash })
  await ownerTx.wait()
  ownerTransferPending = true
}

console.log(
  JSON.stringify(
    {
      ok: true,
      broadcast: true,
      deployer: wallet.address,
      owner: ownerTransferPending ? wallet.address : targetOwner || wallet.address,
      pendingOwner: ownerTransferPending ? targetOwner : null,
      drawOperator: targetDrawOperator || wallet.address,
      subscriptionId: subscriptionId.toString(),
      raffle: raffleAddress,
      frontendContractAddress: raffleAddress,
      frontendNote: 'Update src/lib/contracts/luckyDrawAbi.ts if this deployment becomes the active draw contract.',
      txs,
    },
    null,
    2,
  ),
)
