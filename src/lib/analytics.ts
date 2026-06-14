const TRACKED_HOSTS = new Set(['renaiss-vangogh.zeabur.app'])

type AnalyticsParamValue = string | number | boolean | null | undefined
type AnalyticsParams = Record<string, AnalyticsParamValue>

export type AnalyticsEventName =
  | 'copy_ticket_ranges'
  | 'draw_next'
  | 'draw_finalize'
  | 'draw_request'
  | 'draw_reset'
  | 'draw_run_mode_change'
  | 'draw_status_read'
  | 'hidden_draw_unlock'
  | 'language_change'
  | 'navigation_select'
  | 'ticket_search'
  | 'ticket_search_result'
  | 'wallet_connect'
  | 'wallet_connect_result'
  | 'wallet_disconnect'

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

let analyticsInitialized = false

function shouldTrackAnalytics() {
  return typeof window !== 'undefined' && TRACKED_HOSTS.has(window.location.hostname)
}

function cleanParams(params: AnalyticsParams = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null),
  ) as Record<string, string | number | boolean>
}

export function initializeAnalytics() {
  if (!shouldTrackAnalytics()) return false
  if (analyticsInitialized) return true

  analyticsInitialized = true
  window.dataLayer = window.dataLayer ?? []

  return true
}

export function trackPageView(page: string) {
  if (!initializeAnalytics()) return

  const pagePath = `${window.location.pathname}${window.location.search}#${page}`
  window.gtag?.('event', 'page_view', {
    page_title: `Renaiss Lucky Draw - ${page}`,
    page_location: `${window.location.origin}${pagePath}`,
    page_path: pagePath,
  })
}

export function trackEvent(eventName: AnalyticsEventName, params?: AnalyticsParams) {
  if (!initializeAnalytics()) return
  window.gtag?.('event', eventName, cleanParams(params))
}
