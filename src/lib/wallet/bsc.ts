import { BrowserProvider, Contract, getAddress, JsonRpcProvider } from 'ethers'
import { luckyDrawAbi } from '../contracts/luckyDrawAbi'
import { DRAW_NETWORKS, type DrawNetworkKey } from '../contracts/luckyDrawNetworks'
import type { DrawVrfSubscriptionStatus } from './vrfSubscription'
import type { Eip1193Provider } from './providers'

export const BSC_MAINNET_CHAIN_ID = DRAW_NETWORKS.mainnet.chainId
export const BSC_TESTNET_CHAIN_ID = DRAW_NETWORKS.testnet.chainId

export interface ConnectedWallet {
  address: string
  chainId: bigint
  chainName: string
  injectedProvider?: Eip1193Provider
  provider: BrowserProvider
  walletName?: string
}

export interface DrawStatus {
  finalized: boolean
  requested: boolean
  fulfilled: boolean
  state: number
  totalTickets: bigint
  firstWinningTicket: bigint
  ledgerHash: string
  prizeSlotCount: bigint
  winnerCount: bigint
  winnerTickets: bigint[]
  revealedPrizeSlots: bigint[]
  revealedTickets: bigint[]
  winnerTicketsBySlot: bigint[]
  reserveTicketsBySlot: bigint[][]
  ownerAddress: string
  drawOperatorAddress: string
  connectedWalletIsAdmin: boolean
  supportsAdminWhitelist: boolean
  supportsSelectablePrizeSlots: boolean
  vrfSubscription: DrawVrfSubscriptionStatus | null
  vrfSubscriptionError: string
}

export type DrawAdminRole = 'owner' | 'operator' | 'admin'

export interface DrawAdminMember {
  address: string
  role: DrawAdminRole
  allowed: boolean
  blockNumber?: number
  transactionHash?: string
}

export interface DrawAdminList {
  ownerAddress: string
  drawOperatorAddress: string
  admins: DrawAdminMember[]
  members: DrawAdminMember[]
  supportsAdminWhitelist: boolean
  scannedFromBlock: number
  scannedToBlock: number
}

export interface ContractRevealResult {
  prizeSlotIndex: number
  reserveTickets: bigint[]
  ticket: bigint
}

export type ContractTransactionSubmitted = (hash: string) => void

interface ContractWriteOverrides {
  gasLimit: bigint
}

interface SubmittedContractTransaction {
  hash: string
  wait: () => Promise<{ hash?: string } | null>
}

const binanceVrfCoordinatorAbi = [
  'function getSubscription(uint64 subId) view returns (uint96 balance, uint64 reqCount, address owner, address[] memory consumers)',
  'function pendingRequestExists(uint64 subId) view returns (bool)',
] as const

const ADMIN_EVENT_BLOCK_CHUNK_SIZE = 2500
const DRAW_STATUS_CORE_READ_TIMEOUT_MS = 8000
const CONTRACT_WRITE_GAS_BUFFER_BPS = 13_000n
const GAS_BPS_DENOMINATOR = 10_000n
const VRF_SUBSCRIPTION_READ_TIMEOUT_MS = 2500

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)

    promise.then(
      (value) => {
        globalThis.clearTimeout(timeoutId)
        resolve(value)
      },
      (error: unknown) => {
        globalThis.clearTimeout(timeoutId)
        reject(error)
      },
    )
  })
}

function attachBigIntArrayJson<T extends bigint[]>(value: T): T {
  Object.defineProperty(value, 'toJSON', {
    configurable: true,
    enumerable: false,
    value: () => value.map((item) => item.toString()),
  })
  return value
}

function vrfSubscriptionJson(value: DrawVrfSubscriptionStatus | null) {
  if (!value) return null
  return {
    ...value,
    balance: value.balance.toString(),
    callbackGasLimit: value.callbackGasLimit.toString(),
    requestCount: value.requestCount.toString(),
    subscriptionId: value.subscriptionId.toString(),
  }
}

export function makeDrawStatusSerializable(status: DrawStatus): DrawStatus {
  const nextStatus = {
    ...status,
    winnerTickets: attachBigIntArrayJson([...status.winnerTickets]),
    revealedPrizeSlots: attachBigIntArrayJson([...status.revealedPrizeSlots]),
    revealedTickets: attachBigIntArrayJson([...status.revealedTickets]),
    winnerTicketsBySlot: attachBigIntArrayJson([...status.winnerTicketsBySlot]),
    reserveTicketsBySlot: status.reserveTicketsBySlot.map((reserveTickets) => attachBigIntArrayJson([...reserveTickets])),
  }

  Object.defineProperty(nextStatus, 'toJSON', {
    configurable: true,
    enumerable: false,
    value: () => ({
      ...nextStatus,
      firstWinningTicket: nextStatus.firstWinningTicket.toString(),
      prizeSlotCount: nextStatus.prizeSlotCount.toString(),
      totalTickets: nextStatus.totalTickets.toString(),
      vrfSubscription: vrfSubscriptionJson(nextStatus.vrfSubscription),
      winnerCount: nextStatus.winnerCount.toString(),
    }),
  })

  return nextStatus
}

function addressesMatch(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase()
}

function chainNameForChainId(chainId: bigint) {
  return Object.values(DRAW_NETWORKS).find((network) => network.chainId === chainId)?.chainName ?? `Chain ${chainId.toString()}`
}

function parseInjectedChainId(value: unknown): bigint {
  if (typeof value === 'string') return BigInt(value)
  if (typeof value === 'number') return BigInt(value)
  throw new Error('Injected wallet returned an invalid chain id.')
}

type WalletRequestProvider = BrowserProvider | Eip1193Provider | undefined

function isBrowserProvider(provider: WalletRequestProvider): provider is BrowserProvider {
  return Boolean(
    provider &&
      typeof (provider as BrowserProvider).getSigner === 'function' &&
      typeof (provider as BrowserProvider).send === 'function',
  )
}

async function requestWalletProvider(provider: WalletRequestProvider, method: string, params: unknown[] = []): Promise<unknown> {
  const activeProvider = provider ?? window.ethereum
  if (!activeProvider) throw new Error('No injected wallet found.')
  if (isBrowserProvider(activeProvider)) return activeProvider.send(method, params)
  return activeProvider.request({ method, params })
}

async function readInjectedChainId(provider?: WalletRequestProvider): Promise<bigint> {
  return parseInjectedChainId(await requestWalletProvider(provider, 'eth_chainId'))
}

function createReadOnlyProvider(networkKey: DrawNetworkKey) {
  const network = DRAW_NETWORKS[networkKey]
  return new JsonRpcProvider(network.rpcUrls[0], Number(network.chainId), { staticNetwork: true })
}

function createReadOnlyProviders(networkKey: DrawNetworkKey) {
  const network = DRAW_NETWORKS[networkKey]
  const rpcUrls = Array.from(new Set([...network.rpcUrls, ...network.logRpcUrls]))
  return rpcUrls.map((rpcUrl) => new JsonRpcProvider(rpcUrl, Number(network.chainId), { staticNetwork: true }))
}

function createLogProvider(networkKey: DrawNetworkKey) {
  const network = DRAW_NETWORKS[networkKey]
  return new JsonRpcProvider(network.logRpcUrls[0], Number(network.chainId), { staticNetwork: true })
}

function createInjectedBrowserProvider(provider?: Eip1193Provider) {
  const injectedProvider = provider ?? window.ethereum
  if (!injectedProvider) throw new Error('No injected wallet found.')
  return new BrowserProvider(injectedProvider)
}

function createConnectedWallet({
  address,
  chainId,
  injectedProvider,
  walletName,
}: {
  address: string
  chainId: bigint
  injectedProvider: Eip1193Provider
  walletName?: string
}): ConnectedWallet {
  const visibleWallet = {
    address,
    chainId,
    chainName: chainNameForChainId(chainId),
    walletName,
  }
  Object.defineProperties(visibleWallet, {
    injectedProvider: {
      configurable: true,
      enumerable: false,
      value: injectedProvider,
    },
    provider: {
      configurable: true,
      enumerable: false,
      value: createInjectedBrowserProvider(injectedProvider),
    },
  })
  return visibleWallet as ConnectedWallet
}

async function createWalletProviderForNetwork(provider: WalletRequestProvider, networkKey: DrawNetworkKey) {
  await ensureBscNetwork(provider, networkKey)
  if (isBrowserProvider(provider)) return provider
  return createInjectedBrowserProvider(provider)
}

async function contractWithSigner(provider: WalletRequestProvider, contractAddress: string, networkKey: DrawNetworkKey) {
  const activeProvider = await createWalletProviderForNetwork(provider, networkKey)
  const signer = await activeProvider.getSigner()
  return new Contract(contractAddress, luckyDrawAbi, signer)
}

function addContractWriteGasBuffer(estimatedGas: bigint) {
  return (estimatedGas * CONTRACT_WRITE_GAS_BUFFER_BPS + GAS_BPS_DENOMINATOR - 1n) / GAS_BPS_DENOMINATOR
}

async function submitContractWrite(
  estimateGas: () => Promise<bigint>,
  sendTransaction: (overrides: ContractWriteOverrides) => Promise<SubmittedContractTransaction>,
  onSubmitted?: ContractTransactionSubmitted,
): Promise<string> {
  const gasLimit = addContractWriteGasBuffer(await estimateGas())
  const tx = await sendTransaction({ gasLimit })
  onSubmitted?.(tx.hash)
  const receipt = await tx.wait()
  return receipt?.hash || tx.hash
}

function safeChecksumAddress(value: unknown): string {
  if (typeof value !== 'string') return ''
  try {
    return getAddress(value)
  } catch {
    return ''
  }
}

type DrawAdminChangedLog = {
  args?: { admin?: unknown; allowed?: unknown; 0?: unknown; 1?: unknown } | readonly unknown[]
  blockNumber: number
  transactionHash: string
}

function parseDrawAdminChangedLog(log: unknown): DrawAdminMember | null {
  const eventLog = log as DrawAdminChangedLog
  const args = eventLog.args
  let adminValue: unknown
  let allowedValue: unknown
  if (Array.isArray(args)) {
    adminValue = args[0]
    allowedValue = args[1]
  } else {
    const namedArgs = args as { admin?: unknown; allowed?: unknown; 0?: unknown; 1?: unknown } | undefined
    adminValue = namedArgs?.admin ?? namedArgs?.[0]
    allowedValue = namedArgs?.allowed ?? namedArgs?.[1]
  }
  const address = safeChecksumAddress(adminValue)
  if (!address) return null
  return {
    address,
    role: 'admin',
    allowed: Boolean(allowedValue),
    blockNumber: eventLog.blockNumber,
    transactionHash: eventLog.transactionHash,
  }
}

async function readAdminChangeEvents(contract: Contract, fromBlock: number, toBlock: number): Promise<DrawAdminMember[]> {
  const members: DrawAdminMember[] = []
  const filter = contract.filters.DrawAdminChanged()
  for (let chunkFromBlock = fromBlock; chunkFromBlock <= toBlock; chunkFromBlock += ADMIN_EVENT_BLOCK_CHUNK_SIZE) {
    const chunkToBlock = Math.min(chunkFromBlock + ADMIN_EVENT_BLOCK_CHUNK_SIZE - 1, toBlock)
    const logs = await contract.queryFilter(filter, chunkFromBlock, chunkToBlock)
    for (const log of logs) {
      const member = parseDrawAdminChangedLog(log)
      if (member) members.push(member)
    }
  }
  return members
}

async function readWalletAdminPermission(
  contractAddress: string,
  networkKey: DrawNetworkKey,
  walletAddress: string,
  preferredProvider?: BrowserProvider,
) {
  const checkedWalletAddress = safeChecksumAddress(walletAddress)
  if (!checkedWalletAddress) return false

  const providers = preferredProvider
    ? [preferredProvider, ...createReadOnlyProviders(networkKey)]
    : createReadOnlyProviders(networkKey)
  const permissionReads = providers.map(async (provider) => {
    const contract = new Contract(contractAddress, luckyDrawAbi, provider)
    return Boolean(
      await withTimeout(
        contract.isAdmin(checkedWalletAddress),
        DRAW_STATUS_CORE_READ_TIMEOUT_MS,
        'Timed out reading wallet admin permission. Please refresh status again.',
      ),
    )
  })

  const results = await Promise.allSettled(permissionReads)
  const fulfilledResults = results.filter((result): result is PromiseFulfilledResult<boolean> => result.status === 'fulfilled')
  if (fulfilledResults.some((result) => result.value)) return true
  if (fulfilledResults.length > 0) return false

  const rejectedResult = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  throw rejectedResult?.reason instanceof Error ? rejectedResult.reason : new Error('Could not read wallet admin permission.')
}

export async function readDrawAdminList(contractAddress: string, networkKey: DrawNetworkKey): Promise<DrawAdminList> {
  const network = DRAW_NETWORKS[networkKey]
  const provider = createReadOnlyProvider(networkKey)
  const logProvider = createLogProvider(networkKey)
  const contract = new Contract(contractAddress, luckyDrawAbi, provider)
  const logContract = new Contract(contractAddress, luckyDrawAbi, logProvider)
  const [ownerAddress, drawOperatorAddress, latestBlock] = await Promise.all([
    contract.owner(),
    contract.drawOperator(),
    provider.getBlockNumber(),
  ])
  const scannedFromBlock = Math.min(network.deploymentBlock, latestBlock)
  const scannedToBlock = latestBlock

  let supportsAdminWhitelist = true
  try {
    await contract.isAdmin(ownerAddress)
  } catch {
    supportsAdminWhitelist = false
  }

  const ownerMember: DrawAdminMember = {
    address: getAddress(ownerAddress),
    role: 'owner',
    allowed: true,
  }
  const operatorAddress = getAddress(drawOperatorAddress)
  const operatorMember: DrawAdminMember | null = addressesMatch(operatorAddress, ownerMember.address)
    ? null
    : {
        address: operatorAddress,
        role: 'operator',
        allowed: true,
      }

  if (!supportsAdminWhitelist) {
    const members = operatorMember ? [ownerMember, operatorMember] : [ownerMember]
    return {
      ownerAddress: ownerMember.address,
      drawOperatorAddress: operatorAddress,
      admins: [],
      members,
      supportsAdminWhitelist,
      scannedFromBlock,
      scannedToBlock,
    }
  }

  const changedMembers = await readAdminChangeEvents(logContract, scannedFromBlock, scannedToBlock)
  const latestAdminState = new Map<string, DrawAdminMember>()
  for (const member of changedMembers) {
    latestAdminState.set(member.address.toLowerCase(), member)
  }

  const candidateAdmins = [...latestAdminState.values()].filter(
    (member) =>
      member.allowed &&
      !addressesMatch(member.address, ownerMember.address) &&
      !addressesMatch(member.address, operatorAddress),
  )
  const verifiedAdmins = (
    await Promise.all(
      candidateAdmins.map(async (member) => {
        const isAllowed = Boolean(await contract.isAdmin(member.address))
        return isAllowed ? member : null
      }),
    )
  ).filter((member): member is DrawAdminMember => Boolean(member))
  const members = [ownerMember, ...(operatorMember ? [operatorMember] : []), ...verifiedAdmins]

  return {
    ownerAddress: ownerMember.address,
    drawOperatorAddress: operatorAddress,
    admins: verifiedAdmins,
    members,
    supportsAdminWhitelist,
    scannedFromBlock,
    scannedToBlock,
  }
}

export async function setDrawAdminAllowed(
  provider: WalletRequestProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  adminAddress: string,
  allowed: boolean,
  onSubmitted?: ContractTransactionSubmitted,
): Promise<string> {
  const normalizedAddress = getAddress(adminAddress)
  const contract = await contractWithSigner(provider, contractAddress, networkKey)
  return submitContractWrite(
    () => contract.setAdmin.estimateGas(normalizedAddress, allowed),
    (overrides) => contract.setAdmin(normalizedAddress, allowed, overrides),
    onSubmitted,
  )
}

export async function readConnectedWallet(provider?: Eip1193Provider, walletName?: string): Promise<ConnectedWallet | null> {
  const injectedProvider = provider ?? window.ethereum
  if (!injectedProvider) return null
  const accounts = await requestWalletProvider(injectedProvider, 'eth_accounts')
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') return null
  const chainId = await readInjectedChainId(injectedProvider)
  return createConnectedWallet({
    address: accounts[0],
    chainId,
    injectedProvider,
    walletName,
  })
}

export async function connectInjectedWallet(
  networkKey: DrawNetworkKey,
  provider?: Eip1193Provider,
  walletName?: string,
): Promise<ConnectedWallet> {
  const injectedProvider = provider ?? window.ethereum
  if (!injectedProvider) {
    throw new Error('No injected wallet found. Use MetaMask, Rabby, or another BSC-compatible wallet.')
  }
  await requestWalletProvider(injectedProvider, 'eth_requestAccounts')
  await ensureBscNetwork(injectedProvider, networkKey)
  const wallet = await readConnectedWallet(injectedProvider, walletName)
  if (!wallet) throw new Error('No wallet account is connected.')
  return wallet
}

export async function ensureBscNetwork(provider: WalletRequestProvider, networkKey: DrawNetworkKey): Promise<void> {
  const expectedNetwork = DRAW_NETWORKS[networkKey]
  const hexChainId = `0x${expectedNetwork.chainId.toString(16)}`
  const currentChainId = await readInjectedChainId(provider)
  if (currentChainId === expectedNetwork.chainId) return

  try {
    await requestWalletProvider(provider, 'wallet_switchEthereumChain', [{ chainId: hexChainId }])
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? Number(error.code) : 0
    if (code !== 4902) {
      throw new Error(`Please switch wallet network to ${expectedNetwork.chainName}.`, {
        cause: error,
      })
    }
    await requestWalletProvider(provider, 'wallet_addEthereumChain', [
      {
        chainId: hexChainId,
        chainName: expectedNetwork.chainName,
        nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
        rpcUrls: expectedNetwork.rpcUrls,
        blockExplorerUrls: expectedNetwork.blockExplorerUrls,
      },
    ])
    await requestWalletProvider(provider, 'wallet_switchEthereumChain', [{ chainId: hexChainId }])
  }

  const nextChainId = await readInjectedChainId(provider)
  if (nextChainId !== expectedNetwork.chainId) {
    throw new Error(`Please switch wallet network to ${expectedNetwork.chainName}.`)
  }
}

export async function finalizeContractLedger(
  provider: WalletRequestProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  ledgerHash: string,
  totalTickets: number,
  prizeSlotCount: number,
  ledgerUri: string,
  onSubmitted?: ContractTransactionSubmitted,
): Promise<string> {
  const contract = await contractWithSigner(provider, contractAddress, networkKey)
  const totalTicketCount = BigInt(totalTickets)
  const slotCount = BigInt(prizeSlotCount)
  return submitContractWrite(
    () => contract.finalizeLedger.estimateGas(ledgerHash, totalTicketCount, slotCount, ledgerUri),
    (overrides) => contract.finalizeLedger(ledgerHash, totalTicketCount, slotCount, ledgerUri, overrides),
    onSubmitted,
  )
}

export async function requestContractDraw(
  provider: WalletRequestProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  onSubmitted?: ContractTransactionSubmitted,
): Promise<string> {
  const contract = await contractWithSigner(provider, contractAddress, networkKey)
  return submitContractWrite(
    () => contract.requestDraw.estimateGas(),
    (overrides) => contract.requestDraw(overrides),
    onSubmitted,
  )
}

export async function drawNextWinner(
  provider: WalletRequestProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  onSubmitted?: ContractTransactionSubmitted,
): Promise<string> {
  const contract = await contractWithSigner(provider, contractAddress, networkKey)
  return submitContractWrite(
    () => contract.drawNext.estimateGas(),
    (overrides) => contract.drawNext(overrides),
    onSubmitted,
  )
}

export async function drawBatchWinners(
  provider: WalletRequestProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  count: number,
  onSubmitted?: ContractTransactionSubmitted,
): Promise<string> {
  const contract = await contractWithSigner(provider, contractAddress, networkKey)
  const winnerCount = BigInt(count)
  return submitContractWrite(
    () => contract.drawBatch.estimateGas(winnerCount),
    (overrides) => contract.drawBatch(winnerCount, overrides),
    onSubmitted,
  )
}

export async function drawPrizeSlotWinner(
  provider: WalletRequestProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  prizeSlotIndex: number,
  onSubmitted?: ContractTransactionSubmitted,
): Promise<string> {
  const contract = await contractWithSigner(provider, contractAddress, networkKey)
  const slotIndex = BigInt(prizeSlotIndex)
  return submitContractWrite(
    () => contract.drawPrizeSlot.estimateGas(slotIndex),
    (overrides) => contract.drawPrizeSlot(slotIndex, overrides),
    onSubmitted,
  )
}

export async function drawPrizeSlotWinners(
  provider: WalletRequestProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  prizeSlotIndexes: number[],
  onSubmitted?: ContractTransactionSubmitted,
): Promise<string> {
  const contract = await contractWithSigner(provider, contractAddress, networkKey)
  const slotIndexes = prizeSlotIndexes.map((slotIndex) => BigInt(slotIndex))
  return submitContractWrite(
    () => contract.drawPrizeSlots.estimateGas(slotIndexes),
    (overrides) => contract.drawPrizeSlots(slotIndexes, overrides),
    onSubmitted,
  )
}

export async function drawRandomPrizeSlotWinner(
  provider: WalletRequestProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  onSubmitted?: ContractTransactionSubmitted,
): Promise<string> {
  const contract = await contractWithSigner(provider, contractAddress, networkKey)
  return submitContractWrite(
    () => contract.drawRandomPrizeSlot.estimateGas(),
    (overrides) => contract.drawRandomPrizeSlot(overrides),
    onSubmitted,
  )
}

export async function resetContractDraft(
  provider: WalletRequestProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  onSubmitted?: ContractTransactionSubmitted,
): Promise<string> {
  const contract = await contractWithSigner(provider, contractAddress, networkKey)
  return submitContractWrite(
    () => contract.resetDraft.estimateGas(),
    (overrides) => contract.resetDraft(overrides),
    onSubmitted,
  )
}

export async function readDrawStatus(
  inputProvider: BrowserProvider | undefined,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  walletAddress = '',
): Promise<DrawStatus> {
  const network = DRAW_NETWORKS[networkKey]
  const provider = inputProvider ?? createReadOnlyProvider(networkKey)
  const contract = new Contract(contractAddress, luckyDrawAbi, provider)
  const [
    [
      finalized,
      requested,
      fulfilled,
      totalTickets,
      firstWinningTicket,
      ledgerHash,
      prizeSlotCount,
      winnerCount,
    ],
    state,
    ownerAddress,
    drawOperatorAddress,
  ] = await withTimeout(
    Promise.all([
      contract.roundStatus(),
      contract.state(),
      contract.owner(),
      contract.drawOperator(),
    ]),
    DRAW_STATUS_CORE_READ_TIMEOUT_MS,
    'Timed out reading BSC draw contract status. Please refresh status again.',
  )
  const winnerTickets = winnerCount > 0n
    ? await withTimeout(
        contract.winnerTickets(),
        DRAW_STATUS_CORE_READ_TIMEOUT_MS,
        'Timed out reading revealed winner tickets. Please refresh status again.',
      )
    : []
  let supportsAdminWhitelist = true
  let connectedWalletIsAdmin = false
  if (walletAddress) {
    try {
      connectedWalletIsAdmin = await readWalletAdminPermission(contractAddress, networkKey, walletAddress, inputProvider)
    } catch {
      supportsAdminWhitelist = false
      connectedWalletIsAdmin = addressesMatch(walletAddress, ownerAddress) || addressesMatch(walletAddress, drawOperatorAddress)
    }
  }
  let supportsSelectablePrizeSlots = true
  let revealedPrizeSlots: bigint[]
  let revealedTickets: bigint[]
  let winnerTicketsBySlot: bigint[]
  let reserveTicketsBySlot: bigint[][]
  try {
    ;[revealedPrizeSlots, revealedTickets, winnerTicketsBySlot] = await withTimeout(
      Promise.all([
        contract.revealedPrizeSlots(),
        contract.revealedTickets(),
        contract.winnerTicketsBySlot(),
      ]),
      DRAW_STATUS_CORE_READ_TIMEOUT_MS,
      'Timed out reading reveal progress. Please refresh status again.',
    )
  } catch {
    supportsSelectablePrizeSlots = false
    revealedPrizeSlots = winnerTickets.map((_: bigint, index: number) => BigInt(index))
    revealedTickets = winnerTickets
    winnerTicketsBySlot = Array.from({ length: Number(prizeSlotCount) }, (_, index) => winnerTickets[index] ?? 0n)
  }
  try {
    reserveTicketsBySlot = await withTimeout(
      Promise.all(
        Array.from({ length: Number(prizeSlotCount) }, (_, prizeSlotIndex) => contract.reserveTicketsBySlot(BigInt(prizeSlotIndex))),
      ),
      DRAW_STATUS_CORE_READ_TIMEOUT_MS,
      'Timed out reading reserve tickets. Please refresh status again.',
    )
  } catch {
    reserveTicketsBySlot = Array.from({ length: Number(prizeSlotCount) }, () => [])
  }
  let vrfSubscription: DrawVrfSubscriptionStatus | null = null
  let vrfSubscriptionError = ''
  try {
    const [vrfConfig, contractCoordinatorAddress] = await withTimeout(
      Promise.all([
        contract.vrfConfig(),
        contract.vrfCoordinatorAddress(),
      ]),
      VRF_SUBSCRIPTION_READ_TIMEOUT_MS,
      'Timed out reading Binance Oracle VRF config.',
    )
    if (!addressesMatch(contractCoordinatorAddress, network.vrfCoordinatorAddress)) {
      throw new Error(
        `Active contract uses VRF coordinator ${contractCoordinatorAddress}; redeploy this draw contract with Binance Oracle VRF coordinator ${network.vrfCoordinatorAddress}.`,
      )
    }
    if (!addressesMatch(vrfConfig.keyHash, network.keyHash)) {
      throw new Error(
        `Active contract uses VRF keyHash ${vrfConfig.keyHash}; redeploy or update VRF config to Binance Oracle keyHash ${network.keyHash}.`,
      )
    }

    const coordinator = new Contract(network.vrfCoordinatorAddress, binanceVrfCoordinatorAbi, provider)
    const subscriptionId = BigInt(vrfConfig.subscriptionId)
    const [subscription, pendingRequestExists] = await withTimeout(
      Promise.all([
        coordinator.getSubscription(subscriptionId),
        coordinator.pendingRequestExists(subscriptionId),
      ]),
      VRF_SUBSCRIPTION_READ_TIMEOUT_MS,
      'Timed out reading Binance Oracle subscription status.',
    )
    const consumerAddresses = subscription.consumers.map((consumer: string) => consumer)
    vrfSubscription = {
      callbackGasLimit: BigInt(vrfConfig.callbackGasLimit),
      consumerAddresses,
      contractIsConsumer: consumerAddresses.some((consumer: string) => addressesMatch(consumer, contractAddress)),
      coordinatorAddress: network.vrfCoordinatorAddress,
      keyHash: vrfConfig.keyHash,
      balance: BigInt(subscription.balance),
      ownerAddress: subscription.owner,
      pendingRequestExists: Boolean(pendingRequestExists),
      requestConfirmations: Number(vrfConfig.requestConfirmations),
      requestCount: BigInt(subscription.reqCount),
      subscriptionId,
    }
  } catch (error) {
    vrfSubscriptionError = error instanceof Error ? error.message : String(error)
  }
  return makeDrawStatusSerializable({
    finalized,
    requested,
    fulfilled,
    state: Number(state),
    totalTickets,
    firstWinningTicket,
    ledgerHash,
    prizeSlotCount,
    winnerCount,
    winnerTickets,
    revealedPrizeSlots,
    revealedTickets,
    winnerTicketsBySlot,
    reserveTicketsBySlot,
    ownerAddress,
    drawOperatorAddress,
    connectedWalletIsAdmin,
    supportsAdminWhitelist,
    supportsSelectablePrizeSlots,
    vrfSubscription,
    vrfSubscriptionError,
  })
}
