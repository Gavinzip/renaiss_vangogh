import { useEffect, useState } from 'react'
import { LockKeyhole } from 'lucide-react'
import type { DrawNetworkConfig } from '../lib/contracts/luckyDrawNetworks'
import type { AppCopy } from '../lib/i18n'
import { compactNumber, formatDrawTicketNumber } from '../lib/ticketing/display'
import { formatAddress } from '../lib/ticketing/rules'
import { formatDurationMs, type DrawVrfTiming } from '../lib/wallet/drawTransactions'
import { formatVrfPaymentBalance, hasInsufficientVrfFunding } from '../lib/wallet/vrfSubscription'
import {
  type ConnectedWallet,
  type DrawStatus,
} from '../lib/wallet/bsc'

export function WalletPanel({
  network,
  wallet,
  status,
  message,
  copy,
  ledgerTotalTickets,
  ledgerHash,
  prizeSlotCount,
  vrfTiming,
  authorizedOperatorAddress,
  isAuthorizedOperator,
  isContractOwner,
}: {
  network: DrawNetworkConfig
  wallet: ConnectedWallet | null
  status: DrawStatus | null
  message: string
  copy: AppCopy
  ledgerTotalTickets: number
  ledgerHash: string | null
  prizeSlotCount: number
  vrfTiming: DrawVrfTiming | null
  authorizedOperatorAddress: string
  isAuthorizedOperator: boolean
  isContractOwner: boolean
}) {
  const [clockNow, setClockNow] = useState(() => Date.now())
  const drawState = status
    ? status.fulfilled
      ? copy.walletPanel.fulfilled
      : status.state >= 3
        ? copy.walletPanel.randomnessReady
        : status.requested
          ? copy.walletPanel.requested
          : status.finalized
            ? copy.walletPanel.ready
            : copy.walletPanel.notFinalized
      : wallet
      ? copy.common.pending
      : copy.walletPanel.disconnected
  const isWalletOnSelectedNetwork = wallet?.chainId === network.chainId
  const hasTicketMismatch = Boolean(status && status.totalTickets !== BigInt(ledgerTotalTickets))
  const hasLedgerHashMismatch = Boolean(status && ledgerHash && status.ledgerHash.toLowerCase() !== ledgerHash.toLowerCase())
  const hasPrizeSlotMismatch = Boolean(status && status.prizeSlotCount !== BigInt(prizeSlotCount))
  const hasLedgerMismatch = Boolean(status?.finalized && (hasTicketMismatch || hasLedgerHashMismatch || hasPrizeSlotMismatch))
  const explorerBaseUrl = network.blockExplorerUrls[0]?.replace(/\/$/, '') ?? ''
  const contractExplorerUrl = `${explorerBaseUrl}/address/${network.contractAddress}`
  const contractEventsUrl = `${contractExplorerUrl}#events`
  const vrfSubscription = status?.vrfSubscription ?? null
  const hasVrfFundingIssue = hasInsufficientVrfFunding(vrfSubscription)
  const vrfBalanceLabel = formatVrfPaymentBalance(vrfSubscription)
  const vrfWaitStartedAt = vrfTiming?.requestConfirmedAt ?? vrfTiming?.pendingObservedAt
  const vrfWaitEndAt = vrfTiming?.randomnessReadyAt ?? clockNow
  const vrfWaitDuration = vrfWaitStartedAt ? formatDurationMs(vrfWaitEndAt - vrfWaitStartedAt) : '-'
  const walletPermissionLabel = !status
    ? copy.common.pending
    : isAuthorizedOperator
      ? copy.walletPanel.authorizedAdmin
      : copy.walletPanel.notAuthorizedAdmin
  const walletPermissionClassName = !status ? '' : isAuthorizedOperator ? 'is-ok' : 'is-warning'

  useEffect(() => {
    const hasActiveVrfTimer = Boolean(vrfWaitStartedAt && !vrfTiming?.randomnessReadyAt && status?.requested && status.state < 3)
    if (!hasActiveVrfTimer) return undefined
    const intervalId = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [status?.requested, status?.state, vrfTiming?.randomnessReadyAt, vrfWaitStartedAt])

  return (
    <section className="panel wallet-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.walletPanel.bscLiveDraw}</span>
          <h2>{copy.walletPanel.title}</h2>
          <p>{copy.walletPanel.subtitle}</p>
        </div>
        <span className={`wallet-state-pill ${wallet ? 'is-connected' : ''}`}>
          <LockKeyhole size={15} />
          {wallet ? copy.walletPanel.connected : copy.walletPanel.disconnected}
        </span>
      </div>

      <div className="wallet-contract-card">
        <span>{network.label}</span>
        <strong>{network.contractAddress}</strong>
        <small>{network.chainName}</small>
        <small>
          {copy.walletPanel.contractOperator}: {formatAddress(authorizedOperatorAddress)}
        </small>
      </div>

      <div className="wallet-actions-head">
        <span>{copy.walletPanel.statusPanel}</span>
        <strong>{drawState}</strong>
      </div>

      {wallet ? (
        <div className="mini-grid">
          <span>{copy.walletPanel.chain}</span>
          <strong className={isWalletOnSelectedNetwork ? '' : 'is-warning'}>{wallet.chainName}</strong>
          <span>{copy.walletPanel.operator}</span>
          <strong>{formatAddress(wallet.address)}</strong>
          <span>{copy.walletPanel.contractOperator}</span>
          <strong>{formatAddress(authorizedOperatorAddress)}</strong>
          <span>{copy.walletPanel.connectedWalletPermission}</span>
          <strong className={walletPermissionClassName}>{walletPermissionLabel}</strong>
          {status && (
            <>
              <span>{copy.walletPanel.contractOwner}</span>
              <strong className={isContractOwner ? '' : 'is-warning'}>{formatAddress(status.ownerAddress)}</strong>
            </>
          )}
        </div>
      ) : (
        <p className="wallet-status-preview">{copy.walletPanel.statusPreview}</p>
      )}

      {wallet && status && !isAuthorizedOperator && (
        <p className="message wallet-warning-message">{copy.walletPanel.unauthorizedOperator}</p>
      )}

      {wallet && status && !isAuthorizedOperator && status.state !== 2 && (
        <p className="message wallet-warning-message">{copy.walletPanel.ownerOnlyAction}</p>
      )}

      {status && (
        <div className="contract-status">
          <div>
            <span>{copy.walletPanel.ledger}</span>
            <strong>{status.ledgerHash.slice(0, 10)}...</strong>
          </div>
          <div>
            <span>{copy.walletPanel.totalTickets}</span>
            <strong>{compactNumber(status.totalTickets)}</strong>
          </div>
          <div>
            <span>{copy.walletPanel.ledgerTotalTickets}</span>
            <strong>{compactNumber(ledgerTotalTickets)}</strong>
          </div>
          <div>
            <span>{copy.walletPanel.drawState}</span>
            <strong>{drawState}</strong>
          </div>
          <div>
            <span>{copy.walletPanel.winners}</span>
            <strong>
              {status.winnerCount > 0n
                ? `${compactNumber(status.winnerCount)} / ${compactNumber(status.prizeSlotCount)}`
                : `0 / ${compactNumber(status.prizeSlotCount)}`}
            </strong>
          </div>
          <div>
            <span>{copy.walletPanel.prizeSlots}</span>
            <strong>{compactNumber(status.prizeSlotCount)}</strong>
          </div>
        </div>
      )}

      {ledgerHash && !status && wallet && isAuthorizedOperator && (
        <p className="message">{copy.walletPanel.lockLedgerFirst}</p>
      )}

      {!ledgerHash && (
        <p className="message wallet-warning-message">{copy.walletPanel.ledgerHashMissing}</p>
      )}

      {hasLedgerMismatch && (
        <p className="message wallet-warning-message">{copy.walletPanel.contractTotalMismatch}</p>
      )}

      {status && !status.supportsSelectablePrizeSlots && (
        <p className="message wallet-warning-message">{copy.drawReveal.selectableOrderUnavailable}</p>
      )}

      {vrfSubscription && (
        <div className={`wallet-vrf-panel ${hasVrfFundingIssue ? 'is-warning' : ''}`}>
          <span>{copy.walletPanel.vrfSubscription}</span>
          <div>
            <strong>{copy.walletPanel.vrfBalance}</strong>
            <small>{vrfBalanceLabel}</small>
          </div>
          <div>
            <strong>{copy.walletPanel.vrfPendingRequest}</strong>
            <small>{vrfSubscription.pendingRequestExists ? copy.walletPanel.requested : copy.walletPanel.ready}</small>
          </div>
          <div>
            <strong>{copy.walletPanel.vrfConsumer}</strong>
            <small>{vrfSubscription.contractIsConsumer ? copy.walletPanel.ready : copy.common.pending}</small>
          </div>
          <div>
            <strong>{copy.walletPanel.vrfRequestCount}</strong>
            <small>{compactNumber(vrfSubscription.requestCount)}</small>
          </div>
          <div>
            <strong>{copy.walletPanel.vrfTiming}</strong>
            <small>
              {copy.walletPanel.vrfWait}: {vrfWaitDuration}
            </small>
          </div>
          <p>{copy.walletPanel.vrfFeeModel}</p>
          {hasVrfFundingIssue && <p>{copy.walletPanel.vrfFundingMissing}</p>}
        </div>
      )}

      {status?.vrfSubscriptionError && (
        <p className="message wallet-warning-message">{copy.walletPanel.vrfSubscriptionReadFailed}</p>
      )}

      {status?.winnerTickets.length ? (
        <div className="winner-strip">
          {status.winnerTickets.map((ticket) => (
            <span key={ticket.toString()}>#{formatDrawTicketNumber(ticket, status.totalTickets)}</span>
          ))}
        </div>
      ) : null}

      <div className="wallet-link-panel">
        <span>{copy.walletPanel.blockchainLinks}</span>
        <div>
          <a href={contractExplorerUrl} target="_blank" rel="noreferrer">
            {copy.walletPanel.contractExplorer}
          </a>
          <a href={contractEventsUrl} target="_blank" rel="noreferrer">
            {copy.walletPanel.eventLogs}
          </a>
        </div>
      </div>

      {message && <p className="message">{message}</p>}
    </section>
  )
}
