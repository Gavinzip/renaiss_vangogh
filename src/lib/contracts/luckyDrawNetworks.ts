export type DrawNetworkKey = 'testnet' | 'mainnet'
export type DrawRunMode = 'showcase' | DrawNetworkKey

export interface DrawNetworkConfig {
  authorizedOperatorAddress: string
  blockExplorerUrls: string[]
  chainId: bigint
  chainName: string
  contractAddress: string
  explorerName: string
  keyHash: string
  key: DrawNetworkKey
  label: string
  rpcUrls: string[]
  vrfCoordinatorAddress: string
}

const DEFAULT_MAINNET_CONTRACT_ADDRESS = '0xd1Cb4a9858ce6216b272895D0BB1839bC7B4da0d'
const DEFAULT_TESTNET_CONTRACT_ADDRESS = '0xD21EA1F93Ca4f4CF3c847eF83CC0DDA27D9b0879'
const DEFAULT_AUTHORIZED_OPERATOR_ADDRESS = '0x88b620388698490764fd85cfa482b5e3a8ad63b5'
const BSC_MAINNET_BINANCE_VRF_COORDINATOR = '0x9632ADE542f12114f5E5AD4d6F8e47fB993955da'
const BSC_TESTNET_BINANCE_VRF_COORDINATOR = '0xa2d23627bC0314f4Cbd08Ff54EcB89bb45685053'
const BSC_MAINNET_BINANCE_VRF_KEY_HASH = '0xcd65a78499993598be303c914c3e37b0103ead6b1f279d1dbfa0ef080e7141a4'
const BSC_TESTNET_BINANCE_VRF_KEY_HASH = '0x617abc3f53ae11766071d04ada1c7b0fbd49833b9542e9e91da4d3191c70cc80'

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
    vrfCoordinatorAddress: BSC_TESTNET_BINANCE_VRF_COORDINATOR,
    keyHash: BSC_TESTNET_BINANCE_VRF_KEY_HASH,
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
    vrfCoordinatorAddress: BSC_MAINNET_BINANCE_VRF_COORDINATOR,
    keyHash: BSC_MAINNET_BINANCE_VRF_KEY_HASH,
  },
}

export function isDrawNetworkKey(value: DrawRunMode): value is DrawNetworkKey {
  return value === 'testnet' || value === 'mainnet'
}
