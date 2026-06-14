import { readFileSync } from 'node:fs'
import { network } from 'hardhat'
import solc from 'solc'

const MOCK_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVRFConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

contract LocalVRFCoordinatorMock {
    uint256 public nextRequestId = 1;
    mapping(uint256 => address) public consumers;

    event RandomWordsRequested(uint256 indexed requestId, address indexed consumer);
    event RandomWordsFulfilled(uint256 indexed requestId, uint256 randomWord);

    function requestRandomWords(
        bytes32 keyHash,
        uint64 subId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords
    ) external returns (uint256 requestId) {
        require(keyHash != bytes32(0), "keyHash");
        require(subId != 0, "subId");
        require(requestConfirmations >= 3, "confirmations");
        require(callbackGasLimit != 0, "gas");
        require(numWords == 1, "words");
        requestId = nextRequestId++;
        consumers[requestId] = msg.sender;
        emit RandomWordsRequested(requestId, msg.sender);
    }

    function fulfill(uint256 requestId, uint256 randomWord) external {
        address consumer = consumers[requestId];
        require(consumer != address(0), "request");
        uint256[] memory words = new uint256[](1);
        words[0] = randomWord;
        IVRFConsumer(consumer).rawFulfillRandomWords(requestId, words);
        emit RandomWordsFulfilled(requestId, randomWord);
    }
}`

function compileMock() {
  const input = {
    language: 'Solidity',
    sources: {
      'LocalVRFCoordinatorMock.sol': {
        content: MOCK_SOURCE,
      },
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object'],
        },
      },
    },
  }

  const output = JSON.parse(solc.compile(JSON.stringify(input)))
  const errors = (output.errors || []).filter((error) => error.severity === 'error')
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.formattedMessage).join('\n'))
  }

  const contract = output.contracts['LocalVRFCoordinatorMock.sol'].LocalVRFCoordinatorMock
  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
  }
}

const { ethers } = await network.create({ network: 'hardhatMainnet' })
const [owner, admin, outsider] = await ethers.getSigners()
const ledgerPath = process.argv.includes('--ledger')
  ? process.argv[process.argv.indexOf('--ledger') + 1]
  : 'public/lucky-draw-ledger.json'
const ledger = JSON.parse(readFileSync(new URL(`../${ledgerPath}`, import.meta.url), 'utf8'))
const ledgerHash = String(ledger.ledgerHash || '')
const totalTickets = BigInt(ledger.totalFinalTickets || 0)
const prizeSlotCount = 21n
const expectedReserveCount = (slotIndex) => (slotIndex === 0 ? 4 : 3)
const expectedTotalUniqueTickets = Number(prizeSlotCount) * 4 + 1
if (!/^0x[a-fA-F0-9]{64}$/.test(ledgerHash)) throw new Error('ledgerHash must be bytes32')
if (ledger.candidateSourceLimited) throw new Error('cannot dry-run contract with a limited candidate ledger')
if (totalTickets < BigInt(expectedTotalUniqueTickets)) throw new Error('ledger total tickets must cover all prize and reserve slots')

const mockArtifact = compileMock()
const mockFactory = new ethers.ContractFactory(mockArtifact.abi, mockArtifact.bytecode, owner)
const coordinator = await mockFactory.deploy()
await coordinator.waitForDeployment()

const raffleArtifact = JSON.parse(
  readFileSync(new URL('../artifacts/contracts/RenaissLuckyDraw.sol/RenaissLuckyDraw.json', import.meta.url), 'utf8'),
)
const raffleFactory = new ethers.ContractFactory(raffleArtifact.abi, raffleArtifact.bytecode, owner)
const keyHash = `0x${'11'.repeat(32)}`
const raffle = await raffleFactory.deploy(
  await coordinator.getAddress(),
  keyHash,
  1,
  3,
  200000,
  21,
)
await raffle.waitForDeployment()

await (await raffle.setAdmin(admin.address, true)).wait()
if (!(await raffle.isAdmin(owner.address))) throw new Error('owner should be a draw admin')
if (!(await raffle.isAdmin(admin.address))) throw new Error('configured admin should be a draw admin')
if (await raffle.isAdmin(outsider.address)) throw new Error('outsider should not be a draw admin')

let outsiderFinalizeBlocked = false
try {
  await raffle.connect(outsider).finalizeLedger(ledgerHash, totalTickets, prizeSlotCount, ledgerPath)
} catch {
  outsiderFinalizeBlocked = true
}
if (!outsiderFinalizeBlocked) {
  throw new Error('outsider finalizeLedger was not blocked')
}

await (await raffle.connect(admin).finalizeLedger(ledgerHash, totalTickets, prizeSlotCount, ledgerPath)).wait()

let outsiderResetBlocked = false
try {
  await raffle.connect(outsider).resetDraft()
} catch {
  outsiderResetBlocked = true
}
if (!outsiderResetBlocked) {
  throw new Error('outsider resetDraft was not blocked')
}

await (await raffle.connect(admin).resetDraft()).wait()
await (await raffle.connect(admin).finalizeLedger(ledgerHash, totalTickets, prizeSlotCount, ledgerPath)).wait()

let outsiderBlocked = false
try {
  await raffle.connect(outsider).requestDraw()
} catch {
  outsiderBlocked = true
}
if (!outsiderBlocked) {
  throw new Error('outsider requestDraw was not blocked')
}

const requestTx = await raffle.connect(admin).requestDraw()
const requestReceipt = await requestTx.wait()
const drawEvent = requestReceipt.logs
  .map((log) => {
    try {
      return raffle.interface.parseLog(log)
    } catch {
      return null
    }
  })
  .find((event) => event?.name === 'DrawRequested')
const requestId = drawEvent?.args?.requestId
if (!requestId) throw new Error('DrawRequested event missing')

await (await coordinator.fulfill(requestId, 12345678901234567890n)).wait()

const readyStatus = await raffle.roundStatus()
let winnerTickets = await raffle.winnerTickets()
if (readyStatus.fulfilled) throw new Error('round was fulfilled before drawNext calls')
if (winnerTickets.length !== 0) throw new Error('revealed winner tickets should be empty before reveal calls')
let winnerTicketsBySlot = await raffle.winnerTicketsBySlot()
let revealedPrizeSlots = await raffle.revealedPrizeSlots()
let revealedTickets = await raffle.revealedTickets()
let reserveTicketsForGrand = await raffle.reserveTicketsBySlot(0)
if (winnerTicketsBySlot.length !== Number(prizeSlotCount)) throw new Error('winner tickets by slot should expose every prize slot')
if (winnerTicketsBySlot.some((ticket) => ticket !== 0n)) throw new Error('winner tickets by slot should hide unrevealed slots')
if (revealedPrizeSlots.length !== 0) throw new Error('revealed prize slots should be empty before reveal calls')
if (revealedTickets.length !== 0) throw new Error('revealed tickets should be empty before reveal calls')
if (reserveTicketsForGrand.length !== 0) throw new Error('reserve tickets should hide unrevealed slots')

let zeroBatchBlocked = false
try {
  await raffle.drawBatch(0)
} catch {
  zeroBatchBlocked = true
}
if (!zeroBatchBlocked) {
  throw new Error('zero-count drawBatch was not blocked')
}

let overBatchBlocked = false
try {
  await raffle.drawBatch(prizeSlotCount + 1n)
} catch {
  overBatchBlocked = true
}
if (!overBatchBlocked) {
  throw new Error('oversized drawBatch was not blocked')
}

let invalidPrizeSlotBlocked = false
try {
  await raffle.drawPrizeSlot(prizeSlotCount)
} catch {
  invalidPrizeSlotBlocked = true
}
if (!invalidPrizeSlotBlocked) {
  throw new Error('invalid prize slot was not blocked')
}

let emptyPrizeSlotsBlocked = false
try {
  await raffle.drawPrizeSlots([])
} catch {
  emptyPrizeSlotsBlocked = true
}
if (!emptyPrizeSlotsBlocked) {
  throw new Error('empty drawPrizeSlots was not blocked')
}

const revealedSlotIndexes = []
const revealedTicketsBySlot = new Map()
const revealedReserveTicketsBySlot = new Map()
const publicRevealAccess = {
  drawNext: false,
  drawBatch: false,
  drawPrizeSlot: false,
  drawPrizeSlots: false,
  drawRandomPrizeSlot: false,
}

async function collectPrizeWinnerEvents(drawTx, expectedPrizeSlots = null) {
  const drawReceipt = await drawTx.wait()
  const parsedLogs = drawReceipt.logs
    .map((log) => {
      try {
        return raffle.interface.parseLog(log)
      } catch {
        return null
      }
    })
  const prizeWinnerEvents = parsedLogs
    .filter((event) => event?.name === 'PrizeWinnerDrawn')
  if (expectedPrizeSlots && prizeWinnerEvents.length !== expectedPrizeSlots.length) {
    throw new Error(`expected ${expectedPrizeSlots.length} PrizeWinnerDrawn events, got ${prizeWinnerEvents.length}`)
  }

  const legacyWinnerEvents = parsedLogs.filter((event) => event?.name === 'WinnerDrawn')
  if (legacyWinnerEvents.length !== prizeWinnerEvents.length) {
    throw new Error(`expected legacy WinnerDrawn count ${prizeWinnerEvents.length}, got ${legacyWinnerEvents.length}`)
  }
  const reserveWinnerEvents = parsedLogs.filter((event) => event?.name === 'PrizeReserveWinnerDrawn')
  const expectedReserveEvents = prizeWinnerEvents.reduce(
    (sum, event) => sum + expectedReserveCount(Number(event.args.prizeSlotIndex)),
    0,
  )
  if (reserveWinnerEvents.length !== expectedReserveEvents) {
    throw new Error(`expected ${expectedReserveEvents} PrizeReserveWinnerDrawn events, got ${reserveWinnerEvents.length}`)
  }

  for (let index = 0; index < prizeWinnerEvents.length; index++) {
    const prizeWinnerEvent = prizeWinnerEvents[index]
    const legacyWinnerEvent = legacyWinnerEvents[index]
    const expectedRevealIndex = revealedSlotIndexes.length
    const prizeSlotIndex = Number(prizeWinnerEvent.args.prizeSlotIndex)
    const ticketNumber = prizeWinnerEvent.args.ticketNumber

    if (prizeWinnerEvent.args.revealIndex !== BigInt(expectedRevealIndex)) {
      throw new Error(`expected reveal index ${expectedRevealIndex}, got ${prizeWinnerEvent.args.revealIndex}`)
    }
    if (expectedPrizeSlots && prizeSlotIndex !== expectedPrizeSlots[index]) {
      throw new Error(`expected prize slot ${expectedPrizeSlots[index]}, got ${prizeSlotIndex}`)
    }
    if (legacyWinnerEvent.args.slotIndex !== BigInt(prizeSlotIndex)) {
      throw new Error(`legacy slot ${legacyWinnerEvent.args.slotIndex} did not match prize slot ${prizeSlotIndex}`)
    }
    if (legacyWinnerEvent.args.ticketNumber !== ticketNumber) {
      throw new Error(`legacy ticket ${legacyWinnerEvent.args.ticketNumber} did not match prize event ticket ${ticketNumber}`)
    }

    revealedSlotIndexes.push(prizeSlotIndex)
    revealedTicketsBySlot.set(prizeSlotIndex, ticketNumber)

    const reserveEventsForSlot = reserveWinnerEvents.filter(
      (event) => Number(event.args.prizeSlotIndex) === prizeSlotIndex,
    )
    if (reserveEventsForSlot.length !== expectedReserveCount(prizeSlotIndex)) {
      throw new Error(`expected ${expectedReserveCount(prizeSlotIndex)} reserve events for slot ${prizeSlotIndex}`)
    }
    reserveEventsForSlot.forEach((event, reserveIndex) => {
      if (event.args.revealIndex !== BigInt(expectedRevealIndex)) {
        throw new Error(`reserve reveal index mismatch at slot ${prizeSlotIndex}`)
      }
      if (event.args.reserveIndex !== BigInt(reserveIndex)) {
        throw new Error(`reserve index mismatch at slot ${prizeSlotIndex}`)
      }
    })
    revealedReserveTicketsBySlot.set(
      prizeSlotIndex,
      reserveEventsForSlot.map((event) => event.args.ticketNumber),
    )
  }
}

await collectPrizeWinnerEvents(await raffle.connect(outsider).drawNext(), [0])
publicRevealAccess.drawNext = true

await collectPrizeWinnerEvents(await raffle.connect(outsider).drawBatch(2), [1, 2])
publicRevealAccess.drawBatch = true

await collectPrizeWinnerEvents(await raffle.connect(outsider).drawPrizeSlot(11), [11])
publicRevealAccess.drawPrizeSlot = true

let duplicatePrizeSlotBlocked = false
try {
  await raffle.drawPrizeSlot(11)
} catch {
  duplicatePrizeSlotBlocked = true
}
if (!duplicatePrizeSlotBlocked) {
  throw new Error('duplicate prize slot reveal was not blocked')
}

await collectPrizeWinnerEvents(await raffle.connect(outsider).drawPrizeSlots([12, 3]), [12, 3])
publicRevealAccess.drawPrizeSlots = true

await collectPrizeWinnerEvents(await raffle.connect(outsider).drawRandomPrizeSlot())
publicRevealAccess.drawRandomPrizeSlot = true

const allPrizeSlots = Array.from({ length: Number(prizeSlotCount) }, (_, index) => index)
while (revealedSlotIndexes.length < Number(prizeSlotCount)) {
  const remainingSlots = allPrizeSlots.filter((slotIndex) => !revealedSlotIndexes.includes(slotIndex))
  const batch = remainingSlots.slice(0, 5)
  await collectPrizeWinnerEvents(batch.length === 1 ? await raffle.drawPrizeSlot(batch[0]) : await raffle.drawPrizeSlots(batch), batch)
}

const status = await raffle.roundStatus()
winnerTickets = await raffle.winnerTickets()
winnerTicketsBySlot = await raffle.winnerTicketsBySlot()
revealedPrizeSlots = await raffle.revealedPrizeSlots()
revealedTickets = await raffle.revealedTickets()
const reserveTicketsBySlot = await Promise.all(
  Array.from({ length: Number(prizeSlotCount) }, (_, index) => raffle.reserveTicketsBySlot(index)),
)

if (!status.fulfilled) throw new Error('round was not fulfilled after all drawNext calls')
if (winnerTickets.length !== Number(prizeSlotCount)) {
  throw new Error(`expected ${prizeSlotCount} revealed winners, got ${winnerTickets.length}`)
}
if (winnerTicketsBySlot.length !== Number(prizeSlotCount)) {
  throw new Error(`expected ${prizeSlotCount} slot winners, got ${winnerTicketsBySlot.length}`)
}
if (revealedPrizeSlots.length !== Number(prizeSlotCount)) {
  throw new Error(`expected ${prizeSlotCount} revealed prize slots, got ${revealedPrizeSlots.length}`)
}
if (revealedTickets.length !== Number(prizeSlotCount)) {
  throw new Error(`expected ${prizeSlotCount} revealed tickets, got ${revealedTickets.length}`)
}
const allAwardedTickets = [
  ...winnerTicketsBySlot,
  ...reserveTicketsBySlot.flat(),
]
const unique = new Set(allAwardedTickets.map((ticket) => ticket.toString()))
if (unique.size !== expectedTotalUniqueTickets) throw new Error('winner and reserve tickets are not globally unique')
for (const ticket of winnerTicketsBySlot) {
  if (ticket < 1n || ticket > totalTickets) throw new Error(`winner ticket out of range: ${ticket}`)
}
for (const ticket of reserveTicketsBySlot.flat()) {
  if (ticket < 1n || ticket > totalTickets) throw new Error(`reserve ticket out of range: ${ticket}`)
}
for (let revealIndex = 0; revealIndex < Number(prizeSlotCount); revealIndex++) {
  const prizeSlotIndex = Number(revealedPrizeSlots[revealIndex])
  const ticketByReveal = revealedTickets[revealIndex]
  const ticketBySlot = winnerTicketsBySlot[prizeSlotIndex]
  const reserveTickets = reserveTicketsBySlot[prizeSlotIndex]
  if (winnerTickets[revealIndex] !== ticketByReveal) {
    throw new Error(`winnerTickets legacy output mismatch at reveal ${revealIndex}`)
  }
  if (ticketByReveal !== ticketBySlot) {
    throw new Error(`slot/reveal ticket mismatch at reveal ${revealIndex}`)
  }
  if (revealedTicketsBySlot.get(prizeSlotIndex) !== ticketBySlot) {
    throw new Error(`event/storage ticket mismatch at slot ${prizeSlotIndex}`)
  }
  if (reserveTickets.length !== expectedReserveCount(prizeSlotIndex)) {
    throw new Error(`reserve count mismatch at slot ${prizeSlotIndex}`)
  }
  const eventReserveTickets = revealedReserveTicketsBySlot.get(prizeSlotIndex) ?? []
  for (let reserveIndex = 0; reserveIndex < reserveTickets.length; reserveIndex++) {
    if (reserveTickets[reserveIndex] !== eventReserveTickets[reserveIndex]) {
      throw new Error(`reserve event/storage mismatch at slot ${prizeSlotIndex} reserve ${reserveIndex}`)
    }
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      coordinator: await coordinator.getAddress(),
      raffle: await raffle.getAddress(),
      ledgerPath,
      ledgerHash,
      requestId: requestId.toString(),
      totalTickets: status.currentTotalTickets.toString(),
      prizeSlotCount: status.currentPrizeSlotCount.toString(),
      winnerCount: status.winnerCount.toString(),
      reserveTicketCount: reserveTicketsBySlot.flat().length,
      totalUniqueAwardedTickets: unique.size,
      firstFiveWinnerTicketsBySlot: winnerTicketsBySlot.slice(0, 5).map((ticket) => ticket.toString()),
      grandReserveTickets: reserveTicketsBySlot[0].map((ticket) => ticket.toString()),
      firstSmallPrizeReserveTickets: reserveTicketsBySlot[1].map((ticket) => ticket.toString()),
      firstFiveRevealedTickets: revealedTickets.slice(0, 5).map((ticket) => ticket.toString()),
      revealedPrizeSlots: revealedPrizeSlots.map((slotIndex) => slotIndex.toString()),
      admin: admin.address,
      outsiderBlocked,
      outsiderFinalizeBlocked,
      outsiderResetBlocked,
      publicRevealAccess,
      zeroBatchBlocked,
      overBatchBlocked,
      invalidPrizeSlotBlocked,
      emptyPrizeSlotsBlocked,
      duplicatePrizeSlotBlocked,
    },
    null,
    2,
  ),
)
