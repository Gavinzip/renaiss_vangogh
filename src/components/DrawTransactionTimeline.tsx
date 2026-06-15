import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { DrawNetworkConfig } from '../lib/contracts/luckyDrawNetworks'
import type { AppCopy } from '../lib/i18n'
import type { DrawChainEventTransaction } from '../lib/wallet/drawEventHistory'
import { transactionDuration, type DrawTransactionRecord } from '../lib/wallet/drawTransactions'

function transactionKindLabel(record: DrawTransactionRecord, copy: AppCopy) {
  if (record.kind === 'reset') return copy.walletPanel.resetRound
  if (record.kind === 'finalize') return copy.walletPanel.finalizeLedger
  if (record.kind === 'request') return copy.drawReveal.requestRound
  return copy.walletPanel.drawNext
}

function transactionStatusLabel(record: DrawTransactionRecord, copy: AppCopy) {
  if (record.status === 'awaiting-signature') return copy.walletPanel.txAwaitingSignature
  if (record.status === 'pending') return copy.walletPanel.txPending
  if (record.status === 'confirmed') return copy.walletPanel.txConfirmed
  return copy.walletPanel.txFailed
}

function chainTransactionKindLabel(record: DrawChainEventTransaction, copy: AppCopy) {
  if (record.kind === 'reset') return copy.walletPanel.resetRound
  if (record.kind === 'finalize') return copy.walletPanel.finalizeLedger
  if (record.kind === 'request') return copy.drawReveal.requestRound
  if (record.kind === 'randomness') return copy.walletPanel.randomnessReady
  if (record.kind === 'fulfilled') return copy.walletPanel.fulfilled
  return copy.walletPanel.drawNext
}

function chainTransactionDetail(record: DrawChainEventTransaction, network: DrawNetworkConfig, copy: AppCopy) {
  if (record.kind === 'reveal' && record.slots.length > 0) {
    return record.slots.map((slot) => `${copy.drawReveal.slotLabel} #${slot}`).join(', ')
  }
  return network.label
}

function shortHash(hash: string) {
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`
}

export function DrawTransactionTimeline({
  network,
  records,
  chainTransactions = [],
  chainStatus = 'idle',
  chainError = '',
  copy,
}: {
  network: DrawNetworkConfig
  records: DrawTransactionRecord[]
  chainTransactions?: DrawChainEventTransaction[]
  chainStatus?: 'idle' | 'loading' | 'ready' | 'error'
  chainError?: string
  copy: AppCopy
}) {
  const [clockNow, setClockNow] = useState(() => Date.now())
  const explorerBaseUrl = network.blockExplorerUrls[0]?.replace(/\/$/, '') ?? ''
  const showingChain = chainStatus === 'loading' || chainStatus === 'ready'
  const visibleRecords = showingChain ? [] : records
  const visibleCount = showingChain ? chainTransactions.length : visibleRecords.length
  const headerEyebrow = showingChain ? copy.walletPanel.chainTransactions : copy.walletPanel.localTransactionFallback
  const headerTitle = showingChain ? copy.walletPanel.chainTransactionTimeline : copy.walletPanel.transactionTimeline

  useEffect(() => {
    const hasActiveRecord = records.some((record) => record.status === 'awaiting-signature' || record.status === 'pending')
    if (!hasActiveRecord) return undefined
    const intervalId = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [records])

  return (
    <section className="panel draw-transaction-timeline" aria-label={headerTitle}>
      <div className="draw-transaction-head">
        <div>
          <span className="eyebrow">{headerEyebrow}</span>
          <h2>{headerTitle}</h2>
        </div>
        <strong>
          {chainStatus === 'loading'
            ? copy.walletPanel.chainEventLoading
            : visibleCount > 0
              ? visibleCount
              : showingChain
                ? copy.walletPanel.noChainTransactions
                : copy.walletPanel.noSessionTransactions}
        </strong>
      </div>

      {chainStatus === 'error' && (
        <p className="draw-transaction-note">
          {copy.walletPanel.chainEventUnavailable}
          {chainError ? ` ${chainError}` : ''}
        </p>
      )}

      {showingChain && chainTransactions.length > 0 ? (
        <div className="draw-transaction-scroll" role="list" tabIndex={0}>
          {chainTransactions.map((record) => (
            <a
              className="draw-transaction-card is-confirmed"
              href={`${explorerBaseUrl}/tx/${record.hash}`}
              key={record.id}
              rel="noreferrer"
              role="listitem"
              target="_blank"
            >
              <span className="draw-transaction-status is-confirmed">{copy.walletPanel.txConfirmed}</span>
              <strong>{chainTransactionKindLabel(record, copy)}</strong>
              <small>{chainTransactionDetail(record, network, copy)}</small>
              <div>
                <span>{shortHash(record.hash)}</span>
                <ExternalLink size={14} aria-hidden="true" />
              </div>
              <small>
                {copy.walletPanel.blockNumber} {record.blockNumber.toLocaleString()}
              </small>
            </a>
          ))}
        </div>
      ) : visibleRecords.length > 0 ? (
        <div className="draw-transaction-scroll" role="list" tabIndex={0}>
          {visibleRecords.map((record) => {
            const body = (
              <>
                <span className={`draw-transaction-status is-${record.status}`}>{transactionStatusLabel(record, copy)}</span>
                <strong>{transactionKindLabel(record, copy)}</strong>
                <small>{record.detail || network.label}</small>
                <div>
                  <span>{record.hash ? shortHash(record.hash) : copy.walletPanel.txAwaitingSignature}</span>
                  {record.hash && <ExternalLink size={14} aria-hidden="true" />}
                </div>
                <small>{transactionDuration(record, clockNow || record.confirmedAt || record.submittedAt || record.startedAt)}</small>
              </>
            )

            return record.hash ? (
              <a
                className={`draw-transaction-card is-${record.status}`}
                href={`${explorerBaseUrl}/tx/${record.hash}`}
                key={record.id}
                rel="noreferrer"
                role="listitem"
                target="_blank"
              >
                {body}
              </a>
            ) : (
              <article className={`draw-transaction-card is-${record.status}`} key={record.id} role="listitem">
                {body}
              </article>
            )
          })}
        </div>
      ) : (
        <p className="draw-transaction-empty">
          {showingChain
            ? chainStatus === 'loading'
              ? copy.walletPanel.chainEventLoading
              : copy.walletPanel.noChainTransactions
            : copy.walletPanel.noSessionTransactions}
        </p>
      )}
    </section>
  )
}
