import { useCallback, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
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
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState(false)

  const resetCard = useCallback(() => {
    const element = cardRef.current
    if (!element) return
    applyVars(element, RESET_VARS)
    setActive(false)
  }, [])

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
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
      <div
        ref={cardRef}
        className={`holo-prize-card${active ? ' is-active' : ''}`}
        onPointerEnter={() => setActive(true)}
        onPointerMove={handlePointerMove}
        onPointerLeave={resetCard}
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
        </span>
      </div>
    </div>
  )
}
