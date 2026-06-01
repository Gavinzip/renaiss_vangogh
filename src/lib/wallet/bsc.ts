import { BrowserProvider, Contract } from 'ethers'
import { luckyDrawAbi } from '../contracts/luckyDrawAbi'

export const BSC_MAINNET_CHAIN_ID = 56n
export const BSC_TESTNET_CHAIN_ID = 97n

export const BSC_NETWORKS: Record<string, { chainId: bigint; name: string; rpcUrls: string[]; blockExplorerUrls: string[] }> = {
  mainnet: {
    chainId: BSC_MAINNET_CHAIN_ID,
    name: 'BNB Smart Chain',
    rpcUrls: ['https://bsc-dataseed.binance.org'],
    blockExplorerUrls: ['https://bscscan.com'],
  },
  testnet: {
    chainId: BSC_TESTNET_CHAIN_ID,
    name: 'BNB Smart Chain Testnet',
    rpcUrls: ['https://data-seed-prebsc-1-s1.bnbchain.org:8545'],
    blockExplorerUrls: ['https://testnet.bscscan.com'],
  },
}

const EXPECTED_NETWORK =
  import.meta.env.VITE_BSC_NETWORK === 'testnet' ? BSC_NETWORKS.testnet : BSC_NETWORKS.mainnet

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

export async function connectInjectedWallet(): Promise<ConnectedWallet> {
  if (!window.ethereum) {
    throw new Error('No injected wallet found. Use MetaMask, Rabby, or another BSC-compatible wallet.')
  }
  await window.ethereum.request({ method: 'eth_requestAccounts' })
  const provider = new BrowserProvider(window.ethereum)
  await ensureBscNetwork(provider)
  const signer = await provider.getSigner()
  const network = await provider.getNetwork()
  return {
    address: await signer.getAddress(),
    chainId: network.chainId,
    chainName: EXPECTED_NETWORK.name,
    provider,
  }
}

export async function ensureBscNetwork(provider?: BrowserProvider): Promise<void> {
  const activeProvider = provider || (window.ethereum ? new BrowserProvider(window.ethereum) : null)
  if (!window.ethereum || !activeProvider) {
    throw new Error('No injected wallet found.')
  }

  const network = await activeProvider.getNetwork()
  if (network.chainId === EXPECTED_NETWORK.chainId) return

  const hexChainId = `0x${EXPECTED_NETWORK.chainId.toString(16)}`
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    })
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? Number(error.code) : 0
    if (code !== 4902) {
      throw new Error(`Please switch wallet network to ${EXPECTED_NETWORK.name}.`, {
        cause: error,
      })
    }
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: hexChainId,
          chainName: EXPECTED_NETWORK.name,
          nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
          rpcUrls: EXPECTED_NETWORK.rpcUrls,
          blockExplorerUrls: EXPECTED_NETWORK.blockExplorerUrls,
        },
      ],
    })
  }
}

export async function requestContractDraw(
  provider: BrowserProvider,
  contractAddress: string,
): Promise<string> {
  await ensureBscNetwork(provider)
  const signer = await provider.getSigner()
  const contract = new Contract(contractAddress, luckyDrawAbi, signer)
  const tx = await contract.requestDraw()
  const receipt = await tx.wait()
  return receipt?.hash || tx.hash
}

export async function readDrawStatus(
  provider: BrowserProvider,
  contractAddress: string,
): Promise<DrawStatus> {
  await ensureBscNetwork(provider)
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
  const winnerTickets = fulfilled ? await contract.winnerTickets() : []
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
