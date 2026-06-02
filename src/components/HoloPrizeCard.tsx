import { useCallback, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import cardBack from '../assets/psa-pikachu-van-gogh-back-cut-fast.webp'
import cardFront from '../assets/psa-pikachu-van-gogh-front-cut-fast.webp'

const RESET_VARS = {
  '--mx': '50%',
  '--my': '50%',
  '--posx': '50%',
  '--posy': '50%',
  '--rx': '0deg',
  '--ry': '0deg',
  '--hyp': '0',
} as const

function applyVars(element: HTMLElement, values: Record<string, string>) {
  Object.entries(values).forEach(([name, value]) => {
    element.style.setProperty(name, value)
  })
}

export function HoloPrizeCard() {
  const cardRef = useRef<HTMLButtonElement | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [active, setActive] = useState(false)

  const resetCard = useCallback(() => {
    const element = cardRef.current
    if (!element) return
    applyVars(element, RESET_VARS)
    setActive(false)
  }, [])

  const handlePointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const element = event.currentTarget
    const rect = element.getBoundingClientRect()
    const pointerX = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
    const pointerY = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1)
    const rotateY = (pointerX - 0.5) * 24
    const rotateX = (0.5 - pointerY) * 18
    const hypotenuse = Math.min(Math.hypot(pointerX - 0.5, pointerY - 0.5) * 2.25, 1)

    applyVars(element, {
      '--mx': `${pointerX * 100}%`,
      '--my': `${pointerY * 100}%`,
      '--posx': `${pointerX * 100}%`,
      '--posy': `${pointerY * 100}%`,
      '--rx': `${rotateY.toFixed(2)}deg`,
      '--ry': `${rotateX.toFixed(2)}deg`,
      '--hyp': hypotenuse.toFixed(3),
    })
    setActive(true)
  }, [])

  return (
    <div className="holo-prize-stage">
      <button
        ref={cardRef}
        className={`holo-prize-card${flipped ? ' is-flipped' : ''}${active ? ' is-active' : ''}`}
        type="button"
        aria-label="Flip Van Gogh Pikachu PSA 10 prize card"
        onClick={() => setFlipped((current) => !current)}
        onPointerEnter={() => setActive(true)}
        onPointerMove={handlePointerMove}
        onPointerLeave={resetCard}
        style={{ '--flip': flipped ? '180deg' : '0deg' } as CSSProperties}
      >
        <span className="holo-prize-card__rotator">
          <span className="holo-prize-card__face holo-prize-card__front">
            <img
              src={cardFront}
              alt="Van Gogh Pikachu PSA 10 front"
              draggable={false}
              decoding="async"
              fetchPriority="high"
              height={630}
              loading="eager"
              width={360}
            />
            <span
              className="holo-prize-card__glare"
              aria-hidden="true"
              style={{ '--card-mask': `url(${cardFront})` } as CSSProperties}
            />
          </span>
          <span className="holo-prize-card__face holo-prize-card__back">
            <img src={cardBack} alt="Van Gogh Pikachu PSA 10 back" draggable={false} decoding="async" height={632} loading="eager" width={360} />
            <span
              className="holo-prize-card__glare"
              aria-hidden="true"
              style={{ '--card-mask': `url(${cardBack})` } as CSSProperties}
            />
          </span>
        </span>
      </button>
    </div>
  )
}
