import { BrowserProvider, Contract, JsonRpcProvider } from 'ethers'
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
  totalTickets: bigint
  firstWinningTicket: bigint
  ledgerHash: string
  prizeSlotCount: bigint
  winnerCount: bigint
  winnerTickets: bigint[]
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
  const winnerTickets = winnerCount > 0n ? await contract.winnerTickets() : []
  return {
    finalized,
    requested,
    fulfilled,
    totalTickets,
    firstWinningTicket,
    ledgerHash,
    prizeSlotCount,
    winnerCount,
    winnerTickets,
  }
}

export async function readPublicDrawStatus(contractAddress: string, networkKey: DrawNetworkKey): Promise<DrawStatus> {
  const network = DRAW_NETWORKS[networkKey]
  const provider = new JsonRpcProvider(network.rpcUrls[0], Number(network.chainId))
  const code = await provider.getCode(contractAddress)
  if (code === '0x') {
    throw new Error(`No lucky draw contract found on ${network.label} at ${contractAddress}.`)
  }

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
  const winnerTickets = winnerCount > 0n ? await contract.winnerTickets() : []
  return {
    finalized,
    requested,
    fulfilled,
    totalTickets,
    firstWinningTicket,
    ledgerHash,
    prizeSlotCount,
    winnerCount,
    winnerTickets,
  }
}
