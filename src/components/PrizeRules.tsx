import { Gift, Sparkles } from 'lucide-react'
import sbtBrownImage from '../assets/sbt-brown.webp'
import sbtGoldImage from '../assets/sbt-gold.webp'
import sbtRainbowImage from '../assets/sbt-rainbow.webp'
import sbtSilverImage from '../assets/sbt-silver.webp'
import type { AppCopy } from '../lib/i18n'
import { CASH_PRIZE_POOL, CASH_PRIZES, GRAND_PRIZE, TOTAL_PRIZE_SLOTS } from '../lib/prizes/prizes'
import { compactNumber } from '../lib/ticketing/display'
import { PACK_LABELS, PACK_WEIGHTS, SBT_TIERS } from '../lib/ticketing/rules'
import type { PackKey, SbtTier } from '../lib/ticketing/types'

const SBT_TIER_IMAGES: Partial<Record<SbtTier, string>> = {
  brown: sbtBrownImage,
  silver: sbtSilverImage,
  gold: sbtGoldImage,
  rainbow: sbtRainbowImage,
}

export function PrizeRules({ copy }: { copy: AppCopy }) {
  const packWeightRows = (Object.keys(PACK_WEIGHTS) as PackKey[]).map((pack) => ({
    pack,
    label: copy.packs[pack] || PACK_LABELS[pack],
    weight: PACK_WEIGHTS[pack],
  }))

  return (
    <section className="rules-gallery-page" aria-label="Rules and prizes">
      <section className="rules-sbt-hero" aria-label={copy.rules.sbtMultipliers}>
        <div className="rules-sbt-hero-copy">
          <span className="gallery-catalogue">{copy.rules.rawBonusGuide.sbtTitle}</span>
          <h1>SBT</h1>
          <p>{copy.rules.detailCopy}</p>
        </div>

        <div className="rules-sbt-hero-grid">
          {SBT_TIERS.map((tier) => (
            <article className={`rules-sbt-tier-card tier-${tier.tier}`} key={tier.tier}>
              {SBT_TIER_IMAGES[tier.tier] && (
                <img
                  src={SBT_TIER_IMAGES[tier.tier]}
                  alt=""
                  width="320"
                  height="320"
                  decoding="async"
                  loading="eager"
                  fetchPriority="high"
                />
              )}
              <div>
                <strong>{copy.sbt.tiers[tier.tier]}</strong>
                <span>
                  {tier.threshold}
                  {copy.rules.thresholdSuffix}
                </span>
              </div>
              <b className={tier.multiplier < 2 ? 'rules-sbt-multiplier--compact' : undefined}>x{tier.multiplier}</b>
            </article>
          ))}
        </div>
      </section>

      <section className="rules-detail-section" id="draw-rules" aria-label="Lucky draw rules">
        <div className="rules-detail-heading">
          <span className="gallery-catalogue">{copy.rules.detailCatalogue}</span>
          <h2>{copy.rules.detailTitle}</h2>
          <p>
            {copy.rules.detailCopy}
          </p>
        </div>

        <section className="rules-ticket-math-panel" aria-label={copy.rules.rawBonusGuide.title}>
          <div className="rules-ticket-math-header">
            <span className="gallery-catalogue">{copy.rules.rawBonusGuide.eyebrow}</span>
            <h3>{copy.rules.rawBonusGuide.title}</h3>
            <p>{copy.rules.rawBonusGuide.copy}</p>
          </div>

          <div className="rules-ticket-formula-grid">
            {copy.rules.rawBonusGuide.formulas.map((formula, index) => (
              <article className="rules-ticket-formula-card" key={formula.label}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{formula.label}</strong>
                <code>{formula.value}</code>
                <p>{formula.text}</p>
              </article>
            ))}
          </div>

          <div className="rules-ticket-math-data">
            <div className="rules-ticket-weight-card">
              <strong>{copy.rules.rawBonusGuide.packWeightsTitle}</strong>
              <div>
                {packWeightRows.map((row) => (
                  <span key={row.pack}>
                    {row.label}
                    <b>x{row.weight}</b>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

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

        </div>
      </section>
    </section>
  )
}
