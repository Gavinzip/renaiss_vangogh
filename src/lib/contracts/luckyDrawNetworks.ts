export type DrawNetworkKey = 'testnet' | 'mainnet'
export type DrawRunMode = 'showcase' | DrawNetworkKey

export interface DrawNetworkConfig {
  authorizedOperatorAddress: string
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
const DEFAULT_TESTNET_CONTRACT_ADDRESS = '0xAC18C773d6fc72D26Dadb3959f6aa16E8E9950A4'
const DEFAULT_AUTHORIZED_OPERATOR_ADDRESS = '0x88b620388698490764fd85cfa482b5e3a8ad63b5'

export function sameAddress(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase())
}

export function isAuthorizedDrawOperator(walletAddress: string | null | undefined, network: DrawNetworkConfig) {
  return sameAddress(walletAddress, network.authorizedOperatorAddress)
}

export const DRAW_NETWORKS: Record<DrawNetworkKey, DrawNetworkConfig> = {
  testnet: {
    key: 'testnet',
    label: 'BSC Testnet',
    chainId: 97n,
    chainName: 'BNB Smart Chain Testnet',
    contractAddress: DEFAULT_TESTNET_CONTRACT_ADDRESS,
    authorizedOperatorAddress: DEFAULT_AUTHORIZED_OPERATOR_ADDRESS,
    explorerName: 'BscScan Testnet',
    rpcUrls: ['https://bsc-testnet-dataseed.bnbchain.org'],
    blockExplorerUrls: ['https://testnet.bscscan.com'],
  },
  mainnet: {
    key: 'mainnet',
    label: 'BSC Mainnet',
    chainId: 56n,
    chainName: 'BNB Smart Chain',
    contractAddress: DEFAULT_MAINNET_CONTRACT_ADDRESS,
    authorizedOperatorAddress: DEFAULT_AUTHORIZED_OPERATOR_ADDRESS,
    explorerName: 'BscScan',
    rpcUrls: ['https://bsc-dataseed.binance.org'],
    blockExplorerUrls: ['https://bscscan.com'],
  },
}

export function isDrawNetworkKey(value: DrawRunMode): value is DrawNetworkKey {
  return value === 'testnet' || value === 'mainnet'
}
