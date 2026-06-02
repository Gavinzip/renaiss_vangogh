import { Database, Loader2, LockKeyhole, RotateCcw, Wallet } from 'lucide-react'
import type { DrawNetworkConfig } from '../lib/contracts/luckyDrawNetworks'
import type { AppCopy } from '../lib/i18n'
import { compactNumber } from '../lib/ticketing/display'
import { formatAddress } from '../lib/ticketing/rules'
import {
  type ConnectedWallet,
  type DrawStatus,
} from '../lib/wallet/bsc'

export function WalletPanel({
  network,
  wallet,
  status,
  message,
  busy,
  onConnectWallet,
  onRefreshStatus,
  onFinalizeLedger,
  copy,
  ledgerTotalTickets,
  ledgerHash,
  prizeSlotCount,
  transactionHashes,
  authorizedOperatorAddress,
  isAuthorizedOperator,
  isContractOwner,
  onResetRound,
}: {
  network: DrawNetworkConfig
  wallet: ConnectedWallet | null
  status: DrawStatus | null
  message: string
  busy: 'connect' | 'read' | 'finalize' | 'draw' | 'drawNext' | 'reset' | null
  onConnectWallet: () => void
  onRefreshStatus: () => void
  onFinalizeLedger: () => void
  onResetRound: () => void
  copy: AppCopy
  ledgerTotalTickets: number
  ledgerHash: string | null
  prizeSlotCount: number
  transactionHashes: string[]
  authorizedOperatorAddress: string
  isAuthorizedOperator: boolean
  isContractOwner: boolean
}) {
  const drawState = status
    ? status.fulfilled
      ? copy.walletPanel.fulfilled
      : status.state >= 3
        ? copy.walletPanel.randomnessReady
        : status.requested
          ? copy.walletPanel.requested
          : status.finalized
            ? copy.walletPanel.ready
            : copy.walletPanel.disconnected
      : wallet
      ? copy.common.pending
      : copy.walletPanel.disconnected
  const isWalletOnSelectedNetwork = wallet?.chainId === network.chainId
  const hasTicketMismatch = Boolean(status && status.totalTickets !== BigInt(ledgerTotalTickets))
  const hasLedgerHashMismatch = Boolean(status && ledgerHash && status.ledgerHash.toLowerCase() !== ledgerHash.toLowerCase())
  const hasPrizeSlotMismatch = Boolean(status && status.prizeSlotCount !== BigInt(prizeSlotCount))
  const hasLedgerMismatch = hasTicketMismatch || hasLedgerHashMismatch || hasPrizeSlotMismatch
  const isLedgerCurrent = Boolean(status?.finalized && !hasLedgerMismatch)
  const canResetRound = Boolean(
    wallet &&
      status &&
      isContractOwner &&
      status.state !== 2 &&
      (status.finalized || status.requested || status.winnerCount > 0n || status.totalTickets > 0n),
  )
  const explorerBaseUrl = network.blockExplorerUrls[0]?.replace(/\/$/, '') ?? ''
  const contractExplorerUrl = `${explorerBaseUrl}/address/${network.contractAddress}`
  const contractEventsUrl = `${contractExplorerUrl}#events`
  const canFinalizeLedger = Boolean(wallet && isContractOwner && ledgerHash && !status?.requested && !isLedgerCurrent)
  const finalizeDisabled = busy !== null || !canFinalizeLedger
  const resetDisabled = busy !== null || !canResetRound

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
          {copy.walletPanel.authorizedOperator}: {formatAddress(authorizedOperatorAddress)}
        </small>
      </div>

      <div className="wallet-actions-head">
        <span>{copy.walletPanel.operation}</span>
        <strong>{drawState}</strong>
      </div>

      <div className="button-row">
        <button className="primary shimmer-button" onClick={onConnectWallet} disabled={busy !== null}>
          {busy === 'connect' ? <Loader2 className="spin" size={18} /> : <Wallet size={18} />}
          {wallet ? formatAddress(wallet.address) : copy.walletPanel.connectBsc}
        </button>
        <button onClick={onRefreshStatus} disabled={busy !== null || !wallet}>
          {busy === 'read' ? <Loader2 className="spin" size={18} /> : <Database size={18} />}
          {copy.walletPanel.read}
        </button>
        <button onClick={onFinalizeLedger} disabled={finalizeDisabled}>
          {busy === 'finalize' ? <Loader2 className="spin" size={18} /> : <LockKeyhole size={18} />}
          {isLedgerCurrent ? copy.walletPanel.ledgerCurrent : copy.walletPanel.finalizeLedger}
        </button>
        <button
          className="wallet-reset-button"
          onClick={() => {
            if (!window.confirm(copy.walletPanel.resetConfirm)) return
            onResetRound()
          }}
          disabled={resetDisabled}
        >
          {busy === 'reset' ? <Loader2 className="spin" size={18} /> : <RotateCcw size={18} />}
          {copy.walletPanel.resetRound}
        </button>
      </div>

      {wallet ? (
        <div className="mini-grid">
          <span>{copy.walletPanel.chain}</span>
          <strong className={isWalletOnSelectedNetwork ? '' : 'is-warning'}>{wallet.chainName}</strong>
          <span>{copy.walletPanel.operator}</span>
          <strong>{formatAddress(wallet.address)}</strong>
          <span>{copy.walletPanel.authorizedOperator}</span>
          <strong className={isAuthorizedOperator ? '' : 'is-warning'}>{formatAddress(authorizedOperatorAddress)}</strong>
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

      {wallet && !isAuthorizedOperator && (
        <p className="message wallet-warning-message">{copy.walletPanel.unauthorizedOperator}</p>
      )}

      {wallet && status && !isContractOwner && status.state !== 2 && (
        <p className="message wallet-warning-message">{copy.walletPanel.ownerOnlyAction}</p>
      )}

      {status?.state === 2 && (
        <p className="message wallet-warning-message">{copy.walletPanel.resetBlockedDuringRequest}</p>
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

      {status?.winnerTickets.length ? (
        <div className="winner-strip">
          {status.winnerTickets.map((ticket) => (
            <span key={ticket.toString()}>#{compactNumber(ticket)}</span>
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
          {transactionHashes.map((hash) => (
            <a href={`${explorerBaseUrl}/tx/${hash}`} target="_blank" rel="noreferrer" key={hash}>
              {hash.slice(0, 10)}...
            </a>
          ))}
        </div>
      </div>

      {message && <p className="message">{message}</p>}
    </section>
  )
}
