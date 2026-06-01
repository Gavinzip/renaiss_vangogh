import { readFileSync } from 'node:fs'
import { network } from 'hardhat'
import solc from 'solc'

const MOCK_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVRFConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

library VRFV2PlusClient {
    struct RandomWordsRequest {
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
    }
}

contract LocalVRFCoordinatorV2PlusMock {
    uint256 public nextRequestId = 1;
    mapping(uint256 => address) public consumers;

    event RandomWordsRequested(uint256 indexed requestId, address indexed consumer);
    event RandomWordsFulfilled(uint256 indexed requestId, uint256 randomWord);

    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req) external returns (uint256 requestId) {
        require(req.subId != 0, "subId");
        require(req.callbackGasLimit != 0, "gas");
        require(req.numWords == 1, "words");
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
      'LocalVRFCoordinatorV2PlusMock.sol': {
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

  const contract = output.contracts['LocalVRFCoordinatorV2PlusMock.sol'].LocalVRFCoordinatorV2PlusMock
  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
  }
}

const { ethers } = await network.create({ network: 'hardhatMainnet' })
const [owner, outsider] = await ethers.getSigners()
const ledgerPath = process.argv.includes('--ledger')
  ? process.argv[process.argv.indexOf('--ledger') + 1]
  : 'public/lucky-draw-ledger.json'
const ledger = JSON.parse(readFileSync(new URL(`../${ledgerPath}`, import.meta.url), 'utf8'))
const ledgerHash = String(ledger.ledgerHash || '')
const totalTickets = BigInt(ledger.totalFinalTickets || 0)
const prizeSlotCount = 21n
if (!/^0x[a-fA-F0-9]{64}$/.test(ledgerHash)) throw new Error('ledgerHash must be bytes32')
if (ledger.candidateSourceLimited) throw new Error('cannot dry-run contract with a limited candidate ledger')
if (totalTickets < prizeSlotCount) throw new Error('ledger total tickets must cover all prize slots')

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
  500000,
  false,
  21,
)
await raffle.waitForDeployment()

await (await raffle.finalizeLedger(ledgerHash, totalTickets, prizeSlotCount, ledgerPath)).wait()

let outsiderBlocked = false
try {
  await raffle.connect(outsider).requestDraw()
} catch {
  outsiderBlocked = true
}
if (!outsiderBlocked) {
  throw new Error('outsider requestDraw was not blocked')
}

const requestTx = await raffle.requestDraw()
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
const status = await raffle.roundStatus()
const winnerTickets = await raffle.winnerTickets()

if (!status.fulfilled) throw new Error('round was not fulfilled')
if (winnerTickets.length !== Number(prizeSlotCount)) {
  throw new Error(`expected ${prizeSlotCount} winners, got ${winnerTickets.length}`)
}
const unique = new Set(winnerTickets.map((ticket) => ticket.toString()))
if (unique.size !== Number(prizeSlotCount)) throw new Error('winner tickets are not unique')
for (const ticket of winnerTickets) {
  if (ticket < 1n || ticket > totalTickets) throw new Error(`winner ticket out of range: ${ticket}`)
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
      firstFiveWinnerTickets: winnerTickets.slice(0, 5).map((ticket) => ticket.toString()),
      outsiderBlocked,
    },
    null,
    2,
  ),
)
