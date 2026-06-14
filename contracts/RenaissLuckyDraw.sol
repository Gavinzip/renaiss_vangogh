// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VRFConsumerBase} from "./oracle/VRFConsumerBase.sol";
import {VRFCoordinatorInterface} from "./oracle/VRFCoordinatorInterface.sol";

contract RenaissLuckyDraw is VRFConsumerBase {
    enum DrawState {
        Draft,
        LedgerFinalized,
        RandomnessRequested,
        RandomnessReady,
        Fulfilled
    }

    struct VrfConfig {
        bytes32 keyHash;
        uint64 subscriptionId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
    }

    address public drawOperator;
    address public immutable vrfCoordinatorAddress;
    address private s_owner;
    address private s_pendingOwner;
    mapping(address => bool) private s_admins;
    VrfConfig public vrfConfig;
    bytes32 public ledgerHash;
    string public ledgerUri;
    uint256 public totalTickets;
    uint256 public prizeSlotCount;
    uint256 public requestId;
    uint256 public randomWord;
    DrawState public state;

    uint256 public constant GRAND_PRIZE_SLOT_INDEX = 0;
    uint256 public constant GRAND_PRIZE_RESERVE_COUNT = 4;
    uint256 public constant DEFAULT_RESERVE_COUNT = 3;

    uint256[] private s_winnerTicketsBySlot;
    uint256[] private s_revealedPrizeSlots;
    uint256[] private s_revealedTickets;
    uint256[] private s_allComputedTickets;
    mapping(uint256 => uint256[]) private s_reserveTicketsBySlot;
    bool[] private s_prizeSlotRevealed;
    uint256 private s_computedPrizeSlotCount;

    event DrawOperatorChanged(address indexed operator);
    event VrfConfigUpdated(
        bytes32 indexed keyHash,
        uint256 indexed subscriptionId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit
    );
    event LedgerFinalized(bytes32 indexed ledgerHash, uint256 totalTickets, uint256 prizeSlotCount, string ledgerUri);
    event DrawRequested(uint256 indexed requestId, address indexed caller);
    event RandomnessFulfilled(uint256 indexed requestId, uint256 randomWord);
    event WinnerDrawn(uint256 indexed slotIndex, uint256 ticketNumber);
    event PrizeWinnerDrawn(uint256 indexed revealIndex, uint256 indexed prizeSlotIndex, uint256 ticketNumber);
    event PrizeReserveWinnerDrawn(
        uint256 indexed revealIndex,
        uint256 indexed prizeSlotIndex,
        uint256 indexed reserveIndex,
        uint256 ticketNumber
    );
    event DrawFulfilled(uint256 indexed requestId, uint256 randomWord, uint256[] winnerTickets);
    event RoundReset();
    event OwnershipTransferRequested(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);
    event DrawAdminChanged(address indexed admin, bool allowed);

    error NotDrawOperator();
    error NotDrawAdmin();
    error InvalidAddress();
    error InvalidState();
    error InvalidLedger();
    error InvalidPrizeSlots();
    error InvalidRequest();
    error InvalidVrfConfig();
    error NotOwner();

    modifier onlyDrawOperator() {
        if (!_isDrawAdmin(msg.sender)) revert NotDrawOperator();
        _;
    }

    modifier onlyDrawAdmin() {
        if (!_isDrawAdmin(msg.sender)) revert NotDrawAdmin();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != s_owner) revert NotOwner();
        _;
    }

    constructor(
        address vrfCoordinator,
        bytes32 keyHash,
        uint64 subscriptionId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        uint256 initialPrizeSlotCount
    ) VRFConsumerBase(vrfCoordinator) {
        if (vrfCoordinator == address(0)) revert InvalidAddress();
        vrfCoordinatorAddress = vrfCoordinator;
        s_owner = msg.sender;
        drawOperator = msg.sender;
        _setVrfConfig(keyHash, subscriptionId, requestConfirmations, callbackGasLimit);
        _setPrizeSlotCount(initialPrizeSlotCount);
        emit OwnershipTransferred(address(0), msg.sender);
        emit DrawOperatorChanged(msg.sender);
    }

    function owner() public view returns (address) {
        return s_owner;
    }

    function pendingOwner() external view returns (address) {
        return s_pendingOwner;
    }

    function isAdmin(address account) public view returns (bool) {
        return _isDrawAdmin(account);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        s_pendingOwner = newOwner;
        emit OwnershipTransferRequested(s_owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != s_pendingOwner) revert InvalidAddress();
        address previousOwner = s_owner;
        s_owner = msg.sender;
        s_pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, msg.sender);
    }

    function setDrawOperator(address operator) external onlyOwner {
        if (operator == address(0)) revert InvalidAddress();
        drawOperator = operator;
        emit DrawOperatorChanged(operator);
    }

    function setAdmin(address admin, bool allowed) external onlyOwner {
        if (admin == address(0)) revert InvalidAddress();
        s_admins[admin] = allowed;
        emit DrawAdminChanged(admin, allowed);
    }

    function setVrfConfig(
        bytes32 keyHash,
        uint64 subscriptionId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit
    ) external onlyOwner {
        if (state == DrawState.RandomnessRequested) revert InvalidState();
        _setVrfConfig(keyHash, subscriptionId, requestConfirmations, callbackGasLimit);
    }

    function finalizeLedger(
        bytes32 newLedgerHash,
        uint256 newTotalTickets,
        uint256 newPrizeSlotCount,
        string calldata newLedgerUri
    ) external onlyDrawAdmin {
        if (state != DrawState.Draft && state != DrawState.LedgerFinalized) revert InvalidState();
        if (newLedgerHash == bytes32(0) || newTotalTickets == 0) revert InvalidLedger();
        _setPrizeSlotCount(newPrizeSlotCount);
        if (newTotalTickets < _requiredUniqueTicketCount(newPrizeSlotCount)) revert InvalidPrizeSlots();

        _resetWinnerStorage();
        ledgerHash = newLedgerHash;
        totalTickets = newTotalTickets;
        ledgerUri = newLedgerUri;
        randomWord = 0;
        requestId = 0;
        state = DrawState.LedgerFinalized;
        emit LedgerFinalized(newLedgerHash, newTotalTickets, newPrizeSlotCount, newLedgerUri);
    }

    function resetDraft() external onlyDrawAdmin {
        if (state == DrawState.RandomnessRequested) revert InvalidState();
        _resetWinnerStorage();
        ledgerHash = bytes32(0);
        ledgerUri = "";
        totalTickets = 0;
        requestId = 0;
        randomWord = 0;
        state = DrawState.Draft;
        emit RoundReset();
    }

    function requestDraw() external onlyDrawAdmin returns (uint256 newRequestId) {
        if (state != DrawState.LedgerFinalized) revert InvalidState();
        VrfConfig memory config = vrfConfig;
        if (config.keyHash == bytes32(0) || config.subscriptionId == 0 || config.callbackGasLimit == 0) {
            revert InvalidVrfConfig();
        }

        newRequestId = VRFCoordinatorInterface(vrfCoordinatorAddress).requestRandomWords(
            config.keyHash,
            config.subscriptionId,
            config.requestConfirmations,
            config.callbackGasLimit,
            1
        );
        requestId = newRequestId;
        state = DrawState.RandomnessRequested;
        emit DrawRequested(newRequestId, msg.sender);
    }

    function fulfillRandomWords(uint256 fulfilledRequestId, uint256[] memory randomWords) internal override {
        if (state != DrawState.RandomnessRequested || fulfilledRequestId != requestId) revert InvalidRequest();
        if (randomWords.length == 0) revert InvalidRequest();

        randomWord = randomWords[0];
        _resetWinnerStorage();
        state = DrawState.RandomnessReady;
        emit RandomnessFulfilled(fulfilledRequestId, randomWords[0]);
    }

    function drawNext() external returns (uint256 ticketNumber) {
        if (state != DrawState.RandomnessReady) revert InvalidState();

        uint256 prizeSlotIndex = _nextUnrevealedPrizeSlot();
        ticketNumber = _drawPrizeSlot(prizeSlotIndex);
        _completeIfFulfilled();
    }

    function drawBatch(uint256 count) external returns (uint256[] memory ticketNumbers) {
        if (state != DrawState.RandomnessReady) revert InvalidState();
        if (count == 0) revert InvalidPrizeSlots();

        uint256 remainingSlots = prizeSlotCount - s_revealedPrizeSlots.length;
        if (count > remainingSlots) revert InvalidPrizeSlots();

        ticketNumbers = new uint256[](count);
        for (uint256 index = 0; index < count; index++) {
            uint256 prizeSlotIndex = _nextUnrevealedPrizeSlot();
            ticketNumbers[index] = _drawPrizeSlot(prizeSlotIndex);
        }

        _completeIfFulfilled();
    }

    function drawPrizeSlot(uint256 prizeSlotIndex) external returns (uint256 ticketNumber) {
        if (state != DrawState.RandomnessReady) revert InvalidState();

        ticketNumber = _drawPrizeSlot(prizeSlotIndex);
        _completeIfFulfilled();
    }

    function drawPrizeSlots(uint256[] calldata prizeSlotIndexes)
        external
        returns (uint256[] memory ticketNumbers)
    {
        if (state != DrawState.RandomnessReady) revert InvalidState();
        if (prizeSlotIndexes.length == 0) revert InvalidPrizeSlots();
        if (prizeSlotIndexes.length > prizeSlotCount - s_revealedPrizeSlots.length) revert InvalidPrizeSlots();

        ticketNumbers = new uint256[](prizeSlotIndexes.length);
        for (uint256 index = 0; index < prizeSlotIndexes.length; index++) {
            ticketNumbers[index] = _drawPrizeSlot(prizeSlotIndexes[index]);
        }

        _completeIfFulfilled();
    }

    function drawRandomPrizeSlot()
        external
        returns (uint256 prizeSlotIndex, uint256 ticketNumber)
    {
        if (state != DrawState.RandomnessReady) revert InvalidState();

        prizeSlotIndex = _randomUnrevealedPrizeSlot();
        ticketNumber = _drawPrizeSlot(prizeSlotIndex);
        _completeIfFulfilled();
    }

    function winnerTickets() external view returns (uint256[] memory) {
        return s_revealedTickets;
    }

    function winnerTicket(uint256 index) external view returns (uint256) {
        return s_revealedTickets[index];
    }

    function revealedPrizeSlots() external view returns (uint256[] memory) {
        return s_revealedPrizeSlots;
    }

    function revealedTickets() external view returns (uint256[] memory) {
        return s_revealedTickets;
    }

    function winnerTicketsBySlot() external view returns (uint256[] memory ticketsBySlot) {
        ticketsBySlot = new uint256[](prizeSlotCount);
        for (uint256 index = 0; index < prizeSlotCount; index++) {
            if (index < s_prizeSlotRevealed.length && s_prizeSlotRevealed[index]) {
                ticketsBySlot[index] = s_winnerTicketsBySlot[index];
            }
        }
    }

    function winnerTicketBySlot(uint256 prizeSlotIndex) external view returns (uint256) {
        if (prizeSlotIndex >= prizeSlotCount) revert InvalidPrizeSlots();
        if (prizeSlotIndex >= s_prizeSlotRevealed.length || !s_prizeSlotRevealed[prizeSlotIndex]) return 0;
        return s_winnerTicketsBySlot[prizeSlotIndex];
    }

    function reserveCountForPrizeSlot(uint256 prizeSlotIndex) public view returns (uint256) {
        if (prizeSlotIndex >= prizeSlotCount) revert InvalidPrizeSlots();
        return _reserveCountForPrizeSlot(prizeSlotIndex);
    }

    function reserveTicketsBySlot(uint256 prizeSlotIndex) external view returns (uint256[] memory) {
        if (prizeSlotIndex >= prizeSlotCount) revert InvalidPrizeSlots();
        if (prizeSlotIndex >= s_prizeSlotRevealed.length || !s_prizeSlotRevealed[prizeSlotIndex]) {
            return new uint256[](0);
        }
        return s_reserveTicketsBySlot[prizeSlotIndex];
    }

    function reserveTicketBySlot(uint256 prizeSlotIndex, uint256 reserveIndex) external view returns (uint256) {
        if (prizeSlotIndex >= prizeSlotCount) revert InvalidPrizeSlots();
        if (reserveIndex >= _reserveCountForPrizeSlot(prizeSlotIndex)) revert InvalidPrizeSlots();
        if (prizeSlotIndex >= s_prizeSlotRevealed.length || !s_prizeSlotRevealed[prizeSlotIndex]) return 0;
        return s_reserveTicketsBySlot[prizeSlotIndex][reserveIndex];
    }

    function roundStatus()
        external
        view
        returns (
            bool finalized,
            bool requested,
            bool fulfilled,
            uint256 currentTotalTickets,
            uint256 firstWinningTicket,
            bytes32 currentLedgerHash,
            uint256 currentPrizeSlotCount,
            uint256 winnerCount
        )
    {
        return (
            state >= DrawState.LedgerFinalized,
            state >= DrawState.RandomnessRequested,
            state == DrawState.Fulfilled,
            totalTickets,
            s_revealedTickets.length > 0 ? s_revealedTickets[0] : 0,
            ledgerHash,
            prizeSlotCount,
            s_revealedPrizeSlots.length
        );
    }

    function _drawPrizeSlot(uint256 prizeSlotIndex) internal returns (uint256 ticketNumber) {
        if (prizeSlotIndex >= prizeSlotCount) revert InvalidPrizeSlots();
        _preparePrizeSlotStorage();
        if (s_prizeSlotRevealed[prizeSlotIndex]) revert InvalidState();

        _ensurePrizeSlotComputed(prizeSlotIndex);
        ticketNumber = s_winnerTicketsBySlot[prizeSlotIndex];
        uint256 revealIndex = s_revealedPrizeSlots.length;

        s_prizeSlotRevealed[prizeSlotIndex] = true;
        s_revealedPrizeSlots.push(prizeSlotIndex);
        s_revealedTickets.push(ticketNumber);

        emit WinnerDrawn(prizeSlotIndex, ticketNumber);
        emit PrizeWinnerDrawn(revealIndex, prizeSlotIndex, ticketNumber);
        uint256 reserveCount = s_reserveTicketsBySlot[prizeSlotIndex].length;
        for (uint256 reserveIndex = 0; reserveIndex < reserveCount; reserveIndex++) {
            emit PrizeReserveWinnerDrawn(
                revealIndex,
                prizeSlotIndex,
                reserveIndex,
                s_reserveTicketsBySlot[prizeSlotIndex][reserveIndex]
            );
        }
    }

    function _completeIfFulfilled() internal {
        if (s_revealedPrizeSlots.length == prizeSlotCount) {
            _ensurePrizeSlotComputed(prizeSlotCount - 1);
            state = DrawState.Fulfilled;
            emit DrawFulfilled(requestId, randomWord, s_winnerTicketsBySlot);
        }
    }

    function _setVrfConfig(
        bytes32 keyHash,
        uint64 subscriptionId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit
    ) internal {
        if (keyHash == bytes32(0) || subscriptionId == 0 || callbackGasLimit == 0) revert InvalidVrfConfig();
        vrfConfig = VrfConfig({
            keyHash: keyHash,
            subscriptionId: subscriptionId,
            requestConfirmations: requestConfirmations,
            callbackGasLimit: callbackGasLimit
        });
        emit VrfConfigUpdated(keyHash, subscriptionId, requestConfirmations, callbackGasLimit);
    }

    function _setPrizeSlotCount(uint256 newPrizeSlotCount) internal {
        if (newPrizeSlotCount == 0 || newPrizeSlotCount > 256) revert InvalidPrizeSlots();
        prizeSlotCount = newPrizeSlotCount;
    }

    function _isDrawAdmin(address account) internal view returns (bool) {
        return account == s_owner || account == drawOperator || s_admins[account];
    }

    function _resetWinnerStorage() internal {
        for (uint256 index = 0; index < s_winnerTicketsBySlot.length; index++) {
            delete s_reserveTicketsBySlot[index];
        }
        delete s_winnerTicketsBySlot;
        delete s_revealedPrizeSlots;
        delete s_revealedTickets;
        delete s_allComputedTickets;
        delete s_prizeSlotRevealed;
        s_computedPrizeSlotCount = 0;
    }

    function _preparePrizeSlotStorage() internal {
        while (s_winnerTicketsBySlot.length < prizeSlotCount) {
            s_winnerTicketsBySlot.push(0);
        }
        while (s_prizeSlotRevealed.length < prizeSlotCount) {
            s_prizeSlotRevealed.push(false);
        }
    }

    function _ensurePrizeSlotComputed(uint256 prizeSlotIndex) internal {
        if (prizeSlotIndex >= prizeSlotCount) revert InvalidPrizeSlots();
        _preparePrizeSlotStorage();

        while (s_computedPrizeSlotCount <= prizeSlotIndex) {
            uint256 computedSlotIndex = s_computedPrizeSlotCount;
            delete s_reserveTicketsBySlot[computedSlotIndex];

            uint256 primaryTicket = _drawUniqueTicket(randomWord, s_allComputedTickets.length);
            s_winnerTicketsBySlot[computedSlotIndex] = primaryTicket;
            s_allComputedTickets.push(primaryTicket);

            uint256 reserveCount = _reserveCountForPrizeSlot(computedSlotIndex);
            for (uint256 reserveIndex = 0; reserveIndex < reserveCount; reserveIndex++) {
                uint256 reserveTicket = _drawUniqueTicket(randomWord, s_allComputedTickets.length);
                s_reserveTicketsBySlot[computedSlotIndex].push(reserveTicket);
                s_allComputedTickets.push(reserveTicket);
            }

            s_computedPrizeSlotCount++;
        }
    }

    function _nextUnrevealedPrizeSlot() internal view returns (uint256 prizeSlotIndex) {
        for (uint256 index = 0; index < prizeSlotCount; index++) {
            if (index >= s_prizeSlotRevealed.length || !s_prizeSlotRevealed[index]) return index;
        }
        revert InvalidState();
    }

    function _randomUnrevealedPrizeSlot() internal view returns (uint256 prizeSlotIndex) {
        uint256 revealIndex = s_revealedPrizeSlots.length;
        uint256 remainingSlots = prizeSlotCount - revealIndex;
        if (remainingSlots == 0) revert InvalidState();

        uint256 targetOffset = uint256(keccak256(abi.encode(randomWord, "prize-slot", revealIndex))) % remainingSlots;
        uint256 seenUnrevealed = 0;
        for (uint256 index = 0; index < prizeSlotCount; index++) {
            if (index < s_prizeSlotRevealed.length && s_prizeSlotRevealed[index]) continue;
            if (seenUnrevealed == targetOffset) return index;
            seenUnrevealed++;
        }
        revert InvalidState();
    }

    function _drawUniqueTicket(uint256 seed, uint256 pickIndex) internal view returns (uint256) {
        uint256 nonce = 0;
        while (nonce < totalTickets) {
            uint256 candidate = (uint256(keccak256(abi.encode(seed, pickIndex, nonce))) % totalTickets) + 1;
            bool duplicate = false;
            for (uint256 existingIndex = 0; existingIndex < s_allComputedTickets.length; existingIndex++) {
                if (s_allComputedTickets[existingIndex] == candidate) {
                    duplicate = true;
                    break;
                }
            }
            if (!duplicate) return candidate;
            nonce++;
        }
        revert InvalidPrizeSlots();
    }

    function _reserveCountForPrizeSlot(uint256 prizeSlotIndex) internal pure returns (uint256) {
        return prizeSlotIndex == GRAND_PRIZE_SLOT_INDEX ? GRAND_PRIZE_RESERVE_COUNT : DEFAULT_RESERVE_COUNT;
    }

    function _requiredUniqueTicketCount(uint256 slots) internal pure returns (uint256) {
        if (slots == 0) return 0;
        return slots * (DEFAULT_RESERVE_COUNT + 1) + (GRAND_PRIZE_RESERVE_COUNT - DEFAULT_RESERVE_COUNT);
    }
}
