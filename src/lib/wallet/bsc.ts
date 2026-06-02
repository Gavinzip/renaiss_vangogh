import { BrowserProvider, Contract } from 'ethers'
import { luckyDrawAbi } from '../contracts/luckyDrawAbi'
import { DRAW_NETWORKS, type DrawNetworkKey } from '../contracts/luckyDrawNetworks'

export const BSC_MAINNET_CHAIN_ID = DRAW_NETWORKS.mainnet.chainId
export const BSC_TESTNET_CHAIN_ID = DRAW_NETWORKS.testnet.chainId

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
      on?: (event: string, handler: (...args: unknown[]) => void) => void
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
    }
  }
}

export interface ConnectedWallet {
  address: string
  chainId: bigint
  chainName: string
  provider: BrowserProvider
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
  supportsSelectablePrizeSlots: boolean
}

export interface ContractRevealResult {
  prizeSlotIndex: number
  ticket: bigint
}

export async function connectInjectedWallet(networkKey: DrawNetworkKey): Promise<ConnectedWallet> {
  if (!window.ethereum) {
    throw new Error('No injected wallet found. Use MetaMask, Rabby, or another BSC-compatible wallet.')
  }
  await window.ethereum.request({ method: 'eth_requestAccounts' })
  await ensureBscNetwork(new BrowserProvider(window.ethereum), networkKey)
  const provider = new BrowserProvider(window.ethereum)
  const signer = await provider.getSigner()
  const network = await provider.getNetwork()
  return {
    address: await signer.getAddress(),
    chainId: network.chainId,
    chainName: DRAW_NETWORKS[networkKey].chainName,
    provider,
  }
}

export async function ensureBscNetwork(provider: BrowserProvider | undefined, networkKey: DrawNetworkKey): Promise<void> {
  const activeProvider = provider || (window.ethereum ? new BrowserProvider(window.ethereum) : null)
  if (!window.ethereum || !activeProvider) {
    throw new Error('No injected wallet found.')
  }

  const expectedNetwork = DRAW_NETWORKS[networkKey]
  const network = await activeProvider.getNetwork()
  if (network.chainId === expectedNetwork.chainId) return

  const hexChainId = `0x${expectedNetwork.chainId.toString(16)}`
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    })
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? Number(error.code) : 0
    if (code !== 4902) {
      throw new Error(`Please switch wallet network to ${expectedNetwork.chainName}.`, {
        cause: error,
      })
    }
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: hexChainId,
          chainName: expectedNetwork.chainName,
          nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
          rpcUrls: expectedNetwork.rpcUrls,
          blockExplorerUrls: expectedNetwork.blockExplorerUrls,
        },
      ],
    })
  }
}

export async function finalizeContractLedger(
  provider: BrowserProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  ledgerHash: string,
  totalTickets: number,
  prizeSlotCount: number,
  ledgerUri: string,
): Promise<string> {
  await ensureBscNetwork(provider, networkKey)
  const signer = await provider.getSigner()
  const contract = new Contract(contractAddress, luckyDrawAbi, signer)
  const tx = await contract.finalizeLedger(ledgerHash, BigInt(totalTickets), BigInt(prizeSlotCount), ledgerUri)
  const receipt = await tx.wait()
  return receipt?.hash || tx.hash
}

export async function requestContractDraw(
  provider: BrowserProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
): Promise<string> {
  await ensureBscNetwork(provider, networkKey)
  const signer = await provider.getSigner()
  const contract = new Contract(contractAddress, luckyDrawAbi, signer)
  const tx = await contract.requestDraw()
  const receipt = await tx.wait()
  return receipt?.hash || tx.hash
}

export async function drawNextWinner(
  provider: BrowserProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
): Promise<string> {
  await ensureBscNetwork(provider, networkKey)
  const signer = await provider.getSigner()
  const contract = new Contract(contractAddress, luckyDrawAbi, signer)
  const tx = await contract.drawNext()
  const receipt = await tx.wait()
  return receipt?.hash || tx.hash
}

export async function drawBatchWinners(
  provider: BrowserProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  count: number,
): Promise<string> {
  await ensureBscNetwork(provider, networkKey)
  const signer = await provider.getSigner()
  const contract = new Contract(contractAddress, luckyDrawAbi, signer)
  const tx = await contract.drawBatch(BigInt(count))
  const receipt = await tx.wait()
  return receipt?.hash || tx.hash
}

export async function drawPrizeSlotWinner(
  provider: BrowserProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  prizeSlotIndex: number,
): Promise<string> {
  await ensureBscNetwork(provider, networkKey)
  const signer = await provider.getSigner()
  const contract = new Contract(contractAddress, luckyDrawAbi, signer)
  const tx = await contract.drawPrizeSlot(BigInt(prizeSlotIndex))
  const receipt = await tx.wait()
  return receipt?.hash || tx.hash
}

export async function drawPrizeSlotWinners(
  provider: BrowserProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
  prizeSlotIndexes: number[],
): Promise<string> {
  await ensureBscNetwork(provider, networkKey)
  const signer = await provider.getSigner()
  const contract = new Contract(contractAddress, luckyDrawAbi, signer)
  const tx = await contract.drawPrizeSlots(prizeSlotIndexes.map((slotIndex) => BigInt(slotIndex)))
  const receipt = await tx.wait()
  return receipt?.hash || tx.hash
}

export async function drawRandomPrizeSlotWinner(
  provider: BrowserProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
): Promise<string> {
  await ensureBscNetwork(provider, networkKey)
  const signer = await provider.getSigner()
  const contract = new Contract(contractAddress, luckyDrawAbi, signer)
  const tx = await contract.drawRandomPrizeSlot()
  const receipt = await tx.wait()
  return receipt?.hash || tx.hash
}

export async function resetContractDraft(
  provider: BrowserProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
): Promise<string> {
  await ensureBscNetwork(provider, networkKey)
  const signer = await provider.getSigner()
  const contract = new Contract(contractAddress, luckyDrawAbi, signer)
  const tx = await contract.resetDraft()
  const receipt = await tx.wait()
  return receipt?.hash || tx.hash
}

export async function readDrawStatus(
  provider: BrowserProvider,
  contractAddress: string,
  networkKey: DrawNetworkKey,
): Promise<DrawStatus> {
  await ensureBscNetwork(provider, networkKey)
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
  return {
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
    supportsSelectablePrizeSlots,
  }
}
