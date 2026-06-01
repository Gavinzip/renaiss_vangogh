import { Database, Loader2, LockKeyhole, Sparkles, Wallet } from 'lucide-react'
import { useState } from 'react'
import type { AppCopy } from '../lib/i18n'
import { compactNumber } from '../lib/ticketing/display'
import { formatAddress } from '../lib/ticketing/rules'
import {
  BSC_MAINNET_CHAIN_ID,
  connectInjectedWallet,
  readDrawStatus,
  requestContractDraw,
  type ConnectedWallet,
  type DrawStatus,
} from '../lib/wallet/bsc'

export function WalletPanel({
  contractAddress,
  setContractAddress,
  wallet,
  setWallet,
  copy,
}: {
  contractAddress: string
  setContractAddress: (value: string) => void
  wallet: ConnectedWallet | null
  setWallet: (wallet: ConnectedWallet | null) => void
  copy: AppCopy
}) {
  const [status, setStatus] = useState<DrawStatus | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<'connect' | 'read' | 'draw' | null>(null)

  async function connectWallet() {
    setBusy('connect')
    setMessage('')
    try {
      setWallet(await connectInjectedWallet())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : copy.walletPanel.connectionFailed)
    } finally {
      setBusy(null)
    }
  }

  async function refreshStatus() {
    if (!wallet) {
      setMessage(copy.walletPanel.connectFirst)
      return
    }
    if (!contractAddress.trim()) {
      setMessage(copy.walletPanel.setContractFirst)
      return
    }
    setBusy('read')
    setMessage('')
    try {
      setStatus(await readDrawStatus(wallet.provider, contractAddress.trim()))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : copy.walletPanel.readFailed)
    } finally {
      setBusy(null)
    }
  }

  async function requestDraw() {
    if (!wallet) {
      setMessage(copy.walletPanel.connectFirst)
      return
    }
    if (!contractAddress.trim()) {
      setMessage(copy.walletPanel.setContractFirst)
      return
    }
    setBusy('draw')
    setMessage('')
    try {
      const hash = await requestContractDraw(wallet.provider, contractAddress.trim())
      setMessage(`${copy.walletPanel.drawSent}: ${hash}`)
      await refreshStatus()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : copy.walletPanel.drawFailed)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="panel wallet-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.walletPanel.bscLiveDraw}</span>
          <h2>{copy.walletPanel.title}</h2>
        </div>
        <LockKeyhole size={20} />
      </div>

      <label className="field">
        <span>{copy.walletPanel.contract}</span>
        <input
          value={contractAddress}
          onChange={(event) => setContractAddress(event.target.value)}
          placeholder="0x..."
          spellCheck={false}
        />
      </label>

      <div className="button-row">
        <button className="primary shimmer-button" onClick={connectWallet} disabled={busy !== null}>
          {busy === 'connect' ? <Loader2 className="spin" size={18} /> : <Wallet size={18} />}
          {wallet ? formatAddress(wallet.address) : copy.walletPanel.connectBsc}
        </button>
        <button onClick={refreshStatus} disabled={busy !== null || !wallet}>
          {busy === 'read' ? <Loader2 className="spin" size={18} /> : <Database size={18} />}
          {copy.walletPanel.read}
        </button>
        <button onClick={requestDraw} disabled={busy !== null || !wallet}>
          {busy === 'draw' ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
          {copy.walletPanel.draw}
        </button>
      </div>

      {wallet && (
        <div className="mini-grid">
          <span>{copy.walletPanel.chain}</span>
          <strong>{wallet.chainId === BSC_MAINNET_CHAIN_ID ? 'BSC Mainnet' : wallet.chainName}</strong>
          <span>{copy.walletPanel.operator}</span>
          <strong>{formatAddress(wallet.address)}</strong>
        </div>
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
            <span>{copy.walletPanel.drawState}</span>
            <strong>{status.fulfilled ? copy.walletPanel.fulfilled : status.requested ? copy.walletPanel.requested : copy.walletPanel.ready}</strong>
          </div>
          <div>
            <span>{copy.walletPanel.winners}</span>
            <strong>
              {status.winnerCount > 0n
                ? `${compactNumber(status.winnerCount)} / ${compactNumber(status.prizeSlotCount)}`
                : `0 / ${compactNumber(status.prizeSlotCount)}`}
            </strong>
          </div>
        </div>
      )}

      {status?.winnerTickets.length ? (
        <div className="winner-strip">
          {status.winnerTickets.map((ticket) => (
            <span key={ticket.toString()}>#{compactNumber(ticket)}</span>
          ))}
        </div>
      ) : null}

      {message && <p className="message">{message}</p>}
    </section>
  )
}
