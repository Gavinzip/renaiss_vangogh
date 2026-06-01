import { useEffect, useMemo, useState } from 'react'

function makeScramble(finalValue: string, frame: number): string {
  const text = finalValue || '-'
  if (text === '-' || frame <= 0) return text

  const chars = '0123456789ABCDEF'
  return text
    .split('')
    .map((char, index) => {
      if (/[\s.,%x#-]/.test(char)) return char
      if (index < Math.max(0, text.length - frame)) return chars[(index * 7 + frame * 5) % chars.length]
      return char
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
      interval = window.setInterval(() => {
        frame += 1
        if (frame >= 12) {
          window.clearInterval(interval)
          setDisplayValue(finalValue)
          setSettled(true)
          return
        }
        setDisplayValue(makeScramble(finalValue, frame))
      }, 44)
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
