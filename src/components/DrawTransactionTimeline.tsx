import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { DrawNetworkConfig } from '../lib/contracts/luckyDrawNetworks'
import type { AppCopy } from '../lib/i18n'
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

function shortHash(hash: string) {
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`
}

export function DrawTransactionTimeline({
  network,
  records,
  copy,
}: {
  network: DrawNetworkConfig
  records: DrawTransactionRecord[]
  copy: AppCopy
}) {
  const [clockNow, setClockNow] = useState(() => Date.now())
  const explorerBaseUrl = network.blockExplorerUrls[0]?.replace(/\/$/, '') ?? ''

  useEffect(() => {
    const hasActiveRecord = records.some((record) => record.status === 'awaiting-signature' || record.status === 'pending')
    if (!hasActiveRecord) return undefined
    const intervalId = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [records])

  return (
    <section className="panel draw-transaction-timeline" aria-label={copy.walletPanel.transactionTimeline}>
      <div className="draw-transaction-head">
        <div>
          <span className="eyebrow">{copy.walletPanel.sessionTransactions}</span>
          <h2>{copy.walletPanel.transactionTimeline}</h2>
        </div>
        <strong>{records.length > 0 ? records.length : copy.walletPanel.noSessionTransactions}</strong>
      </div>

      {records.length > 0 ? (
        <div className="draw-transaction-scroll" role="list" tabIndex={0}>
          {records.map((record) => {
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
        <p className="draw-transaction-empty">{copy.walletPanel.noSessionTransactions}</p>
      )}
    </section>
  )
}
