import { DRAW_NETWORKS } from './luckyDrawNetworks'

export const luckyDrawContractAddress = DRAW_NETWORKS.mainnet.contractAddress

export const luckyDrawAbi = [
  'function requestDraw() external returns (uint256 requestId)',
  'function drawNext() external returns (uint256 ticketNumber)',
  'function roundStatus() external view returns (bool finalized, bool requested, bool fulfilled, uint256 totalTickets, uint256 firstWinningTicket, bytes32 ledgerHash, uint256 prizeSlotCount, uint256 winnerCount)',
  'function winnerTickets() external view returns (uint256[] memory)',
  'event DrawRequested(uint256 indexed requestId, address indexed caller)',
  'event RandomnessFulfilled(uint256 indexed requestId, uint256 randomWord)',
  'event WinnerDrawn(uint256 indexed slotIndex, uint256 ticketNumber)',
  'event DrawFulfilled(uint256 indexed requestId, uint256 randomWord, uint256[] winnerTickets)',
] as const
