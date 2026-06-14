import { BrowserProvider, Contract, JsonRpcProvider } from 'ethers'
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
  ownerAddress: string
  drawOperatorAddress: string
  connectedWalletIsAdmin: boolean
  supportsAdminWhitelist: boolean
  supportsSelectablePrizeSlots: boolean
  vrfSubscription: DrawVrfSubscriptionStatus | null
  vrfSubscriptionError: string
}

export interface ContractRevealResult {
  prizeSlotIndex: number
  ticket: bigint
}

export type ContractTransactionSubmitted = (hash: string) => void

const binanceVrfCoordinatorAbi = [
  'function getSubscription(uint64 subId) view returns (uint96 balance, uint64 reqCount, address owner, address[] memory consumers)',
  'function pendingRequestExists(uint64 subId) view returns (bool)',
] as const

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

function createInjectedBrowserProvider(provider?: Eip1193Provider) {
  const injectedProvider = provider ?? window.ethereum
  if (!injectedProvider) throw new Error('No injected wallet found.')
  return new BrowserProvider(injectedProvider)
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

export async function readConnectedWallet(provider?: Eip1193Provider, walletName?: string): Promise<ConnectedWallet | null> {
  const injectedProvider = provider ?? window.ethereum
  if (!injectedProvider) return null
  const accounts = await requestWalletProvider(injectedProvider, 'eth_accounts')
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') return null
  const chainId = await readInjectedChainId(injectedProvider)
  return {
    address: accounts[0],
    chainId,
    chainName: chainNameForChainId(chainId),
    injectedProvider,
    provider: createInjectedBrowserProvider(injectedProvider),
    walletName,
  }
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
  const tx = await contract.finalizeLedger(ledgerHash, BigInt(totalTickets), BigInt(prizeSlotCount), ledgerUri)
  onSubmitted?.(tx.hash)
  const receipt = await tx.wait()
  return receipt?.hash || tx.hash
}

export async function requestContractDraw(
  provider: WalletRequestProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  onSubmitted?: ContractTransactionSubmitted,
): Promise<string> {
  const contract = await contractWithSigner(provider, contractAddress, networkKey)
  const tx = await contract.requestDraw()
  onSubmitted?.(tx.hash)
  const receipt = await tx.wait()
  return receipt?.hash || tx.hash
}

export async function drawNextWinner(
  provider: WalletRequestProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  onSubmitted?: ContractTransactionSubmitted,
): Promise<string> {
  const contract = await contractWithSigner(provider, contractAddress, networkKey)
  const tx = await contract.drawNext()
  onSubmitted?.(tx.hash)
  const receipt = await tx.wait()
  return receipt?.hash || tx.hash
}

export async function drawBatchWinners(
  provider: WalletRequestProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  count: number,
  onSubmitted?: ContractTransactionSubmitted,
): Promise<string> {
  const contract = await contractWithSigner(provider, contractAddress, networkKey)
  const tx = await contract.drawBatch(BigInt(count))
  onSubmitted?.(tx.hash)
  const receipt = await tx.wait()
  return receipt?.hash || tx.hash
}

export async function drawPrizeSlotWinner(
  provider: WalletRequestProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  prizeSlotIndex: number,
  onSubmitted?: ContractTransactionSubmitted,
): Promise<string> {
  const contract = await contractWithSigner(provider, contractAddress, networkKey)
  const tx = await contract.drawPrizeSlot(BigInt(prizeSlotIndex))
  onSubmitted?.(tx.hash)
  const receipt = await tx.wait()
  return receipt?.hash || tx.hash
}

export async function drawPrizeSlotWinners(
  provider: WalletRequestProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  prizeSlotIndexes: number[],
  onSubmitted?: ContractTransactionSubmitted,
): Promise<string> {
  const contract = await contractWithSigner(provider, contractAddress, networkKey)
  const tx = await contract.drawPrizeSlots(prizeSlotIndexes.map((slotIndex) => BigInt(slotIndex)))
  onSubmitted?.(tx.hash)
  const receipt = await tx.wait()
  return receipt?.hash || tx.hash
}

export async function drawRandomPrizeSlotWinner(
  provider: WalletRequestProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  onSubmitted?: ContractTransactionSubmitted,
): Promise<string> {
  const contract = await contractWithSigner(provider, contractAddress, networkKey)
  const tx = await contract.drawRandomPrizeSlot()
  onSubmitted?.(tx.hash)
  const receipt = await tx.wait()
  return receipt?.hash || tx.hash
}

export async function resetContractDraft(
  provider: WalletRequestProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  onSubmitted?: ContractTransactionSubmitted,
): Promise<string> {
  const contract = await contractWithSigner(provider, contractAddress, networkKey)
  const tx = await contract.resetDraft()
  onSubmitted?.(tx.hash)
  const receipt = await tx.wait()
  return receipt?.hash || tx.hash
}

export async function readDrawStatus(
  _provider: BrowserProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  walletAddress = '',
): Promise<DrawStatus> {
  const network = DRAW_NETWORKS[networkKey]
  const provider = createReadOnlyProvider(networkKey)
  const contract = new Contract(contractAddress, luckyDrawAbi, provider)
  const [
    finalized,
    requested,
    fulfilled,
    totalTickets,
    firstWinningTicket,
    ledgerHash,
    prizeSlotCount,
    winnerCount,
  ] =
    await contract.roundStatus()
  const [state, ownerAddress, drawOperatorAddress, winnerTickets] = await Promise.all([
    contract.state(),
    contract.owner(),
    contract.drawOperator(),
    winnerCount > 0n ? contract.winnerTickets() : Promise.resolve([]),
  ])
  let supportsAdminWhitelist = true
  let connectedWalletIsAdmin = false
  if (walletAddress) {
    try {
      connectedWalletIsAdmin = Boolean(await contract.isAdmin(walletAddress))
    } catch {
      supportsAdminWhitelist = false
      connectedWalletIsAdmin = addressesMatch(walletAddress, ownerAddress) || addressesMatch(walletAddress, drawOperatorAddress)
    }
  }
  let supportsSelectablePrizeSlots = true
  let revealedPrizeSlots: bigint[]
  let revealedTickets: bigint[]
  let winnerTicketsBySlot: bigint[]
  try {
    ;[revealedPrizeSlots, revealedTickets, winnerTicketsBySlot] = await Promise.all([
      contract.revealedPrizeSlots(),
      contract.revealedTickets(),
      contract.winnerTicketsBySlot(),
    ])
  } catch {
    supportsSelectablePrizeSlots = false
    revealedPrizeSlots = winnerTickets.map((_: bigint, index: number) => BigInt(index))
    revealedTickets = winnerTickets
    winnerTicketsBySlot = Array.from({ length: Number(prizeSlotCount) }, (_, index) => winnerTickets[index] ?? 0n)
  }
  let vrfSubscription: DrawVrfSubscriptionStatus | null = null
  let vrfSubscriptionError = ''
  try {
    const [vrfConfig, contractCoordinatorAddress] = await Promise.all([
      contract.vrfConfig(),
      contract.vrfCoordinatorAddress(),
    ])
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
    const [subscription, pendingRequestExists] = await Promise.all([
      coordinator.getSubscription(subscriptionId),
      coordinator.pendingRequestExists(subscriptionId),
    ])
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
    ownerAddress,
    drawOperatorAddress,
    connectedWalletIsAdmin,
    supportsAdminWhitelist,
    supportsSelectablePrizeSlots,
    vrfSubscription,
    vrfSubscriptionError,
  })
}
