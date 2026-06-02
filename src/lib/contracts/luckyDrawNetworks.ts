export type DrawNetworkKey = 'testnet' | 'mainnet'
export type DrawRunMode = 'showcase' | DrawNetworkKey

export interface DrawNetworkConfig {
  blockExplorerUrls: string[]
  chainId: bigint
  chainName: string
  contractAddress: string
  explorerName: string
  key: DrawNetworkKey
  label: string
  rpcUrls: string[]
}

const DEFAULT_MAINNET_CONTRACT_ADDRESS = '0xd1Cb4a9858ce6216b272895D0BB1839bC7B4da0d'
const DEFAULT_TESTNET_CONTRACT_ADDRESS = '0xd1Cb4a9858ce6216b272895D0BB1839bC7B4da0d'

function envAddress(key: string, fallback: string) {
  const value = String(import.meta.env[key] || '').trim()
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value : fallback
}

export const DRAW_NETWORKS: Record<DrawNetworkKey, DrawNetworkConfig> = {
  testnet: {
    key: 'testnet',
    label: 'BSC Testnet',
    chainId: 97n,
    chainName: 'BNB Smart Chain Testnet',
    contractAddress: envAddress('VITE_LUCKY_DRAW_TESTNET_ADDRESS', DEFAULT_TESTNET_CONTRACT_ADDRESS),
    explorerName: 'BscScan Testnet',
    rpcUrls: ['https://bsc-testnet-dataseed.bnbchain.org'],
    blockExplorerUrls: ['https://testnet.bscscan.com'],
  },
  mainnet: {
    key: 'mainnet',
    label: 'BSC Mainnet',
    chainId: 56n,
    chainName: 'BNB Smart Chain',
    contractAddress: envAddress('VITE_LUCKY_DRAW_MAINNET_ADDRESS', DEFAULT_MAINNET_CONTRACT_ADDRESS),
    explorerName: 'BscScan',
    rpcUrls: ['https://bsc-dataseed.binance.org'],
    blockExplorerUrls: ['https://bscscan.com'],
  },
}

export function isDrawNetworkKey(value: DrawRunMode): value is DrawNetworkKey {
  return value === 'testnet' || value === 'mainnet'
}
