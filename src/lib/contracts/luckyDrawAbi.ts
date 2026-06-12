import { DRAW_NETWORKS } from './luckyDrawNetworks'

export const luckyDrawContractAddress = DRAW_NETWORKS.mainnet.contractAddress

export const luckyDrawAbi = [
  'function finalizeLedger(bytes32 ledgerHash, uint256 totalTickets, uint256 prizeSlotCount, string ledgerUri) external',
  'function requestDraw() external returns (uint256 requestId)',
  'function drawNext() external returns (uint256 ticketNumber)',
  'function drawBatch(uint256 count) external returns (uint256[] memory ticketNumbers)',
  'function drawPrizeSlot(uint256 prizeSlotIndex) external returns (uint256 ticketNumber)',
  'function drawPrizeSlots(uint256[] calldata prizeSlotIndexes) external returns (uint256[] memory ticketNumbers)',
  'function drawRandomPrizeSlot() external returns (uint256 prizeSlotIndex, uint256 ticketNumber)',
  'function resetDraft() external',
  'function owner() external view returns (address)',
  'function drawOperator() external view returns (address)',
  'function isAdmin(address account) external view returns (bool)',
  'function vrfCoordinatorAddress() external view returns (address)',
  'function vrfConfig() external view returns (bytes32 keyHash, uint64 subscriptionId, uint16 requestConfirmations, uint32 callbackGasLimit)',
  'function state() external view returns (uint8)',
  'function roundStatus() external view returns (bool finalized, bool requested, bool fulfilled, uint256 totalTickets, uint256 firstWinningTicket, bytes32 ledgerHash, uint256 prizeSlotCount, uint256 winnerCount)',
  'function winnerTickets() external view returns (uint256[] memory)',
  'function revealedPrizeSlots() external view returns (uint256[] memory)',
  'function revealedTickets() external view returns (uint256[] memory)',
  'function winnerTicketsBySlot() external view returns (uint256[] memory)',
  'function winnerTicketBySlot(uint256 prizeSlotIndex) external view returns (uint256)',
  'event DrawRequested(uint256 indexed requestId, address indexed caller)',
  'event RandomnessFulfilled(uint256 indexed requestId, uint256 randomWord)',
  'event WinnerDrawn(uint256 indexed slotIndex, uint256 ticketNumber)',
  'event PrizeWinnerDrawn(uint256 indexed revealIndex, uint256 indexed prizeSlotIndex, uint256 ticketNumber)',
  'event DrawFulfilled(uint256 indexed requestId, uint256 randomWord, uint256[] winnerTickets)',
] as const
