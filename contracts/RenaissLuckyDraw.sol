// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

contract RenaissLuckyDraw is VRFConsumerBaseV2Plus {
    enum DrawState {
        Draft,
        LedgerFinalized,
        RandomnessRequested,
        Fulfilled
    }

    struct VrfConfig {
        bytes32 keyHash;
        uint256 subscriptionId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        bool nativePayment;
    }

    address public drawOperator;
    VrfConfig public vrfConfig;
    bytes32 public ledgerHash;
    string public ledgerUri;
    uint256 public totalTickets;
    uint256 public prizeSlotCount;
    uint256 public requestId;
    uint256 public randomWord;
    DrawState public state;

    uint256[] private s_winnerTickets;

    event DrawOperatorChanged(address indexed operator);
    event VrfConfigUpdated(
        bytes32 indexed keyHash,
        uint256 indexed subscriptionId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        bool nativePayment
    );
    event LedgerFinalized(bytes32 indexed ledgerHash, uint256 totalTickets, uint256 prizeSlotCount, string ledgerUri);
    event DrawRequested(uint256 indexed requestId, address indexed caller);
    event DrawFulfilled(uint256 indexed requestId, uint256 randomWord, uint256[] winnerTickets);
    event RoundReset();

    error NotDrawOperator();
    error InvalidAddress();
    error InvalidState();
    error InvalidLedger();
    error InvalidPrizeSlots();
    error InvalidRequest();
    error InvalidVrfConfig();

    modifier onlyDrawOperator() {
        if (msg.sender != owner() && msg.sender != drawOperator) revert NotDrawOperator();
        _;
    }

    constructor(
        address vrfCoordinator,
        bytes32 keyHash,
        uint256 subscriptionId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        bool nativePayment,
        uint256 initialPrizeSlotCount
    ) VRFConsumerBaseV2Plus(vrfCoordinator) {
        drawOperator = msg.sender;
        _setVrfConfig(keyHash, subscriptionId, requestConfirmations, callbackGasLimit, nativePayment);
        _setPrizeSlotCount(initialPrizeSlotCount);
        emit DrawOperatorChanged(msg.sender);
    }

    function setDrawOperator(address operator) external onlyOwner {
        if (operator == address(0)) revert InvalidAddress();
        drawOperator = operator;
        emit DrawOperatorChanged(operator);
    }

    function setVrfConfig(
        bytes32 keyHash,
        uint256 subscriptionId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        bool nativePayment
    ) external onlyOwner {
        if (state == DrawState.RandomnessRequested) revert InvalidState();
        _setVrfConfig(keyHash, subscriptionId, requestConfirmations, callbackGasLimit, nativePayment);
    }

    function finalizeLedger(
        bytes32 newLedgerHash,
        uint256 newTotalTickets,
        uint256 newPrizeSlotCount,
        string calldata newLedgerUri
    ) external onlyOwner {
        if (state != DrawState.Draft && state != DrawState.LedgerFinalized) revert InvalidState();
        if (newLedgerHash == bytes32(0) || newTotalTickets == 0) revert InvalidLedger();
        _setPrizeSlotCount(newPrizeSlotCount);
        if (newTotalTickets < newPrizeSlotCount) revert InvalidPrizeSlots();

        delete s_winnerTickets;
        ledgerHash = newLedgerHash;
        totalTickets = newTotalTickets;
        ledgerUri = newLedgerUri;
        randomWord = 0;
        requestId = 0;
        state = DrawState.LedgerFinalized;
        emit LedgerFinalized(newLedgerHash, newTotalTickets, newPrizeSlotCount, newLedgerUri);
    }

    function resetDraft() external onlyOwner {
        if (state == DrawState.RandomnessRequested) revert InvalidState();
        delete s_winnerTickets;
        ledgerHash = bytes32(0);
        ledgerUri = "";
        totalTickets = 0;
        requestId = 0;
        randomWord = 0;
        state = DrawState.Draft;
        emit RoundReset();
    }

    function requestDraw() external onlyDrawOperator returns (uint256 newRequestId) {
        if (state != DrawState.LedgerFinalized) revert InvalidState();
        VrfConfig memory config = vrfConfig;
        if (config.keyHash == bytes32(0) || config.subscriptionId == 0 || config.callbackGasLimit == 0) {
            revert InvalidVrfConfig();
        }

        VRFV2PlusClient.RandomWordsRequest memory req = VRFV2PlusClient.RandomWordsRequest({
            keyHash: config.keyHash,
            subId: config.subscriptionId,
            requestConfirmations: config.requestConfirmations,
            callbackGasLimit: config.callbackGasLimit,
            numWords: 1,
            extraArgs: VRFV2PlusClient._argsToBytes(
                VRFV2PlusClient.ExtraArgsV1({nativePayment: config.nativePayment})
            )
        });

        newRequestId = s_vrfCoordinator.requestRandomWords(req);
        requestId = newRequestId;
        state = DrawState.RandomnessRequested;
        emit DrawRequested(newRequestId, msg.sender);
    }

    function fulfillRandomWords(uint256 fulfilledRequestId, uint256[] calldata randomWords) internal override {
        if (state != DrawState.RandomnessRequested || fulfilledRequestId != requestId) revert InvalidRequest();
        if (randomWords.length == 0) revert InvalidRequest();

        randomWord = randomWords[0];
        delete s_winnerTickets;

        for (uint256 index = 0; index < prizeSlotCount; index++) {
            s_winnerTickets.push(_drawUniqueTicket(randomWords[0], index));
        }

        state = DrawState.Fulfilled;
        emit DrawFulfilled(fulfilledRequestId, randomWords[0], s_winnerTickets);
    }

    function winnerTickets() external view returns (uint256[] memory) {
        return s_winnerTickets;
    }

    function winnerTicket(uint256 index) external view returns (uint256) {
        return s_winnerTickets[index];
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
            s_winnerTickets.length > 0 ? s_winnerTickets[0] : 0,
            ledgerHash,
            prizeSlotCount,
            s_winnerTickets.length
        );
    }

    function _setVrfConfig(
        bytes32 keyHash,
        uint256 subscriptionId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        bool nativePayment
    ) internal {
        if (keyHash == bytes32(0) || subscriptionId == 0 || callbackGasLimit == 0) revert InvalidVrfConfig();
        vrfConfig = VrfConfig({
            keyHash: keyHash,
            subscriptionId: subscriptionId,
            requestConfirmations: requestConfirmations,
            callbackGasLimit: callbackGasLimit,
            nativePayment: nativePayment
        });
        emit VrfConfigUpdated(keyHash, subscriptionId, requestConfirmations, callbackGasLimit, nativePayment);
    }

    function _setPrizeSlotCount(uint256 newPrizeSlotCount) internal {
        if (newPrizeSlotCount == 0 || newPrizeSlotCount > 256) revert InvalidPrizeSlots();
        prizeSlotCount = newPrizeSlotCount;
    }

    function _drawUniqueTicket(uint256 seed, uint256 slotIndex) internal view returns (uint256) {
        uint256 nonce = 0;
        while (nonce < totalTickets) {
            uint256 candidate = (uint256(keccak256(abi.encode(seed, slotIndex, nonce))) % totalTickets) + 1;
            bool duplicate = false;
            for (uint256 existingIndex = 0; existingIndex < s_winnerTickets.length; existingIndex++) {
                if (s_winnerTickets[existingIndex] == candidate) {
                    duplicate = true;
                    break;
                }
            }
            if (!duplicate) return candidate;
            nonce++;
        }
        revert InvalidPrizeSlots();
    }
}
