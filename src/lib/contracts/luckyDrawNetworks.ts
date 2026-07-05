export type DrawNetworkKey = 'testnet' | 'mainnet'
export type DrawRunMode = 'showcase' | DrawNetworkKey

export interface DrawNetworkConfig {
  authorizedOperatorAddress: string
  blockExplorerUrls: string[]
  chainId: bigint
  chainName: string
  contractAddress: string
  deploymentBlock: number
  explorerName: string
  keyHash: string
  key: DrawNetworkKey
  label: string
  logRpcUrls: string[]
  rpcUrls: string[]
  vrfCoordinatorAddress: string
}

const DEFAULT_MAINNET_CONTRACT_ADDRESS = '0x856bb4743b5160e7eeCeb6b637B42d9412478573'
const DEFAULT_TESTNET_CONTRACT_ADDRESS = '0x620DEeD565bbb4044Cd988661852Bd99a5Cb7b9D'
const DEFAULT_MAINNET_CONTRACT_DEPLOYMENT_BLOCK = 108159872
const DEFAULT_TESTNET_CONTRACT_DEPLOYMENT_BLOCK = 117304260
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

function envValue(...keys: string[]) {
  for (const key of keys) {
    const value = import.meta.env[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function envAddress(fallback: string, ...keys: string[]) {
  const value = envValue(...keys)
  if (!value) return fallback
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value : fallback
}

function envBlock(fallback: number, ...keys: string[]) {
  const value = Number(envValue(...keys))
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

export const DRAW_NETWORKS: Record<DrawNetworkKey, DrawNetworkConfig> = {
  testnet: {
    key: 'testnet',
    label: 'BSC Testnet',
    chainId: 97n,
    chainName: 'BNB Smart Chain Testnet',
    contractAddress: envAddress(
      DEFAULT_TESTNET_CONTRACT_ADDRESS,
      'VITE_LUCKY_DRAW_TESTNET_ADDRESS',
      'VITE_DRAW_CONTRACT_TESTNET',
      'VITE_DRAW_CONTRACT_ADDRESS_TESTNET',
    ),
    deploymentBlock: envBlock(
      DEFAULT_TESTNET_CONTRACT_DEPLOYMENT_BLOCK,
      'VITE_LUCKY_DRAW_TESTNET_DEPLOYMENT_BLOCK',
      'VITE_DRAW_CONTRACT_TESTNET_DEPLOYMENT_BLOCK',
    ),
    authorizedOperatorAddress: DEFAULT_AUTHORIZED_OPERATOR_ADDRESS,
    explorerName: 'BscScan Testnet',
    logRpcUrls: ['https://bsc-testnet-rpc.publicnode.com'],
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
    contractAddress: envAddress(
      DEFAULT_MAINNET_CONTRACT_ADDRESS,
      'VITE_LUCKY_DRAW_MAINNET_ADDRESS',
      'VITE_DRAW_CONTRACT_MAINNET',
      'VITE_DRAW_CONTRACT_ADDRESS_MAINNET',
      'VITE_DRAW_CONTRACT',
    ),
    deploymentBlock: envBlock(
      DEFAULT_MAINNET_CONTRACT_DEPLOYMENT_BLOCK,
      'VITE_LUCKY_DRAW_MAINNET_DEPLOYMENT_BLOCK',
      'VITE_DRAW_CONTRACT_MAINNET_DEPLOYMENT_BLOCK',
    ),
    authorizedOperatorAddress: DEFAULT_AUTHORIZED_OPERATOR_ADDRESS,
    explorerName: 'BscScan',
    logRpcUrls: ['https://bsc-rpc.publicnode.com'],
    rpcUrls: ['https://bsc-dataseed.binance.org'],
    blockExplorerUrls: ['https://bscscan.com'],
    vrfCoordinatorAddress: BSC_MAINNET_BINANCE_VRF_COORDINATOR,
    keyHash: BSC_MAINNET_BINANCE_VRF_KEY_HASH,
  },
}

export function isDrawNetworkKey(value: DrawRunMode): value is DrawNetworkKey {
  return value === 'testnet' || value === 'mainnet'
}
