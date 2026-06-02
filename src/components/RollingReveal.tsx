import { useEffect, useMemo, useState } from 'react'

const SCRAMBLE_FRAMES = 18
const SCRAMBLE_FRAME_MS = 58

function makeScramble(finalValue: string, frame: number, totalFrames = SCRAMBLE_FRAMES): string {
  const text = finalValue || '-'
  if (text === '-' || frame <= 0) return text

  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  const revealableCount = text.split('').filter((char) => !/[\s.,%x#-]/.test(char)).length
  const revealedCount = Math.floor((frame / totalFrames) * revealableCount)
  let revealIndex = 0

  return text
    .split('')
    .map((char, index) => {
      if (/[\s.,%x#-]/.test(char)) return char
      const output = revealIndex < revealedCount
        ? char
        : chars[(index * 11 + frame * 7 + revealIndex * 5) % chars.length]
      revealIndex += 1
      return output
    })
    .join('')
}

export function RollingReveal({
  value,
  delay = 0,
}: {
  value: string | number
  delay?: number
}) {
  const finalValue = String(value)
  const [displayValue, setDisplayValue] = useState(finalValue)
  const [settled, setSettled] = useState(true)

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  useEffect(() => {
    if (prefersReducedMotion) {
      return undefined
    }

    let frame = 0
    let interval = 0
    const timeout = window.setTimeout(() => {
      setSettled(false)
      setDisplayValue(makeScramble(finalValue, 1))
      interval = window.setInterval(() => {
        frame += 1
        if (frame >= SCRAMBLE_FRAMES) {
          window.clearInterval(interval)
          setDisplayValue(finalValue)
          setSettled(true)
          return
        }
        setDisplayValue(makeScramble(finalValue, frame))
      }, SCRAMBLE_FRAME_MS)
    }, delay)

    return () => {
      window.clearTimeout(timeout)
      window.clearInterval(interval)
    }
  }, [delay, finalValue, prefersReducedMotion])

  return (
    <span className={settled ? 'rolling-value settled' : 'rolling-value'} aria-live="polite">
      {prefersReducedMotion ? finalValue : displayValue}
    </span>
  )
}
