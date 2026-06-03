import { Crown, FastForward, Loader2, Play, RotateCcw, Shuffle, Sparkles } from 'lucide-react'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { gsap } from 'gsap'
import goldTicketImage from '../assets/gold-ticket-transparent.webp'
import {
  PRIZE_GROUPS,
  TOTAL_PRIZE_DRAW_SLOTS,
  prizeGroupForSlot,
  prizeOrdinalInGroup,
  remainingSlotsForGroup,
  slotIndexesForPrizeGroup,
  type PrizeDrawMode,
  type PrizeGroupId,
} from '../lib/draw/prizeSlots'
import { isDrawNetworkKey, type DrawNetworkConfig, type DrawRunMode } from '../lib/contracts/luckyDrawNetworks'
import type { AppCopy } from '../lib/i18n'
import { compactNumber, formatDrawTicketNumber } from '../lib/ticketing/display'
import type { WalletIdentityMap } from '../lib/ticketing/identities'
import { formatAddress } from '../lib/ticketing/rules'
import type { RaffleLedger } from '../lib/ticketing/types'
import { buildWinnerCandidateSnapshot, findWinnerCandidate, type WinnerCandidate } from '../lib/ticketing/winnerCandidates'
import type { ContractRevealResult, DrawStatus } from '../lib/wallet/bsc'
import { formatDurationMs, transactionDuration, type DrawTransactionRecord, type DrawVrfTiming } from '../lib/wallet/drawTransactions'
import { formatVrfPaymentBalance, hasInsufficientVrfFunding } from '../lib/wallet/vrfSubscription'

const DRAW_ANIMATION_SRC = '/draw-animation.mp4'

const DEMO_WINNER_TICKETS_BY_SLOT = [
  '11111',
  '12095',
  '10000',
  '14396',
  '10119',
  '10595',
  '11950',
  '11585',
  '13743',
  '10813',
  '12333',
  '18409',
  '12881',
  '22221',
  '34017',
  '45678',
  '57931',
  '68888',
  '73456',
  '91827',
  '111110',
] as const

type DrawResultSource = 'contract' | 'demo'
interface DrawWinnerResult {
  owner: WinnerCandidate | null
  prizeGroupId: PrizeGroupId
  prizeOrdinal: number
  slotIndex: number
  source: DrawResultSource
  ticket: string
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isMediaPlaybackBlocked(error: unknown) {
  if (!(error instanceof Error)) return false
  return error.name === 'NotAllowedError' || /notallowed|permission|user gesture|user activation/i.test(error.message)
}

function buildWinnerResult({
  identities,
  ledger,
  slotIndex,
  source,
  ticket,
}: {
  identities: WalletIdentityMap
  ledger: RaffleLedger
  slotIndex: number
  source: DrawResultSource
  ticket: bigint | string
}): DrawWinnerResult {
  const prizeGroup = prizeGroupForSlot(slotIndex)
  const ticketNumber = ticket.toString()
  return {
    owner: findWinnerCandidate({ winnerTicket: BigInt(ticketNumber), ledger, identities }),
    prizeGroupId: prizeGroup.id,
    prizeOrdinal: prizeOrdinalInGroup(slotIndex),
    slotIndex,
    source,
    ticket: ticketNumber,
  }
}

export function DrawReveal({
  runMode,
  onRunModeChange,
  network,
  walletAddress,
  authorizedOperatorAddress,
  winnerTicketsBySlot,
  revealedPrizeSlots,
  totalTickets,
  ledger,
  walletIdentities,
  copy,
  drawStatus,
  hasWallet,
  isContractBusy,
  isContractLedgerMismatch,
  canResetRound,
  operatorMessage,
  onConnectWallet,
  onResetRound,
  onFinalizeLedger,
  onRefreshStatus,
  onRequestDraw,
  onDrawContractPrizeSlots,
  onDrawRandomContractPrizeSlot,
  transactionRecords,
  vrfTiming,
}: {
  runMode: DrawRunMode
  onRunModeChange: (mode: DrawRunMode) => void
  network: DrawNetworkConfig
  walletAddress: string | null
  authorizedOperatorAddress: string
  winnerTicketsBySlot: bigint[]
  revealedPrizeSlots: bigint[]
  totalTickets: number
  ledger: RaffleLedger
  walletIdentities: WalletIdentityMap
  copy: AppCopy
  drawStatus: DrawStatus | null
  hasWallet: boolean
  isContractBusy: boolean
  isContractLedgerMismatch: boolean
  canResetRound: boolean
  operatorMessage: string
  onConnectWallet: () => void
  onResetRound: () => Promise<boolean>
  onFinalizeLedger: () => Promise<void>
  onRefreshStatus: () => Promise<void>
  onRequestDraw: () => Promise<void>
  onDrawContractPrizeSlots: (prizeSlotIndexes: number[]) => Promise<ContractRevealResult[]>
  onDrawRandomContractPrizeSlot: () => Promise<ContractRevealResult[]>
  transactionRecords: DrawTransactionRecord[]
  vrfTiming: DrawVrfTiming | null
}) {
  const [phase, setPhase] = useState<'idle' | 'video' | 'reveal'>('idle')
  const [digitRevealState, setDigitRevealState] = useState({ ticketNumber: '', count: 0 })
  const [selectedPrizeGroupId, setSelectedPrizeGroupId] = useState<PrizeGroupId>('grand')
  const [drawMode, setDrawMode] = useState<PrizeDrawMode>('single')
  const [batchRevealCount, setBatchRevealCount] = useState(10)
  const [demoResults, setDemoResults] = useState<DrawWinnerResult[]>([])
  const [revealedContractResults, setRevealedContractResults] = useState<DrawWinnerResult[]>([])
  const [currentReveal, setCurrentReveal] = useState<DrawWinnerResult | null>(null)
  const [currentBatchReveal, setCurrentBatchReveal] = useState<DrawWinnerResult[]>([])
  const [isSequenceRunning, setIsSequenceRunning] = useState(false)
  const [sequenceMessage, setSequenceMessage] = useState('')
  const [videoReady, setVideoReady] = useState(false)
  const [videoLoadError, setVideoLoadError] = useState(false)
  const [clockNow, setClockNow] = useState(0)
  const rootRef = useRef<HTMLElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const videoPlaybackCancelRef = useRef<(() => void) | null>(null)
  const sequenceLockRef = useRef(false)
  const previousRevealedDigitCountRef = useRef(0)

  const prizeLabels = useMemo<Record<PrizeGroupId, string>>(
    () => ({
      grand: copy.rules.prizes[0]?.title ?? PRIZE_GROUPS[0].label,
      'two-hundred-usdt': copy.rules.prizes[1]?.title ?? PRIZE_GROUPS[1].label,
      'one-hundred-usdt': copy.rules.prizes[2]?.title ?? PRIZE_GROUPS[2].label,
    }),
    [copy],
  )
  const prizeRewards = useMemo<Record<PrizeGroupId, string>>(
    () => ({
      grand: copy.rules.prizes[0]?.reward ?? PRIZE_GROUPS[0].reward,
      'two-hundred-usdt': copy.rules.prizes[1]?.reward ?? PRIZE_GROUPS[1].reward,
      'one-hundred-usdt': copy.rules.prizes[2]?.reward ?? PRIZE_GROUPS[2].reward,
    }),
    [copy],
  )

  const revealedPrizeSlotIndexes = useMemo(
    () =>
      revealedPrizeSlots
        .map((slotIndex) => Number(slotIndex))
        .filter((slotIndex) => Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < TOTAL_PRIZE_DRAW_SLOTS),
    [revealedPrizeSlots],
  )
  const contractResults = useMemo(
    () =>
      revealedPrizeSlotIndexes
        .map((slotIndex) => {
          const ticket = winnerTicketsBySlot[slotIndex]
          if (!ticket || ticket <= 0n) return null
          return buildWinnerResult({
            identities: walletIdentities,
            ledger,
            slotIndex,
            source: 'contract',
            ticket,
          })
        })
        .filter((result): result is DrawWinnerResult => Boolean(result)),
    [ledger, revealedPrizeSlotIndexes, walletIdentities, winnerTicketsBySlot],
  )
  const isLiveRunMode = isDrawNetworkKey(runMode)
  const visibleResults = isLiveRunMode ? (isSequenceRunning ? revealedContractResults : contractResults) : demoResults
  const resultSource: 'contract' | 'demo' | 'empty' = isLiveRunMode ? (visibleResults.length > 0 ? 'contract' : 'empty') : demoResults.length > 0 ? 'demo' : 'empty'
  const drawnSlots = useMemo(() => new Set(visibleResults.map((result) => result.slotIndex)), [visibleResults])
  const selectedStateGroupSlots = slotIndexesForPrizeGroup(selectedPrizeGroupId)
  const selectedStateGroupHasRemainingSlots = selectedStateGroupSlots.some((slotIndex) => !drawnSlots.has(slotIndex))
  const nextIncompletePrizeGroup = PRIZE_GROUPS.find((group) => slotIndexesForPrizeGroup(group.id).some((slotIndex) => !drawnSlots.has(slotIndex))) ?? null
  const activePrizeGroupId =
    isLiveRunMode && nextIncompletePrizeGroup && !selectedStateGroupHasRemainingSlots
      ? nextIncompletePrizeGroup.id
      : selectedPrizeGroupId
  const selectedGroup = PRIZE_GROUPS.find((group) => group.id === activePrizeGroupId) ?? PRIZE_GROUPS[0]
  const selectedGroupCanBatch = selectedGroup.slotCount > 1
  const effectiveDrawMode: PrizeDrawMode = selectedGroupCanBatch ? drawMode : 'single'
  const selectedRemainingSlots = remainingSlotsForGroup(activePrizeGroupId, drawnSlots)
  const selectedRemainingSlotCount = selectedRemainingSlots.length
  const selectedGroupSlots = slotIndexesForPrizeGroup(activePrizeGroupId)
  const requiresSequentialContractReveal = Boolean(isLiveRunMode && drawStatus && !drawStatus.supportsSelectablePrizeSlots)
  const nextSequentialContractSlot = revealedPrizeSlotIndexes.length
  const isSelectedGroupNextToReveal = !requiresSequentialContractReveal || selectedGroupSlots.includes(nextSequentialContractSlot)
  const selectedBatchDrawCount = Math.min(Math.max(1, batchRevealCount), Math.max(1, selectedRemainingSlotCount))
  const selectedDrawCount = effectiveDrawMode === 'batch' ? selectedBatchDrawCount : Math.min(1, selectedRemainingSlotCount)
  const selectedGroupResults = visibleResults.filter((result) => result.prizeGroupId === activePrizeGroupId)
  const selectedExistingRevealResults = effectiveDrawMode === 'batch' ? selectedGroupResults : selectedGroupResults.slice(-1)
  const canRevealExistingSelection = !isLiveRunMode && selectedRemainingSlots.length === 0 && selectedExistingRevealResults.length > 0
  const selectedRunCount = canRevealExistingSelection ? selectedExistingRevealResults.length : selectedDrawCount
  const storedSelectedReveal = selectedGroupResults[selectedGroupResults.length - 1] ?? visibleResults[visibleResults.length - 1] ?? null
  const activeBatchReveal = currentBatchReveal.length > 1 ? currentBatchReveal : []
  const isBatchReveal = activeBatchReveal.length > 1
  const activeCurrentReveal = currentReveal
  const activeReveal = isBatchReveal ? null : activeCurrentReveal ?? storedSelectedReveal
  const winnerTicket = activeReveal?.ticket ?? null
  const rawTicketNumber = winnerTicket ?? ''
  const ticketNumber = winnerTicket ? formatDrawTicketNumber(winnerTicket, totalTickets) : ''
  const ticketAriaLabel = winnerTicket ? `#${ticketNumber}` : copy.drawReveal.readyState
  const ticketDigits = [...ticketNumber]
  const hasTicketNumber = winnerTicket !== null
  const revealedDigitCount = digitRevealState.ticketNumber === ticketNumber ? digitRevealState.count : activeCurrentReveal ? 0 : ticketDigits.length
  const isRevealComplete = !hasTicketNumber || revealedDigitCount >= ticketDigits.length
  const canAdvanceRevealDigits = phase === 'reveal' && !isBatchReveal && hasTicketNumber && !isRevealComplete
  const isAllComplete = visibleResults.length >= TOTAL_PRIZE_DRAW_SLOTS
  const candidateSnapshot = isBatchReveal
    ? null
    : buildWinnerCandidateSnapshot({
        winnerTicket: rawTicketNumber ? BigInt(rawTicketNumber) : null,
        revealedDigitCount,
        ledger,
        identities: walletIdentities,
      })
  const visibleCandidates = candidateSnapshot?.visibleCandidates ?? []
  const leadCandidate = visibleCandidates[0] ?? null
  const otherCandidates = visibleCandidates.slice(1)
  const maxCandidateTickets = leadCandidate?.matchingTickets ?? 1
  const batchRevealLabel = isBatchReveal ? `${prizeLabels[activeBatchReveal[0].prizeGroupId]} x ${activeBatchReveal.length}` : ''
  const batchGridClassName =
    activeBatchReveal.length <= 4 ? 'is-small-batch' : activeBatchReveal.length <= 6 ? 'is-medium-batch' : 'is-large-batch'
  const activeDisplaySource = activeBatchReveal[0]?.source ?? resultSource
  const statusLabel = isBatchReveal
    ? batchRevealLabel
    : activeReveal
    ? `${prizeLabels[activeReveal.prizeGroupId]} #${activeReveal.prizeOrdinal}`
    : resultSource === 'demo'
      ? copy.drawReveal.demoLabel
      : resultSource === 'contract'
        ? copy.drawReveal.winningLabel
        : copy.drawReveal.readyState
  const statusCopy = activeDisplaySource === 'demo' ? copy.drawReveal.demoNotice : activeDisplaySource === 'contract' ? copy.drawReveal.verified : copy.drawReveal.readyCopy
  const shouldConnectBeforeRun = isLiveRunMode && !hasWallet
  const isWaitingForContractRandomness = Boolean(isLiveRunMode && drawStatus?.requested && drawStatus.state < 3 && !drawStatus.fulfilled)
  const isIntroVideoBlocked = !videoReady || videoLoadError
  const introVideoMessage = videoLoadError ? copy.drawReveal.videoUnavailable : copy.drawReveal.videoLoading
  const vrfSubscription = drawStatus?.vrfSubscription ?? null
  const hasVrfFundingIssue = hasInsufficientVrfFunding(vrfSubscription)
  const vrfFundingWarning = hasVrfFundingIssue ? copy.walletPanel.vrfFundingMissing : ''
  const vrfConfigWarning = isLiveRunMode ? drawStatus?.vrfSubscriptionError || '' : ''
  const canUseRandomPrizeSlot = Boolean(
    isLiveRunMode &&
      hasWallet &&
      !vrfConfigWarning &&
      drawStatus?.supportsSelectablePrizeSlots &&
      drawStatus.finalized &&
      drawStatus.requested &&
      drawStatus.state >= 3 &&
      !drawStatus.fulfilled &&
      !isAllComplete &&
      !isContractLedgerMismatch,
  )
  const livePrimaryActionIsSetup = Boolean(
    isLiveRunMode &&
      hasWallet &&
      (!drawStatus || !drawStatus.finalized || !drawStatus.requested || (drawStatus.requested && drawStatus.state < 3)),
  )
  const primaryRunWouldRevealTicket = Boolean(
    !shouldConnectBeforeRun &&
      (canRevealExistingSelection ||
        (!isLiveRunMode && selectedRemainingSlots.length > 0) ||
        (isLiveRunMode &&
          drawStatus?.finalized &&
          drawStatus.requested &&
          drawStatus.state >= 3 &&
          !drawStatus.fulfilled &&
          !isAllComplete &&
          !isContractLedgerMismatch &&
          selectedRemainingSlots.length > 0)),
  )
  const isRunDisabled =
    isSequenceRunning ||
    isContractBusy ||
    isWaitingForContractRandomness ||
    (primaryRunWouldRevealTicket && isIntroVideoBlocked) ||
    Boolean(vrfConfigWarning) ||
    Boolean(isLiveRunMode && hasVrfFundingIssue && drawStatus?.finalized && !drawStatus.requested) ||
    (isLiveRunMode && isAllComplete) ||
    (isLiveRunMode && isContractLedgerMismatch) ||
    (!livePrimaryActionIsSetup && !shouldConnectBeforeRun && !canRevealExistingSelection && selectedRemainingSlots.length === 0)
  const livePrimaryRunLabel = !drawStatus
    ? copy.walletPanel.read
    : !drawStatus.finalized
      ? copy.walletPanel.finalizeLedger
      : !drawStatus.requested
        ? copy.drawReveal.requestRound
        : drawStatus.state < 3
          ? copy.drawReveal.waitingForRandomnessAction
          : drawStatus.fulfilled || isAllComplete
            ? copy.drawReveal.allWinnersRevealed
            : copy.drawReveal.startContractDraw
  const liveContractStatus = !drawStatus
    ? copy.common.pending
    : !drawStatus.finalized
      ? copy.drawReveal.lockLedgerFirst
      : !drawStatus.requested
        ? copy.drawReveal.vrfNotRequested
        : drawStatus.state < 3
          ? copy.drawReveal.waitingForVrfShort
          : drawStatus.fulfilled
            ? copy.walletPanel.fulfilled
            : copy.walletPanel.randomnessReady
  const primaryRunLabel = shouldConnectBeforeRun
    ? copy.common.connectWallet
    : isLiveRunMode
      ? livePrimaryRunLabel
      : copy.drawReveal.startShowcaseDraw
  const explorerBaseUrl = network.blockExplorerUrls[0]?.replace(/\/$/, '') ?? ''
  const latestTransactionRecords = transactionRecords.slice(0, 4)
  const vrfWaitStartedAt = vrfTiming?.requestConfirmedAt ?? vrfTiming?.pendingObservedAt
  const vrfWaitEndAt = vrfTiming?.randomnessReadyAt ?? clockNow
  const vrfWaitDuration = vrfWaitStartedAt
    ? formatDurationMs(vrfWaitEndAt ? vrfWaitEndAt - vrfWaitStartedAt : undefined)
    : '-'
  const vrfBalanceLabel = formatVrfPaymentBalance(vrfSubscription)
  const vrfSubscriptionMeta = vrfSubscription
    ? `${copy.walletPanel.vrfPendingRequest}: ${
        vrfSubscription.pendingRequestExists ? copy.walletPanel.requested : copy.walletPanel.ready
      }`
    : drawStatus?.vrfSubscriptionError
      ? copy.walletPanel.vrfSubscriptionReadFailed
      : '-'
  const resetOrTransactionMessage = operatorMessage || sequenceMessage

  function transactionKindLabel(record: DrawTransactionRecord) {
    if (record.kind === 'reset') return copy.walletPanel.resetRound
    if (record.kind === 'finalize') return copy.walletPanel.finalizeLedger
    if (record.kind === 'request') return copy.drawReveal.requestRound
    return copy.walletPanel.drawNext
  }

  function transactionStatusLabel(record: DrawTransactionRecord) {
    if (record.status === 'awaiting-signature') return copy.walletPanel.txAwaitingSignature
    if (record.status === 'pending') return copy.walletPanel.txPending
    if (record.status === 'confirmed') return copy.walletPanel.txConfirmed
    return copy.walletPanel.txFailed
  }

  function candidateStrengthStyle(matchingTickets: number): CSSProperties {
    const strength = Math.max(8, Math.round((matchingTickets / maxCandidateTickets) * 100))
    return { '--candidate-strength': `${strength}%` } as CSSProperties
  }

  function prizeGroupProgress(groupId: PrizeGroupId) {
    const slots = slotIndexesForPrizeGroup(groupId)
    return slots.filter((slotIndex) => drawnSlots.has(slotIndex)).length
  }

  function ownerName(result: DrawWinnerResult) {
    return result.owner?.displayName ?? copy.drawReveal.unknownWinner
  }

  function ownerAddress(result: DrawWinnerResult) {
    return result.owner?.address ?? copy.drawReveal.noWalletName
  }

  const centerRevealStage = useCallback(() => {
    function alignToSafeCenter(behavior: ScrollBehavior) {
      const stage = rootRef.current?.querySelector('.draw-reveal-stage')
      if (!stage) return
      const rect = stage.getBoundingClientRect()
      const navBottom = document.querySelector('.nav')?.getBoundingClientRect().bottom ?? 0
      const safeTop = Math.max(0, navBottom + 12)
      const targetY = safeTop + (window.innerHeight - safeTop) / 2
      const top = window.scrollY + rect.top + rect.height / 2 - targetY
      window.scrollTo({ top: Math.max(0, top), behavior })
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        alignToSafeCenter('smooth')
        window.setTimeout(() => alignToSafeCenter('auto'), 420)
      })
    })
  }, [])

  const cancelVideoPlaybackWait = useCallback(() => {
    videoPlaybackCancelRef.current?.()
    videoPlaybackCancelRef.current = null
  }, [])

  async function playVideoClip() {
    const video = videoRef.current
    if (!video || isIntroVideoBlocked) {
      setSequenceMessage(introVideoMessage)
      return false
    }

    cancelVideoPlaybackWait()
    setPhase('video')
    centerRevealStage()

    const playbackVideo = video
    playbackVideo.pause()
    playbackVideo.muted = false
    playbackVideo.volume = 1
    playbackVideo.currentTime = 0

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false

        function cleanupListeners() {
          playbackVideo.removeEventListener('ended', handleEnded)
          playbackVideo.removeEventListener('error', handleError)
          if (videoPlaybackCancelRef.current === cancelPlayback) {
            videoPlaybackCancelRef.current = null
          }
        }

        function settle(callback: () => void) {
          if (settled) return
          settled = true
          cleanupListeners()
          callback()
        }

        function handleEnded() {
          settle(resolve)
        }

        function handleError() {
          settle(() => reject(new Error('draw animation failed')))
        }

        function cancelPlayback() {
          settle(() => reject(new Error('draw animation cancelled')))
        }

        videoPlaybackCancelRef.current = cancelPlayback
        playbackVideo.addEventListener('ended', handleEnded, { once: true })
        playbackVideo.addEventListener('error', handleError, { once: true })
        void playbackVideo.play().catch((error: unknown) => {
          settle(() => reject(error instanceof Error ? error : new Error('draw animation failed')))
        })
      })
      videoPlaybackCancelRef.current = null
      return true
    } catch (error) {
      videoPlaybackCancelRef.current = null
      if (error instanceof Error && error.message === 'draw animation cancelled') return false
      if (isMediaPlaybackBlocked(error)) {
        setSequenceMessage(copy.drawReveal.videoPlaybackBlocked)
      } else {
        setVideoLoadError(true)
        setVideoReady(false)
        setSequenceMessage(copy.drawReveal.videoUnavailable)
      }
      setPhase(hasTicketNumber ? 'reveal' : 'idle')
      return false
    }
  }

  function updateVideoReadiness(video: HTMLVideoElement) {
    if (video.error) {
      setVideoLoadError(true)
      setVideoReady(false)
      return
    }

    if (video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
      setVideoLoadError(false)
      setVideoReady(true)
    }
  }

  function markVideoLoadError() {
    cancelVideoPlaybackWait()
    setVideoLoadError(true)
    setVideoReady(false)
    setSequenceMessage(copy.drawReveal.videoUnavailable)
    setPhase(hasTicketNumber ? 'reveal' : 'idle')
  }

  function guardIntroVideoReady() {
    if (!isIntroVideoBlocked) return true
    setSequenceMessage(introVideoMessage)
    return false
  }

  function primeRevealResult(result: DrawWinnerResult) {
    const number = formatDrawTicketNumber(result.ticket, totalTickets)
    previousRevealedDigitCountRef.current = 0
    setCurrentBatchReveal([])
    setCurrentReveal(result)
    setDigitRevealState({ ticketNumber: number, count: 0 })
  }

  async function revealTicketDigits(result: DrawWinnerResult) {
    primeRevealResult(result)
    setPhase('reveal')
    centerRevealStage()
  }

  function primeBatchRevealResults(results: DrawWinnerResult[]) {
    previousRevealedDigitCountRef.current = 0
    setCurrentReveal(null)
    setCurrentBatchReveal(results)
    setDigitRevealState({ ticketNumber: '', count: 0 })
    setPhase('reveal')
    centerRevealStage()
  }

  function appendRevealedResults(results: DrawWinnerResult[]) {
    const demoReveals = results.filter((result) => result.source === 'demo')
    const contractReveals = results.filter((result) => result.source === 'contract')

    if (demoReveals.length > 0) {
      setDemoResults((current) => {
        const nextResults = [...current]
        for (const result of demoReveals) {
          if (!nextResults.some((item) => item.slotIndex === result.slotIndex)) {
            nextResults.push(result)
          }
        }
        return nextResults.sort((a, b) => a.slotIndex - b.slotIndex)
      })
    }

    if (contractReveals.length > 0) {
      setRevealedContractResults((current) => {
        const nextResults = [...current]
        for (const result of contractReveals) {
          if (!nextResults.some((item) => item.slotIndex === result.slotIndex)) {
            nextResults.push(result)
          }
        }
        return nextResults
      })
    }
  }

  async function revealResults(results: DrawWinnerResult[], playIntro = true) {
    if (results.length === 0) return false

    if (playIntro) {
      const didPlayVideo = await playVideoClip()
      if (!didPlayVideo) return false
    }

    if (results.length > 1) {
      primeBatchRevealResults(results)
      appendRevealedResults(results)
      return true
    }

    await revealTicketDigits(results[0])
    appendRevealedResults(results)
    await wait(760)
    return true
  }

  function targetDemoResults() {
    const targetSlots = selectedRemainingSlots.slice(0, selectedDrawCount)
    return targetSlots.map((slotIndex) =>
      buildWinnerResult({
        identities: walletIdentities,
        ledger,
        slotIndex,
        source: 'demo',
        ticket: DEMO_WINNER_TICKETS_BY_SLOT[slotIndex],
      }),
    )
  }

  async function runSelectedDraw() {
    if (sequenceLockRef.current || isSequenceRunning || isContractBusy) return
    setSequenceMessage('')

    if (isLiveRunMode && !hasWallet) {
      setSequenceMessage(copy.drawReveal.contractModeNeedsWallet)
      onConnectWallet()
      return
    }

    if (isLiveRunMode && isContractLedgerMismatch) {
      setSequenceMessage(copy.walletPanel.contractTotalMismatch)
      return
    }

    if (isLiveRunMode && (!drawStatus || !drawStatus.finalized || !drawStatus.requested || drawStatus.state < 3)) {
      sequenceLockRef.current = true
      setIsSequenceRunning(true)
      try {
        if (!drawStatus) {
          setSequenceMessage(copy.walletPanel.read)
          await onRefreshStatus()
          return
        }

        if (!drawStatus.finalized) {
          setSequenceMessage(copy.drawReveal.lockLedgerFirst)
          await onFinalizeLedger()
          return
        }

        if (!drawStatus.requested) {
          setSequenceMessage(copy.drawReveal.requestVrfFirst)
          await onRequestDraw()
          return
        }

        setSequenceMessage(copy.drawReveal.waitingForVrf)
        return
      } finally {
        sequenceLockRef.current = false
        setIsSequenceRunning(false)
      }
    }

    if (primaryRunWouldRevealTicket && !guardIntroVideoReady()) {
      return
    }

    if (selectedRemainingSlots.length === 0) {
      if (isLiveRunMode && nextIncompletePrizeGroup) {
        setSelectedPrizeGroupId(nextIncompletePrizeGroup.id)
        setBatchRevealCount(nextIncompletePrizeGroup.slotCount > 1 ? nextIncompletePrizeGroup.slotCount : 1)
        setSequenceMessage(
          requiresSequentialContractReveal
            ? `${copy.drawReveal.contractOrderNotice} ${copy.drawReveal.slotLabel} #${nextSequentialContractSlot + 1}`
            : copy.drawReveal.groupComplete,
        )
        return
      }

      if (canRevealExistingSelection) {
        sequenceLockRef.current = true
        setIsSequenceRunning(true)
        try {
          await revealResults(selectedExistingRevealResults)
        } finally {
          sequenceLockRef.current = false
          setIsSequenceRunning(false)
        }
        return
      }
      setSequenceMessage(copy.drawReveal.groupComplete)
      return
    }

    sequenceLockRef.current = true
    if (isLiveRunMode) {
      setRevealedContractResults(contractResults)
      setCurrentReveal(null)
      setCurrentBatchReveal([])
      setDigitRevealState({ ticketNumber: '', count: 0 })
    }
    setIsSequenceRunning(true)
    try {
      if (isLiveRunMode) {
        if (!hasWallet) {
          setSequenceMessage(copy.drawReveal.contractModeNeedsWallet)
          return
        }

        if (!drawStatus) {
          setSequenceMessage(copy.walletPanel.read)
          await onRefreshStatus()
          return
        }

        if (!drawStatus.finalized) {
          setSequenceMessage(copy.drawReveal.lockLedgerFirst)
          await onFinalizeLedger()
          return
        }

        if (!drawStatus.requested) {
          setSequenceMessage(copy.drawReveal.requestVrfFirst)
          await onRequestDraw()
          return
        }

        if (drawStatus.state < 3) {
          setSequenceMessage(copy.drawReveal.waitingForVrf)
          return
        }

        if (requiresSequentialContractReveal && !isSelectedGroupNextToReveal) {
          setSequenceMessage(`${copy.drawReveal.contractOrderNotice} ${copy.drawReveal.slotLabel} #${nextSequentialContractSlot + 1}`)
          return
        }

        const selectedTargetSlots = selectedRemainingSlots.slice(0, selectedDrawCount)
        const existingContractReveals = selectedTargetSlots
          .map((slotIndex) => contractResults.find((result) => result.slotIndex === slotIndex) ?? null)
          .filter((result): result is DrawWinnerResult => Boolean(result))

        if (existingContractReveals.length === selectedTargetSlots.length) {
          await revealResults(existingContractReveals)
          return
        }

        if (
          requiresSequentialContractReveal &&
          !selectedTargetSlots.every((slotIndex, index) => slotIndex === nextSequentialContractSlot + index)
        ) {
          setSequenceMessage(`${copy.drawReveal.contractOrderNotice} ${copy.drawReveal.slotLabel} #${nextSequentialContractSlot + 1}`)
          return
        }

        const revealResultsFromContract = await onDrawContractPrizeSlots(selectedTargetSlots)
        const contractReveals = revealResultsFromContract.map(({ prizeSlotIndex, ticket }) =>
          buildWinnerResult({
            identities: walletIdentities,
            ledger,
            slotIndex: prizeSlotIndex,
            source: 'contract',
            ticket,
          }),
        )
        if (contractReveals.length === 0) {
          setSequenceMessage(copy.drawReveal.noContractTickets)
          return
        }
        await revealResults(contractReveals)
        return
      }

      await revealResults(targetDemoResults())
    } finally {
      sequenceLockRef.current = false
      setIsSequenceRunning(false)
    }
  }

  async function runRandomPrizeSlotDraw() {
    if (!isLiveRunMode || sequenceLockRef.current || isSequenceRunning || isContractBusy) return
    setSequenceMessage('')

    if (!hasWallet) {
      setSequenceMessage(copy.drawReveal.contractModeNeedsWallet)
      onConnectWallet()
      return
    }

    if (isContractLedgerMismatch) {
      setSequenceMessage(copy.walletPanel.contractTotalMismatch)
      return
    }

    if (!drawStatus?.finalized) {
      setSequenceMessage(copy.drawReveal.lockLedgerFirst)
      return
    }

    if (!drawStatus.requested) {
      setSequenceMessage(copy.drawReveal.requestVrfFirst)
      await onRequestDraw()
      return
    }

    if (drawStatus.state < 3) {
      setSequenceMessage(copy.drawReveal.waitingForVrf)
      return
    }

    if (!drawStatus.supportsSelectablePrizeSlots) {
      setSequenceMessage(copy.drawReveal.selectableOrderUnavailable)
      return
    }

    if (isAllComplete) {
      setSequenceMessage(copy.drawReveal.allWinnersRevealed)
      return
    }

    if (!guardIntroVideoReady()) {
      return
    }

    sequenceLockRef.current = true
    setRevealedContractResults(contractResults)
    setCurrentReveal(null)
    setCurrentBatchReveal([])
    setDigitRevealState({ ticketNumber: '', count: 0 })
    setIsSequenceRunning(true)
    try {
      const revealResultsFromContract = await onDrawRandomContractPrizeSlot()
      const contractReveals = revealResultsFromContract.map(({ prizeSlotIndex, ticket }) =>
        buildWinnerResult({
          identities: walletIdentities,
          ledger,
          slotIndex: prizeSlotIndex,
          source: 'contract',
          ticket,
        }),
      )
      if (contractReveals.length === 0) {
        setSequenceMessage(copy.drawReveal.noContractTickets)
        return
      }
      setSelectedPrizeGroupId(contractReveals[0].prizeGroupId)
      await revealResults(contractReveals)
    } finally {
      sequenceLockRef.current = false
      setIsSequenceRunning(false)
    }
  }

  function queueSelectedDraw() {
    if (shouldConnectBeforeRun) {
      setSequenceMessage(copy.drawReveal.contractModeNeedsWallet)
      onConnectWallet()
      return
    }

    if (primaryRunWouldRevealTicket && !guardIntroVideoReady()) {
      return
    }

    void runSelectedDraw()
  }

  function replay() {
    if (!hasTicketNumber) return
    if (!guardIntroVideoReady()) return
    previousRevealedDigitCountRef.current = 0
    setDigitRevealState({ ticketNumber, count: 0 })
    void playVideoClip()
  }

  function resetDemo() {
    if (isLiveRunMode) return
    cancelVideoPlaybackWait()
    setDemoResults([])
    setCurrentReveal(null)
    setCurrentBatchReveal([])
    setDigitRevealState({ ticketNumber: '', count: 0 })
    setSequenceMessage('')
    setPhase('idle')
  }

  async function resetLiveRound() {
    if (!isLiveRunMode || !hasWallet || !drawStatus || isSequenceRunning || isContractBusy) return
    setSequenceMessage('')
    if (drawStatus.state === 2) {
      setSequenceMessage(copy.walletPanel.resetBlockedDuringRequest)
      return
    }
    if (!canResetRound) {
      setSequenceMessage(copy.walletPanel.ownerOnlyAction)
      return
    }

    cancelVideoPlaybackWait()
    sequenceLockRef.current = true
    setIsSequenceRunning(true)
    try {
      setSequenceMessage(copy.walletPanel.txAwaitingSignature)
      const didReset = await onResetRound()
      if (!didReset) return
      setRevealedContractResults([])
      setCurrentReveal(null)
      setCurrentBatchReveal([])
      setDigitRevealState({ ticketNumber: '', count: 0 })
      setPhase('idle')
      setSelectedPrizeGroupId('grand')
      setBatchRevealCount(1)
    } finally {
      sequenceLockRef.current = false
      setIsSequenceRunning(false)
    }
  }

  useEffect(() => {
    if (!hasWallet || sequenceMessage !== copy.drawReveal.contractModeNeedsWallet) return undefined

    const timeoutId = window.setTimeout(() => {
      setSequenceMessage('')
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [copy.drawReveal.contractModeNeedsWallet, hasWallet, sequenceMessage])

  useEffect(() => {
    if (!isLiveRunMode || !drawStatus || drawStatus.finalized || drawStatus.winnerCount > 0n) return undefined

    const timeoutId = window.setTimeout(() => {
      cancelVideoPlaybackWait()
      setRevealedContractResults([])
      setCurrentReveal(null)
      setCurrentBatchReveal([])
      setDigitRevealState({ ticketNumber: '', count: 0 })
      setSelectedPrizeGroupId('grand')
      setBatchRevealCount(1)
      setPhase('idle')
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [cancelVideoPlaybackWait, drawStatus, isLiveRunMode])

  function selectRunMode(nextRunMode: DrawRunMode) {
    if (nextRunMode === runMode) return
    cancelVideoPlaybackWait()
    setCurrentReveal(null)
    setCurrentBatchReveal([])
    setDigitRevealState({ ticketNumber: '', count: 0 })
    setSequenceMessage('')
    setRevealedContractResults([])
    onRunModeChange(nextRunMode)
    const nextResults = isDrawNetworkKey(nextRunMode) ? [] : demoResults
    setPhase(nextResults.length > 0 ? 'reveal' : 'idle')
  }

  useEffect(() => cancelVideoPlaybackWait, [cancelVideoPlaybackWait])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (video.error) {
      setVideoLoadError(true)
      setVideoReady(false)
      return
    }
    if (video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
      setVideoLoadError(false)
      setVideoReady(true)
    }
  }, [])

  useEffect(() => {
    const hasActiveTransaction = transactionRecords.some((record) => record.status === 'awaiting-signature' || record.status === 'pending')
    if (!isWaitingForContractRandomness && !hasActiveTransaction) return undefined
    const intervalId = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [isWaitingForContractRandomness, transactionRecords])

  useEffect(() => {
    const root = rootRef.current
    if (!root || phase !== 'video') return

    const result = root.querySelector('.draw-reveal-result')
    const ticket = root.querySelector('.draw-reveal-ticket')
    const batchTickets = root.querySelectorAll('.draw-reveal-batch-ticket')
    const shine = root.querySelector('.draw-reveal-shine')
    const batchShines = root.querySelectorAll('.draw-reveal-batch-shine')
    const burst = root.querySelector('.draw-reveal-number-burst')
    const digits = root.querySelectorAll('.draw-reveal-digit')
    const meta = root.querySelectorAll('.draw-reveal-meta > *')

    if (result) gsap.set(result, { autoAlpha: 0, clearProps: 'transform' })
    if (ticket) gsap.set(ticket, { clearProps: 'all' })
    if (batchTickets.length) gsap.set(batchTickets, { clearProps: 'all' })
    if (shine) gsap.set(shine, { xPercent: -115, autoAlpha: 0 })
    if (batchShines.length) gsap.set(batchShines, { xPercent: -115, autoAlpha: 0 })
    if (burst) gsap.set(burst, { autoAlpha: 0, scale: 0.52 })
    if (digits.length) gsap.set(digits, { autoAlpha: 0, y: 48, scale: 2.35, rotationX: -68, filter: 'blur(12px)' })
    if (meta.length) gsap.set(meta, { autoAlpha: 0, y: 12 })
  }, [phase])

  useEffect(() => {
    const root = rootRef.current
    if (!root || phase !== 'reveal') return undefined

    const mm = gsap.matchMedia()
    mm.add(
      {
        all: '(min-width: 0px)',
        reduceMotion: '(prefers-reduced-motion: reduce)',
      },
      (context) => {
        const reduceMotion = Boolean(context.conditions?.reduceMotion)
        const duration = reduceMotion ? 0 : 0.82
        const revealStage = root.querySelector('.draw-reveal-result')
        const ticket = root.querySelector('.draw-reveal-ticket')
        const batchTickets = root.querySelectorAll('.draw-reveal-batch-ticket')
        const batchNumbers = root.querySelectorAll('.draw-reveal-batch-number')
        const batchShines = root.querySelectorAll('.draw-reveal-batch-shine')
        const shine = root.querySelector('.draw-reveal-shine')
        const label = root.querySelector('.draw-reveal-number-wrap > span')
        const burst = root.querySelector('.draw-reveal-number-burst')
        const number = root.querySelector('.draw-reveal-number-wrap strong')
        const digits = root.querySelectorAll('.draw-reveal-digit')
        const meta = root.querySelectorAll('.draw-reveal-meta > *')

        if (!revealStage) return undefined

        const timeline = gsap.timeline({ defaults: { ease: 'power3.out', overwrite: 'auto' } })

        if (isBatchReveal && batchTickets.length) {
          timeline
            .fromTo(revealStage, { autoAlpha: 0 }, { autoAlpha: 1, duration: duration * 0.45 })
            .fromTo(
              batchTickets,
              {
                autoAlpha: 0,
                y: reduceMotion ? 0 : 42,
                scale: reduceMotion ? 1 : 0.88,
                rotationX: reduceMotion ? 0 : -8,
                filter: reduceMotion ? 'blur(0px)' : 'blur(8px)',
              },
              {
                autoAlpha: 1,
                y: 0,
                scale: 1,
                rotationX: 0,
                filter: 'blur(0px)',
                duration,
                stagger: reduceMotion ? 0 : 0.045,
              },
              reduceMotion ? 0 : 0.08,
            )

          if (batchNumbers.length) {
            timeline.fromTo(
              batchNumbers,
              { autoAlpha: 0, y: reduceMotion ? 0 : 12, scale: reduceMotion ? 1 : 0.94 },
              { autoAlpha: 1, y: 0, scale: 1, duration: reduceMotion ? 0 : 0.32, stagger: reduceMotion ? 0 : 0.035 },
              reduceMotion ? 0 : 0.34,
            )
          }

          if (batchShines.length) {
            timeline.fromTo(
              batchShines,
              { xPercent: -115, autoAlpha: 0 },
              { xPercent: 115, autoAlpha: 0.64, duration: reduceMotion ? 0 : 1.05, stagger: reduceMotion ? 0 : 0.025, ease: 'power2.inOut' },
              reduceMotion ? 0 : 0.42,
            )
          }

          if (meta.length) {
            timeline.fromTo(
              meta,
              { autoAlpha: 0, y: 12 },
              { autoAlpha: 1, y: 0, duration: reduceMotion ? 0 : 0.36, stagger: reduceMotion ? 0 : 0.06 },
              reduceMotion ? 0 : 0.72,
            )
          }

          return () => timeline.kill()
        }

        if (!ticket) return undefined

        if (digits.length) {
          timeline
            .set(digits, {
              autoAlpha: 0,
              y: reduceMotion ? 0 : 48,
              scale: reduceMotion ? 1 : 2.35,
              rotationX: reduceMotion ? 0 : -68,
              filter: reduceMotion ? 'blur(0px)' : 'blur(12px)',
            })
            .set(digits, hasTicketNumber ? { autoAlpha: 0 } : { autoAlpha: 1, y: 0, scale: 1, rotationX: 0, filter: 'blur(0px)' })
        }

        timeline
          .fromTo(revealStage, { autoAlpha: 0 }, { autoAlpha: 1, duration: duration * 0.45 })
          .fromTo(
            ticket,
            { autoAlpha: 0, y: 72, scale: 0.86, rotationX: -10 },
            { autoAlpha: 1, y: 0, scale: 1, rotationX: 0, duration },
            reduceMotion ? 0 : 0.08,
          )

        if (label) {
          timeline.fromTo(
            label,
            { autoAlpha: 0, y: 12, scale: 0.96 },
            { autoAlpha: 1, y: 0, scale: 1, duration: reduceMotion ? 0 : 0.28 },
            reduceMotion ? 0 : 0.48,
          )
        }

        if (number) {
          timeline.fromTo(
            number,
            { autoAlpha: 0, scale: 0.96 },
            { autoAlpha: 1, scale: 1, duration: reduceMotion ? 0 : 0.28 },
            reduceMotion ? 0 : 0.56,
          )
        }

        if (burst) {
          timeline
            .fromTo(
              burst,
              { autoAlpha: 0, scale: 0.52 },
              { autoAlpha: 0.96, scale: 1.14, duration: reduceMotion ? 0 : 0.34, ease: 'power2.out' },
              reduceMotion ? 0 : 0.58,
            )
            .to(burst, { autoAlpha: 0.26, scale: reduceMotion ? 1 : 1.2, duration: reduceMotion ? 0 : 0.5, ease: 'power2.out' }, reduceMotion ? 0 : 0.9)
        }

        if (shine) {
          timeline.fromTo(
            shine,
            { xPercent: -115, autoAlpha: 0 },
            { xPercent: 115, autoAlpha: 0.74, duration: reduceMotion ? 0 : 1.08, ease: 'power2.inOut' },
            reduceMotion ? 0 : 0.56,
          )
        }

        if (meta.length) {
          timeline.fromTo(
            meta,
            { autoAlpha: 0, y: 12 },
            { autoAlpha: 1, y: 0, duration: reduceMotion ? 0 : 0.36, stagger: reduceMotion ? 0 : 0.06 },
            reduceMotion ? 0 : 0.98,
          )
        }

        return () => timeline.kill()
      },
      root,
    )

    return () => mm.revert()
  }, [activeBatchReveal.length, hasTicketNumber, isBatchReveal, phase, ticketNumber])

  useEffect(() => {
    const root = rootRef.current
    if (!root || phase !== 'reveal' || !hasTicketNumber) return

    const previousCount = previousRevealedDigitCountRef.current
    previousRevealedDigitCountRef.current = revealedDigitCount

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const burst = root.querySelector('.draw-reveal-number-burst')
    const number = root.querySelector('.draw-reveal-number-wrap strong')
    const digits = Array.from(root.querySelectorAll('.draw-reveal-digit'))
    const timeline = gsap.timeline({ defaults: { overwrite: 'auto' } })
    const animationStart = previousCount < revealedDigitCount ? previousCount : Math.max(0, revealedDigitCount - 1)
    const stableDigits = digits.slice(0, animationStart)
    const animatedDigits = digits.slice(animationStart, revealedDigitCount)
    const hiddenDigits = digits.slice(revealedDigitCount)

    if (stableDigits.length) gsap.set(stableDigits, { autoAlpha: 1, y: 0, scale: 1, rotationX: 0, filter: 'blur(0px)' })
    if (hiddenDigits.length) gsap.set(hiddenDigits, { autoAlpha: 0, y: 48, scale: 2.35, rotationX: -68, filter: 'blur(12px)' })

    if (revealedDigitCount <= 0) return

    for (const digit of animatedDigits) {
      timeline.fromTo(
        digit,
        { autoAlpha: 0, y: reduceMotion ? 0 : 60, scale: reduceMotion ? 1 : 2.45, rotationX: reduceMotion ? 0 : -72, filter: reduceMotion ? 'blur(0px)' : 'blur(14px)' },
        { autoAlpha: 1, y: 0, scale: 1, rotationX: 0, filter: 'blur(0px)', duration: reduceMotion ? 0 : 0.62, ease: 'back.out(1.62)' },
      )
    }

    if (burst) {
      timeline
        .fromTo(burst, { autoAlpha: 0.18, scale: 0.82 }, { autoAlpha: 0.92, scale: 1.12, duration: reduceMotion ? 0 : 0.16, ease: 'power2.out' }, 0)
        .to(burst, { autoAlpha: isRevealComplete ? 0.36 : 0.22, scale: isRevealComplete ? 1.3 : 1.06, duration: reduceMotion ? 0 : 0.32, ease: 'power2.out' })
    }

    if (number) {
      timeline.to(number, { scale: reduceMotion ? 1 : isRevealComplete ? 1.06 : 1.025, duration: reduceMotion ? 0 : 0.12, yoyo: true, repeat: 1, ease: 'power2.out' }, 0)
    }

    return () => {
      timeline.kill()
    }
  }, [hasTicketNumber, isRevealComplete, phase, revealedDigitCount])
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const cards = root.querySelectorAll('.draw-winner-card')
    if (!cards.length) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    gsap.fromTo(
      cards,
      { autoAlpha: reduceMotion ? 1 : 0, y: reduceMotion ? 0 : 22, scale: reduceMotion ? 1 : 0.96 },
      { autoAlpha: 1, y: 0, scale: 1, duration: reduceMotion ? 0 : 0.48, stagger: reduceMotion ? 0 : 0.035, ease: 'power3.out', overwrite: 'auto' },
    )
  }, [visibleResults.length])

  return (
    <section className="panel draw-reveal-panel" ref={rootRef}>
      <div className="draw-reveal-heading">
        <div className="draw-reveal-title-block">
          <span className="eyebrow">{copy.drawReveal.eyebrow}</span>
          <h2>{copy.drawReveal.title}</h2>
        </div>
        <div className="draw-reveal-mode-shell">
          <div className="draw-reveal-mode-switch" role="tablist" aria-label={copy.drawReveal.runMode}>
            <button className={runMode === 'showcase' ? 'is-active' : ''} type="button" role="tab" aria-selected={runMode === 'showcase'} onClick={() => selectRunMode('showcase')}>
              {copy.drawReveal.showcaseMode}
            </button>
            <button className={runMode === 'testnet' ? 'is-active' : ''} type="button" role="tab" aria-selected={runMode === 'testnet'} onClick={() => selectRunMode('testnet')}>
              {copy.drawReveal.testnetMode}
            </button>
            <button className={runMode === 'mainnet' ? 'is-active' : ''} type="button" role="tab" aria-selected={runMode === 'mainnet'} onClick={() => selectRunMode('mainnet')}>
              {copy.drawReveal.mainnetMode}
            </button>
          </div>
        </div>
        <div className="draw-reveal-actions">
          <button className="icon-button draw-reveal-demo" type="button" onClick={queueSelectedDraw} disabled={isRunDisabled}>
            {isSequenceRunning || isContractBusy ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
            <span>{primaryRunLabel}</span>
          </button>
          {isLiveRunMode && hasWallet && drawStatus && (drawStatus.finalized || drawStatus.winnerCount > 0n) && (
            <button className="icon-button draw-reveal-reset" type="button" onClick={resetLiveRound} disabled={isSequenceRunning || isContractBusy}>
              <RotateCcw size={17} />
              <span>{copy.walletPanel.resetRound}</span>
            </button>
          )}
          <button className="icon-button draw-reveal-replay" type="button" onClick={replay} disabled={!hasTicketNumber || isSequenceRunning || isIntroVideoBlocked}>
            <RotateCcw size={17} />
            <span>{copy.drawReveal.replay}</span>
          </button>
        </div>
      </div>

      {isLiveRunMode && (
        <div className={`draw-network-banner draw-network-banner--${runMode}`}>
          <div>
            <span>{copy.drawReveal.currentNetwork}</span>
            <strong>{network.label}</strong>
            <small>{network.chainName}</small>
          </div>
          <div>
            <span>{copy.walletPanel.contract}</span>
            <strong>{formatAddress(network.contractAddress)}</strong>
            <small>{network.contractAddress}</small>
          </div>
          <div>
            <span>{copy.walletPanel.operator}</span>
            <strong>{walletAddress ? formatAddress(walletAddress) : copy.walletPanel.disconnected}</strong>
            <small>
              {copy.walletPanel.authorizedOperator}: {formatAddress(authorizedOperatorAddress)}
            </small>
          </div>
          <div>
            <span>{copy.walletPanel.vrfTiming}</span>
            <strong>{liveContractStatus}</strong>
            <small>
              {copy.walletPanel.vrfWait}: {vrfWaitDuration}
            </small>
          </div>
          <div className={hasVrfFundingIssue ? 'is-warning' : ''}>
            <span>{copy.walletPanel.vrfBalance}</span>
            <strong>{vrfBalanceLabel}</strong>
            <small>{vrfSubscriptionMeta}</small>
          </div>
        </div>
      )}

      <div className="draw-reveal-console">
        <div className="draw-reveal-control-group draw-reveal-prize-control">
          <span>{copy.drawReveal.selectPrize}</span>
          <div className="draw-reveal-prize-tabs" role="tablist" aria-label={copy.drawReveal.selectPrize}>
            {PRIZE_GROUPS.map((group) => {
              const drawn = prizeGroupProgress(group.id)
              return (
                <button
                  className={activePrizeGroupId === group.id ? 'is-active' : ''}
                  type="button"
                  role="tab"
                  aria-selected={activePrizeGroupId === group.id}
                  key={group.id}
                  onClick={() => {
                    setSelectedPrizeGroupId(group.id)
                    setBatchRevealCount(group.slotCount > 1 ? group.slotCount : 1)
                  }}
                >
                  <strong>{prizeLabels[group.id]}</strong>
                  <small>
                    {drawn}/{group.slotCount}
                  </small>
                </button>
              )
            })}
          </div>
        </div>

        <div className="draw-reveal-control-group draw-reveal-method-control">
          <span>{copy.drawReveal.drawMode}</span>
          <div className="draw-reveal-mode-tabs">
            <button className={effectiveDrawMode === 'single' ? 'is-active' : ''} type="button" onClick={() => setDrawMode('single')}>
              <Sparkles size={15} />
              {copy.drawReveal.singleDraw}
            </button>
            <button className={effectiveDrawMode === 'batch' ? 'is-active' : ''} type="button" onClick={() => setDrawMode('batch')} disabled={!selectedGroupCanBatch}>
              <FastForward size={15} />
              {copy.drawReveal.batchDraw}
            </button>
          </div>
          {effectiveDrawMode === 'batch' && selectedGroupCanBatch && (
            <label className="draw-reveal-batch-count">
              <span>{copy.drawReveal.batchCount}</span>
              <input
                type="number"
                min={1}
                max={Math.max(1, selectedRemainingSlotCount)}
                value={selectedBatchDrawCount}
                onChange={(event) => {
                  const value = Number.parseInt(event.target.value, 10)
                  const maxCount = Math.max(1, selectedRemainingSlotCount)
                  const nextValue = Number.isFinite(value) ? Math.min(Math.max(1, value), maxCount) : 1
                  setBatchRevealCount(nextValue)
                }}
              />
            </label>
          )}
          {!selectedGroupCanBatch && <small className="draw-reveal-control-hint">{copy.drawReveal.grandSingleOnly}</small>}
        </div>

        <div className="draw-reveal-runner">
          <div>
            <strong>{prizeLabels[activePrizeGroupId]}</strong>
            <span>
              {copy.drawReveal.nextDrawCount}: {compactNumber(selectedRunCount)} / {compactNumber(selectedGroup.slotCount)}
            </span>
          </div>
          {isLiveRunMode && (
            <div className="draw-reveal-contract-status">
              <span>{copy.drawReveal.contractStatus}</span>
              <strong>{liveContractStatus}</strong>
              <small>
                {copy.drawReveal.revealedCount}: {compactNumber(drawStatus?.winnerCount ?? revealedPrizeSlotIndexes.length)} / {compactNumber(TOTAL_PRIZE_DRAW_SLOTS)}
              </small>
            </div>
          )}
          {isLiveRunMode && !hasWallet && (
            <button className="draw-reveal-run-secondary" type="button" onClick={onConnectWallet} disabled={isContractBusy || isSequenceRunning}>
              <Crown size={16} />
              {copy.common.connectWallet}
            </button>
          )}
          {isLiveRunMode && hasWallet && drawStatus?.supportsSelectablePrizeSlots && (
            <button className="draw-reveal-run-secondary" type="button" onClick={runRandomPrizeSlotDraw} disabled={!canUseRandomPrizeSlot || isContractBusy || isSequenceRunning || isIntroVideoBlocked}>
              <Shuffle size={16} />
              {copy.drawReveal.randomPrizeSlot}
            </button>
          )}
          {runMode === 'showcase' && (
            <button className="draw-reveal-run-secondary" type="button" onClick={resetDemo} disabled={isSequenceRunning || demoResults.length === 0}>
              {copy.drawReveal.resetShowcase}
            </button>
          )}
        </div>

        {(resetOrTransactionMessage ||
          (primaryRunWouldRevealTicket && isIntroVideoBlocked) ||
          (isLiveRunMode && vrfConfigWarning) ||
          (isLiveRunMode && isContractLedgerMismatch) ||
          (isLiveRunMode && vrfFundingWarning) ||
          (isLiveRunMode && hasWallet && requiresSequentialContractReveal && !isSelectedGroupNextToReveal && selectedRemainingSlots.length > 0) ||
          (isLiveRunMode && hasWallet && drawStatus && !drawStatus.supportsSelectablePrizeSlots)) && (
          <p className="draw-reveal-sequence-message">
            {resetOrTransactionMessage ||
              (primaryRunWouldRevealTicket && isIntroVideoBlocked
                ? introVideoMessage
                : vrfConfigWarning
                ? vrfConfigWarning
                : isContractLedgerMismatch
                ? copy.walletPanel.contractTotalMismatch
                : vrfFundingWarning
                  ? vrfFundingWarning
                  : drawStatus && !drawStatus.supportsSelectablePrizeSlots
                  ? copy.drawReveal.selectableOrderUnavailable
                  : `${copy.drawReveal.contractOrderNotice} ${copy.drawReveal.slotLabel} #${nextSequentialContractSlot + 1}`)}
          </p>
        )}
      </div>

      {isLiveRunMode && (
        <div className="draw-transaction-timeline">
          <div className="draw-transaction-timeline-head">
            <span>{copy.walletPanel.transactionTimeline}</span>
            <strong>{latestTransactionRecords.length ? `${latestTransactionRecords.length} ${copy.walletPanel.sessionTransactions}` : copy.walletPanel.noSessionTransactions}</strong>
          </div>
          {latestTransactionRecords.length > 0 ? (
            <div className="draw-transaction-list">
              {latestTransactionRecords.map((record) => (
                <a
                  className={`draw-transaction-item is-${record.status}`}
                  href={record.hash ? `${explorerBaseUrl}/tx/${record.hash}` : undefined}
                  target="_blank"
                  rel="noreferrer"
                  key={record.id}
                  aria-disabled={!record.hash}
                >
                  <span>{transactionKindLabel(record)}</span>
                  <strong>{record.hash ? `${record.hash.slice(0, 10)}...` : copy.walletPanel.txAwaitingSignature}</strong>
                  <small>
                    {transactionStatusLabel(record)} · {transactionDuration(record, clockNow || record.confirmedAt || record.submittedAt || record.startedAt)}
                    {record.detail ? ` · ${record.detail}` : ''}
                  </small>
                </a>
              ))}
            </div>
          ) : (
            <p>{copy.walletPanel.noSessionTransactions}</p>
          )}
        </div>
      )}

      <div
        className={`draw-reveal-stage draw-reveal-stage--${phase}${isBatchReveal ? ' draw-reveal-stage--batch' : ''}`}
        role={canAdvanceRevealDigits ? 'button' : undefined}
        tabIndex={canAdvanceRevealDigits ? 0 : undefined}
        aria-label={canAdvanceRevealDigits ? copy.drawReveal.clickNext : undefined}
        onClick={() => {
          if (canAdvanceRevealDigits) {
            setDigitRevealState((state) => ({
              ticketNumber,
              count: Math.min(ticketDigits.length, state.ticketNumber === ticketNumber ? state.count + 1 : 1),
            }))
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          if (canAdvanceRevealDigits) {
            setDigitRevealState((state) => ({
              ticketNumber,
              count: Math.min(ticketDigits.length, state.ticketNumber === ticketNumber ? state.count + 1 : 1),
            }))
          }
        }}
      >
        <video
          ref={videoRef}
          className="draw-reveal-video"
          src={DRAW_ANIMATION_SRC}
          playsInline
          preload="auto"
          onLoadedData={(event) => updateVideoReadiness(event.currentTarget)}
          onCanPlay={(event) => updateVideoReadiness(event.currentTarget)}
          onCanPlayThrough={(event) => updateVideoReadiness(event.currentTarget)}
          onError={markVideoLoadError}
        />

        <div className={`draw-reveal-result${isBatchReveal ? ' draw-reveal-result--batch' : ''}`} aria-live="polite">
          {isBatchReveal ? (
            <div className={`draw-reveal-batch-grid ${batchGridClassName}`}>
              {activeBatchReveal.map((result) => (
                <article className="draw-reveal-batch-ticket" key={`${result.source}-${result.slotIndex}-${result.ticket}`}>
                  <img src={goldTicketImage} alt={copy.drawReveal.ticketAlt} decoding="async" />
                  <div className="draw-reveal-batch-shine" aria-hidden="true" />
                  <div className="draw-reveal-batch-number">
                    <span>{`${prizeLabels[result.prizeGroupId]} #${result.prizeOrdinal}`}</span>
                    <strong aria-label={`#${formatDrawTicketNumber(result.ticket, totalTickets)}`}>#{formatDrawTicketNumber(result.ticket, totalTickets)}</strong>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="draw-reveal-ticket">
              <img src={goldTicketImage} alt={copy.drawReveal.ticketAlt} decoding="async" />
              <div className="draw-reveal-shine" aria-hidden="true" />
              <div className="draw-reveal-number-wrap">
                <div className="draw-reveal-number-burst" aria-hidden="true" />
                <span>{statusLabel}</span>
                {hasTicketNumber ? (
                  <strong aria-label={ticketAriaLabel}>
                    {hasTicketNumber && <span className="draw-reveal-prefix">#</span>}
                    {ticketDigits.map((digit, index) => (
                      <span
                        className={`draw-reveal-digit ${index < revealedDigitCount ? 'is-visible' : ''}`}
                        data-digit-index={index}
                        key={`${ticketNumber}-${index}`}
                      >
                        {digit}
                      </span>
                    ))}
                  </strong>
                ) : (
                  <div className="draw-reveal-ready-state" aria-label={ticketAriaLabel}>
                    <strong>{copy.drawReveal.readyTitle}</strong>
                    <small>{copy.drawReveal.readyCopy}</small>
                  </div>
                )}
                {hasTicketNumber && !isRevealComplete && (
                  <small className="draw-reveal-click-cue">{copy.drawReveal.clickNext}</small>
                )}
              </div>
            </div>
          )}

          <div className="draw-reveal-meta">
            <span>
              {copy.drawReveal.totalTickets}: {compactNumber(totalTickets)}
            </span>
            <span>{statusCopy}</span>
          </div>
        </div>
      </div>

      {phase === 'reveal' && hasTicketNumber && !isBatchReveal && (
        <section className={`draw-reveal-candidates ${candidateSnapshot ? 'draw-reveal-candidates--active' : 'draw-reveal-candidates--idle'}`} aria-live="polite">
          <div className="draw-reveal-candidate-head">
            <div>
              <span>{copy.drawReveal.candidateTitle}</span>
              <strong>{candidateSnapshot ? `#${candidateSnapshot.prefix}` : copy.drawReveal.waitingFirstDigit}</strong>
            </div>

            {candidateSnapshot && (
              <div className="draw-reveal-candidate-stats">
                <span>
                  <b>{compactNumber(candidateSnapshot.possibleTicketCount)}</b>
                  {copy.drawReveal.possibleTickets}
                </span>
                <span>
                  <b>{compactNumber(candidateSnapshot.possibleOwnerCount)}</b>
                  {copy.drawReveal.possibleOwners}
                </span>
                <span>
                  <b>
                    {`#${formatDrawTicketNumber(candidateSnapshot.rangeStart, totalTickets)}-#${formatDrawTicketNumber(candidateSnapshot.rangeEnd, totalTickets)}`}
                  </b>
                  {copy.drawReveal.ticketWindow}
                </span>
              </div>
            )}
          </div>

          {candidateSnapshot && leadCandidate ? (
            <div className="draw-reveal-candidate-body">
              <article className="draw-reveal-candidate-lead" style={candidateStrengthStyle(leadCandidate.matchingTickets)}>
                <div className="draw-reveal-candidate-rank">{copy.drawReveal.topCandidate}</div>
                <div className="draw-reveal-candidate-identity">
                  <strong>{leadCandidate.displayName}</strong>
                  <span title={leadCandidate.address}>{leadCandidate.address}</span>
                </div>
                <div className="draw-reveal-candidate-score">
                  <b>{compactNumber(leadCandidate.matchingTickets)}</b>
                  <span>{copy.drawReveal.possibleTickets}</span>
                </div>
                {leadCandidate.sampleTickets.length > 0 && (
                  <div className="draw-reveal-ticket-chips" aria-label={copy.drawReveal.sampleTickets}>
                    {leadCandidate.sampleTickets.slice(0, 6).map((ticket) => (
                      <span key={ticket}>#{formatDrawTicketNumber(ticket, totalTickets)}</span>
                    ))}
                  </div>
                )}
              </article>

              {otherCandidates.length > 0 && (
                <div className="draw-reveal-candidate-list">
                  {otherCandidates.map((candidate, index) => (
                    <article className="draw-reveal-candidate" key={candidate.address} style={candidateStrengthStyle(candidate.matchingTickets)}>
                      <div className="draw-reveal-candidate-row">
                        <span className="draw-reveal-candidate-index">#{index + 2}</span>
                        <div className="draw-reveal-candidate-identity">
                          <strong>{candidate.displayName}</strong>
                          <span title={candidate.address}>{candidate.address}</span>
                        </div>
                        <small>
                          {compactNumber(candidate.matchingTickets)}
                          <span>{copy.drawReveal.possibleTickets}</span>
                        </small>
                      </div>
                      {candidate.sampleTickets.length > 0 && (
                        <div className="draw-reveal-ticket-chips" aria-label={copy.drawReveal.sampleTickets}>
                          {candidate.sampleTickets.slice(0, 4).map((ticket) => (
                            <span key={ticket}>#{formatDrawTicketNumber(ticket, totalTickets)}</span>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="draw-reveal-candidate-empty">
              <div aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <p>{copy.drawReveal.candidateHint}</p>
            </div>
          )}
        </section>
      )}

      <section className={`draw-winner-board ${isAllComplete ? 'is-complete' : ''}`} aria-live="polite">
        <div className="draw-winner-board-head">
          <div>
            <span>{copy.drawReveal.winnerBoard}</span>
            <strong>{isAllComplete ? copy.drawReveal.allWinnersRevealed : `${compactNumber(visibleResults.length)} / ${compactNumber(TOTAL_PRIZE_DRAW_SLOTS)}`}</strong>
          </div>
          {drawStatus && (
            <small>
              {copy.walletPanel.winners}: {compactNumber(drawStatus.winnerCount)} / {compactNumber(drawStatus.prizeSlotCount)}
            </small>
          )}
        </div>

        <div className="draw-winner-groups">
          {PRIZE_GROUPS.map((group) => {
            const groupResults = visibleResults.filter((result) => result.prizeGroupId === group.id)
            return (
              <article className="draw-winner-group" key={group.id}>
                <div className="draw-winner-group-title">
                  <span>{prizeLabels[group.id]}</span>
                  <strong>
                    {compactNumber(groupResults.length)} / {compactNumber(group.slotCount)}
                  </strong>
                </div>
                <div className="draw-winner-card-grid">
                  {groupResults.length > 0 ? (
                    groupResults.map((result) => (
                      <div className="draw-winner-card" key={`${result.source}-${result.slotIndex}-${result.ticket.toString()}`}>
                        <span>{copy.drawReveal.slotLabel} #{result.slotIndex + 1}</span>
                        <strong>#{formatDrawTicketNumber(result.ticket, totalTickets)}</strong>
                        <small>{prizeRewards[result.prizeGroupId]}</small>
                        <div>
                          <b>{ownerName(result)}</b>
                          <em title={ownerAddress(result)}>{ownerAddress(result)}</em>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p>{copy.drawReveal.noWinnersYet}</p>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </section>
  )
}
