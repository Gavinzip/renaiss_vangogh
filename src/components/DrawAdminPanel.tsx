import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAddress } from 'ethers'
import { Loader2, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import type { DrawNetworkConfig, DrawNetworkKey } from '../lib/contracts/luckyDrawNetworks'
import { sameAddress } from '../lib/contracts/luckyDrawNetworks'
import type { AppCopy } from '../lib/i18n'
import { formatAddress } from '../lib/ticketing/rules'
import {
  readDrawAdminList,
  setDrawAdminAllowed,
  type ConnectedWallet,
  type DrawAdminList,
  type DrawAdminMember,
  type DrawStatus,
} from '../lib/wallet/bsc'

function roleLabel(member: DrawAdminMember, copy: AppCopy) {
  if (member.role === 'owner') return copy.drawAdmin.owner
  if (member.role === 'operator') return copy.drawAdmin.operator
  return copy.drawAdmin.admin
}

function roleClass(member: DrawAdminMember) {
  if (member.role === 'owner') return 'is-owner'
  if (member.role === 'operator') return 'is-operator'
  return 'is-admin'
}

function normalizeInputAddress(value: string) {
  return getAddress(value.trim())
}

export function DrawAdminPanel({
  network,
  networkKey,
  wallet,
  status,
  copy,
  onRefreshStatus,
}: {
  network: DrawNetworkConfig
  networkKey: DrawNetworkKey
  wallet: ConnectedWallet
  status: DrawStatus
  copy: AppCopy
  onRefreshStatus: () => Promise<void>
}) {
  const [adminList, setAdminList] = useState<DrawAdminList | null>(null)
  const [addressInput, setAddressInput] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [pendingAddress, setPendingAddress] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [lastTxHash, setLastTxHash] = useState('')
  const explorerBaseUrl = network.blockExplorerUrls[0]?.replace(/\/$/, '') ?? ''
  const txExplorerUrl = lastTxHash && explorerBaseUrl ? `${explorerBaseUrl}/tx/${lastTxHash}` : ''

  const canManage = useMemo(() => sameAddress(wallet.address, status.ownerAddress), [status.ownerAddress, wallet.address])

  const loadAdmins = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const nextAdminList = await readDrawAdminList(network.contractAddress, networkKey)
      setAdminList(nextAdminList)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : copy.drawAdmin.readFailed)
    } finally {
      setIsLoading(false)
    }
  }, [copy.drawAdmin.readFailed, network.contractAddress, networkKey])

  useEffect(() => {
    if (!canManage) return undefined
    let cancelled = false
    readDrawAdminList(network.contractAddress, networkKey)
      .then((nextAdminList) => {
        if (!cancelled) setAdminList(nextAdminList)
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : copy.drawAdmin.readFailed)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [canManage, copy.drawAdmin.readFailed, network.contractAddress, networkKey])

  if (!canManage) return null

  async function applyAdminChange(address: string, allowed: boolean) {
    setError('')
    setMessage('')
    setLastTxHash('')
    setPendingAddress(address)
    try {
      const txHash = await setDrawAdminAllowed(
        wallet.injectedProvider ?? wallet.provider,
        network.contractAddress,
        networkKey,
        address,
        allowed,
        (hash) => {
          setLastTxHash(hash)
          setMessage(copy.drawAdmin.txSubmitted)
        },
      )
      setLastTxHash(txHash)
      setMessage(copy.drawAdmin.txConfirmed)
      setAddressInput('')
      await Promise.all([loadAdmins(), onRefreshStatus()])
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : copy.drawAdmin.updateFailed)
    } finally {
      setPendingAddress('')
    }
  }

  async function handleAddAdmin() {
    let normalizedAddress = ''
    try {
      normalizedAddress = normalizeInputAddress(addressInput)
    } catch {
      setError(copy.drawAdmin.invalidAddress)
      return
    }

    if (adminList?.members.some((member) => sameAddress(member.address, normalizedAddress))) {
      setError(copy.drawAdmin.alreadyListed)
      return
    }

    await applyAdminChange(normalizedAddress, true)
  }

  async function handleRemoveAdmin(member: DrawAdminMember) {
    await applyAdminChange(member.address, false)
  }

  return (
    <section className="panel draw-admin-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.drawAdmin.eyebrow}</span>
          <h2>{copy.drawAdmin.title}</h2>
          <p>{copy.drawAdmin.subtitle}</p>
        </div>
        <button className="icon-button draw-admin-refresh" type="button" onClick={loadAdmins} disabled={isLoading || Boolean(pendingAddress)}>
          {isLoading ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
          <span>{copy.drawAdmin.refresh}</span>
        </button>
      </div>

      <div className="draw-admin-form">
        <label>
          <span>{copy.drawAdmin.addLabel}</span>
          <input
            value={addressInput}
            onChange={(event) => setAddressInput(event.target.value)}
            placeholder={copy.drawAdmin.addressPlaceholder}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button className="primary" type="button" onClick={handleAddAdmin} disabled={Boolean(pendingAddress) || isLoading}>
          {pendingAddress && !adminList?.members.some((member) => sameAddress(member.address, pendingAddress)) ? (
            <Loader2 className="spin" size={17} />
          ) : (
            <Plus size={17} />
          )}
          {copy.drawAdmin.addAdmin}
        </button>
      </div>

      <div className="draw-admin-list">
        <div className="draw-admin-list-head">
          <strong>{copy.drawAdmin.currentAdmins}</strong>
          <span>
            {adminList ? `${adminList.members.length}` : '-'}
          </span>
        </div>

        {isLoading && !adminList && <p className="message">{copy.drawAdmin.loading}</p>}

        {adminList?.members.map((member) => (
          <div className="draw-admin-row" key={`${member.role}:${member.address}`}>
            <ShieldCheck size={18} />
            <div>
              <strong>{formatAddress(member.address)}</strong>
              <small>{member.address}</small>
            </div>
            <span className={`draw-admin-role ${roleClass(member)}`}>{roleLabel(member, copy)}</span>
            {member.role === 'admin' && (
              <button
                className="draw-admin-remove"
                type="button"
                onClick={() => handleRemoveAdmin(member)}
                disabled={Boolean(pendingAddress) || isLoading}
                aria-label={`${copy.drawAdmin.removeAdmin} ${member.address}`}
              >
                {sameAddress(pendingAddress, member.address) ? <Loader2 className="spin" size={17} /> : <Trash2 size={17} />}
                <span>{copy.drawAdmin.removeAdmin}</span>
              </button>
            )}
          </div>
        ))}

        {adminList && adminList.admins.length === 0 && <p className="message">{copy.drawAdmin.noAdmins}</p>}
      </div>

      <p className="draw-admin-note">{copy.drawAdmin.eventSourceNote}</p>
      {message && (
        <p className="message draw-admin-message">
          {txExplorerUrl ? (
            <a href={txExplorerUrl} target="_blank" rel="noreferrer">
              {message}
            </a>
          ) : (
            message
          )}
        </p>
      )}
      {error && <p className="message wallet-warning-message">{error || copy.drawAdmin.readFailed}</p>}
    </section>
  )
}
