export type PrizeGroupId = 'grand' | 'two-hundred-usdt' | 'one-hundred-usdt'
export type PrizeDrawMode = 'single' | 'batch'

export interface PrizeGroup {
  id: PrizeGroupId
  label: string
  reward: string
  slotStart: number
  slotCount: number
}

export const PRIZE_GROUPS: PrizeGroup[] = [
  {
    id: 'grand',
    label: 'Van Gogh Pikachu PSA 10',
    reward: 'PSA 10 Card',
    slotStart: 0,
    slotCount: 1,
  },
  {
    id: 'two-hundred-usdt',
    label: '200 USDT',
    reward: '200 USDT',
    slotStart: 1,
    slotCount: 10,
  },
  {
    id: 'one-hundred-usdt',
    label: '100 USDT',
    reward: '100 USDT',
    slotStart: 11,
    slotCount: 10,
  },
]

export const TOTAL_PRIZE_DRAW_SLOTS = PRIZE_GROUPS.reduce((sum, group) => sum + group.slotCount, 0)

export function prizeGroupForSlot(slotIndex: number): PrizeGroup {
  return PRIZE_GROUPS.find((group) => slotIndex >= group.slotStart && slotIndex < group.slotStart + group.slotCount) ?? PRIZE_GROUPS[0]
}

export function slotIndexesForPrizeGroup(groupId: PrizeGroupId): number[] {
  const group = PRIZE_GROUPS.find((item) => item.id === groupId) ?? PRIZE_GROUPS[0]
  return Array.from({ length: group.slotCount }, (_, index) => group.slotStart + index)
}

export function prizeOrdinalInGroup(slotIndex: number): number {
  const group = prizeGroupForSlot(slotIndex)
  return slotIndex - group.slotStart + 1
}

export function remainingSlotsForGroup(groupId: PrizeGroupId, drawnSlots: Set<number>): number[] {
  return slotIndexesForPrizeGroup(groupId).filter((slotIndex) => !drawnSlots.has(slotIndex))
}
