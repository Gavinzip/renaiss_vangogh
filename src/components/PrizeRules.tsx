import { useState, type MouseEvent } from 'react'
import { ChevronDown, Gift, Medal, Sparkles } from 'lucide-react'
import sbtBrownImage from '../assets/sbt-brown.webp'
import sbtGoldImage from '../assets/sbt-gold.webp'
import sbtRainbowImage from '../assets/sbt-rainbow.webp'
import sbtSilverImage from '../assets/sbt-silver.webp'
import type { AppCopy } from '../lib/i18n'
import { CASH_PRIZE_POOL, CASH_PRIZES, GRAND_PRIZE, TOTAL_PRIZE_SLOTS } from '../lib/prizes/prizes'
import { compactNumber } from '../lib/ticketing/display'
import { SBT_TIERS } from '../lib/ticketing/rules'
import type { SbtTier } from '../lib/ticketing/types'
import { PrizeGallery } from './PrizeGallery'

const RULES_SCROLL_DURATION_MS = 1200
let rulesScrollFrame: number | null = null

const SBT_TIER_IMAGES: Partial<Record<SbtTier, string>> = {
  brown: sbtBrownImage,
  silver: sbtSilverImage,
  gold: sbtGoldImage,
  rainbow: sbtRainbowImage,
}

function easeInOutSine(progress: number) {
  return -(Math.cos(Math.PI * progress) - 1) / 2
}

export function PrizeRules({ copy }: { copy: AppCopy }) {
  const [activePrizeIndex, setActivePrizeIndex] = useState(0)
  const activePrize = copy.rules.prizes[activePrizeIndex] ?? copy.rules.prizes[0]
  const activePrizeMeta = [
    { label: copy.rules.prizeMeta.prize, value: activePrize.title },
    { label: copy.rules.prizeMeta.reward, value: activePrize.reward },
    { label: copy.rules.prizeMeta.winners, value: activePrize.winners },
    'source' in activePrize && activePrize.source
      ? { label: copy.rules.prizeMeta.source, value: activePrize.source }
      : { label: copy.rules.prizeMeta.pool, value: 'pool' in activePrize ? activePrize.pool : '-' },
  ]

  function scrollToRules(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()

    const target = document.getElementById('draw-rules')
    if (!target) return

    const targetY = Math.max(0, target.getBoundingClientRect().top + window.scrollY)
    const startY = window.scrollY
    const distance = targetY - startY
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (prefersReducedMotion || Math.abs(distance) < 2) {
      window.scrollTo({ top: targetY, left: 0, behavior: 'auto' })
      window.history.replaceState(null, '', '#draw-rules')
      return
    }

    if (rulesScrollFrame !== null) {
      window.cancelAnimationFrame(rulesScrollFrame)
    }

    const startedAt = window.performance.now()
    const step = (now: number) => {
      const progress = Math.min((now - startedAt) / RULES_SCROLL_DURATION_MS, 1)
      const nextY = startY + distance * easeInOutSine(progress)

      window.scrollTo({ top: nextY, left: 0, behavior: 'auto' })

      if (progress < 1) {
        rulesScrollFrame = window.requestAnimationFrame(step)
        return
      }

      rulesScrollFrame = null
      window.history.replaceState(null, '', '#draw-rules')
    }

    rulesScrollFrame = window.requestAnimationFrame(step)
  }

  return (
    <section className="rules-gallery-page" aria-label="Rules and prizes">
      <div className="rules-hero-frame">
        <PrizeGallery onActiveChange={setActivePrizeIndex} />

        <div className="rules-gallery-copy">
        <span className="gallery-catalogue">{copy.rules.catalogue}</span>
        <h1>
          {copy.rules.titleLine1}{' '}
          <br />
          {copy.rules.titleLine2}
        </h1>

        <div className="gallery-prize-summary gallery-prize-summary--hero">
          <div>
            <Medal size={18} />
            <span>{copy.rules.prizes[0].title}</span>
          </div>
          {CASH_PRIZES.map((prize) => (
            <div key={prize.label}>
              <Gift size={18} />
              <span>
                {prize.label} x {prize.winners}
              </span>
            </div>
          ))}
        </div>

        <div className="gallery-meta-grid" aria-label={`Active prize: ${activePrize.title}`}>
          {activePrizeMeta.map((item) => (
            <div className="gallery-meta-pair" key={`${activePrize.title}-${item.label}`}>
              <span className="gallery-meta-label">{item.label}</span>
              <span className="gallery-meta-value">{item.value}</span>
            </div>
          ))}
        </div>

        <a className="rules-down-link" href="#draw-rules" onClick={scrollToRules}>
          <ChevronDown size={20} />
          <span>{copy.rules.viewRules}</span>
        </a>

        </div>

        <a className="rules-scroll-hint" href="#draw-rules" onClick={scrollToRules}>
          <ChevronDown size={18} />
          <span>{copy.rules.scrollForRules}</span>
        </a>
      </div>

      <section className="rules-detail-section" id="draw-rules" aria-label="Lucky draw rules">
        <div className="rules-detail-heading">
          <span className="gallery-catalogue">{copy.rules.detailCatalogue}</span>
          <h2>{copy.rules.detailTitle}</h2>
          <p>
            {copy.rules.detailCopy}
          </p>
        </div>

        <div className="rules-detail-grid rules-detail-grid--editorial">
          <article className="rules-detail-card rules-process-card">
            <span className="rules-card-index">A</span>
            <h3>{copy.rules.timelineTitle}</h3>
            <div className="rules-timeline">
              {copy.rules.timeline.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.title}</strong>
                  <p>{item.text}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="rules-detail-card rules-ledger-card">
            <Sparkles size={22} />
            <h3>{copy.ticketHome.ticketMath}</h3>
            <div className="gallery-rule-list">
              {copy.rules.rulesRows.map((rule) => (
                <div key={rule.label}>
                  <span>{rule.label}</span>
                  <strong>{rule.value}</strong>
                </div>
              ))}
            </div>
          </article>

          <article className="rules-detail-card rules-prize-card">
            <Gift size={22} />
            <h3>{copy.rules.prizeAllocation}</h3>
            <div className="gallery-rule-list">
              <div>
                <span>{copy.rules.totalWinners}</span>
                <strong>{TOTAL_PRIZE_SLOTS}</strong>
              </div>
              <div>
                <span>{copy.rules.grandPrize}</span>
                <strong>{GRAND_PRIZE} x 1</strong>
              </div>
              {CASH_PRIZES.map((prize) => (
                <div key={prize.label}>
                  <span>{prize.label}</span>
                  <strong>
                    {prize.winners} {copy.rules.winners}
                  </strong>
                </div>
              ))}
              <div>
                <span>{copy.rules.cashPool}</span>
                <strong>{compactNumber(CASH_PRIZE_POOL)} USDT</strong>
              </div>
            </div>
          </article>

          <article className="rules-detail-card rules-sbt-card">
            <Medal size={22} />
            <h3>{copy.rules.sbtMultipliers}</h3>
            <div className="rules-detail-tier-list">
              {[...SBT_TIERS].map((tier) => (
                <div className={`rules-tier-chip tier-${tier.tier}`} key={tier.tier}>
                  {SBT_TIER_IMAGES[tier.tier] && <img src={SBT_TIER_IMAGES[tier.tier]} alt="" decoding="async" loading="lazy" />}
                  <strong>{copy.sbt.tiers[tier.tier]}</strong>
                  <span>
                    {tier.threshold}
                    {copy.rules.thresholdSuffix} / x{tier.multiplier}
                  </span>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>
    </section>
  )
}
