import { RefreshCw, Wallet, X } from 'lucide-react'
import type { AppCopy } from '../lib/i18n'
import type { WalletProviderOption } from '../lib/wallet/providers'

export function WalletSelectorModal({
  copy,
  isConnecting,
  isOpen,
  onClose,
  onRefresh,
  onSelect,
  providers,
}: {
  copy: AppCopy
  isConnecting: boolean
  isOpen: boolean
  onClose: () => void
  onRefresh: () => void
  onSelect: (provider: WalletProviderOption) => void
  providers: WalletProviderOption[]
}) {
  if (!isOpen) return null

  return (
    <div className="wallet-selector-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-modal="true"
        aria-labelledby="wallet-selector-title"
        className="wallet-selector-modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="wallet-selector-heading">
          <div>
            <span className="eyebrow">{copy.walletPanel.detectedWallets}</span>
            <h2 id="wallet-selector-title">{copy.walletPanel.walletSelectorTitle}</h2>
            <p>{copy.walletPanel.walletSelectorSubtitle}</p>
          </div>
          <button className="wallet-selector-close" type="button" onClick={onClose} aria-label={copy.walletPanel.closeWalletSelector}>
            <X size={18} />
          </button>
        </div>

        <div className="wallet-provider-list">
          {providers.length > 0 ? (
            providers.map((provider) => (
              <button
                className="wallet-provider-button"
                disabled={isConnecting}
                key={provider.id}
                type="button"
                onClick={() => onSelect(provider)}
              >
                <span className="wallet-provider-icon" aria-hidden="true">
                  {provider.icon ? <img src={provider.icon} alt="" /> : <Wallet size={20} />}
                </span>
                <span>
                  <strong>{provider.name || copy.walletPanel.injectedWallet}</strong>
                  <small>{provider.source === 'eip6963' ? 'EIP-6963' : copy.walletPanel.injectedWallet}</small>
                </span>
              </button>
            ))
          ) : (
            <div className="wallet-provider-empty">
              <Wallet size={20} />
              <span>{copy.walletPanel.noWalletsDetected}</span>
            </div>
          )}
        </div>

        <button className="wallet-provider-refresh" disabled={isConnecting} type="button" onClick={onRefresh}>
          <RefreshCw size={16} />
          <span>{copy.walletPanel.refreshWallets}</span>
        </button>
      </section>
    </div>
  )
}
