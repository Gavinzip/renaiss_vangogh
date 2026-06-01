export const GRAND_PRIZE = 'Van Gogh Pikachu PSA 10'

export const CASH_PRIZES = [
  { label: '200 USDT', amount: 200, winners: 10 },
  { label: '100 USDT', amount: 100, winners: 10 },
] as const

export const CASH_PRIZE_POOL = CASH_PRIZES.reduce(
  (sum, prize) => sum + prize.amount * prize.winners,
  0,
)

export const TOTAL_PRIZE_SLOTS =
  1 + CASH_PRIZES.reduce((sum, prize) => sum + prize.winners, 0)
