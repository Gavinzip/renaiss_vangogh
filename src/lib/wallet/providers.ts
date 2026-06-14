export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, handler: (...args: unknown[]) => void) => void
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
  providers?: Eip1193Provider[]
  isBinance?: boolean
  isCoinbaseWallet?: boolean
  isMetaMask?: boolean
  isOkxWallet?: boolean
  isOKExWallet?: boolean
  isRabby?: boolean
  isTrust?: boolean
}

interface Eip6963ProviderInfo {
  uuid: string
  name: string
  icon: string
  rdns: string
}

interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo
  provider: Eip1193Provider
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider
  }
}

export interface WalletProviderOption {
  icon: string
  id: string
  name: string
  provider: Eip1193Provider
  rdns: string
  source: 'eip6963' | 'legacy'
}

export type WalletProviderListener = (options: WalletProviderOption[]) => void

export function requestWalletProviderAnnouncements() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event('eip6963:requestProvider'))
}

function legacyProviderName(provider: Eip1193Provider) {
  if (provider.isRabby) return 'Rabby'
  if (provider.isOkxWallet || provider.isOKExWallet) return 'OKX Wallet'
  if (provider.isTrust) return 'Trust Wallet'
  if (provider.isBinance) return 'Binance Wallet'
  if (provider.isCoinbaseWallet) return 'Coinbase Wallet'
  if (provider.isMetaMask) return 'MetaMask'
  return 'Browser wallet'
}

function legacyProviderId(provider: Eip1193Provider, index: number) {
  return `legacy:${legacyProviderName(provider).toLowerCase().replace(/\s+/g, '-')}:${index}`
}

function optionKey(option: WalletProviderOption) {
  return option.rdns || option.id || option.name
}

function sortWalletOptions(options: WalletProviderOption[]) {
  return [...options].sort((left, right) => {
    if (left.source !== right.source) return left.source === 'eip6963' ? -1 : 1
    return left.name.localeCompare(right.name)
  })
}

export function subscribeWalletProviders(listener: WalletProviderListener) {
  if (typeof window === 'undefined') return () => undefined

  const options = new Map<string, WalletProviderOption>()

  function publish() {
    listener(sortWalletOptions([...options.values()]))
  }

  function addOption(option: WalletProviderOption) {
    const key = optionKey(option)
    if (!key || options.has(key)) return
    options.set(key, option)
    publish()
  }

  function addLegacyProviders() {
    const ethereum = window.ethereum
    if (!ethereum) {
      publish()
      return
    }
    const providers = Array.isArray(ethereum.providers) && ethereum.providers.length > 0 ? ethereum.providers : [ethereum]
    providers.forEach((provider, index) => {
      addOption({
        icon: '',
        id: legacyProviderId(provider, index),
        name: legacyProviderName(provider),
        provider,
        rdns: '',
        source: 'legacy',
      })
    })
  }

  const handleAnnouncement = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail
    if (!detail?.provider || !detail.info?.uuid) return
    addOption({
      icon: detail.info.icon || '',
      id: detail.info.uuid,
      name: detail.info.name || 'Injected wallet',
      provider: detail.provider,
      rdns: detail.info.rdns || '',
      source: 'eip6963',
    })
  }

  window.addEventListener('eip6963:announceProvider', handleAnnouncement)
  requestWalletProviderAnnouncements()
  addLegacyProviders()

  const fallbackTimer = window.setTimeout(addLegacyProviders, 450)

  return () => {
    window.clearTimeout(fallbackTimer)
    window.removeEventListener('eip6963:announceProvider', handleAnnouncement)
  }
}
