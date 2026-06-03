import { formatEther } from 'ethers'

export interface DrawVrfSubscriptionStatus {
  callbackGasLimit: bigint
  consumerAddresses: string[]
  contractIsConsumer: boolean
  coordinatorAddress: string
  keyHash: string
  balance: bigint
  ownerAddress: string
  pendingRequestExists: boolean
  requestConfirmations: number
  requestCount: bigint
  subscriptionId: bigint
}

function formatTokenValue(value: bigint) {
  if (value === 0n) return '0'
  const numericValue = Number(formatEther(value))
  if (!Number.isFinite(numericValue)) return formatEther(value)
  if (numericValue > 0 && numericValue < 0.0001) return '<0.0001'
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: numericValue < 1 ? 6 : 4,
  }).format(numericValue)
}

export function formatVrfPaymentBalance(status: DrawVrfSubscriptionStatus | null | undefined) {
  if (!status) return '-'
  return `${formatTokenValue(status.balance)} BNB`
}

export function hasInsufficientVrfFunding(status: DrawVrfSubscriptionStatus | null | undefined) {
  if (!status) return false
  return status.balance <= 0n
}
