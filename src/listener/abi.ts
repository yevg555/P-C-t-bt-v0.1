/**
 * Minimal ABI for Polymarket CTF Exchange contracts
 * Only includes the OrderFilled event required for trade tracking.
 */

export const CTF_EXCHANGE_ABI = [
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "bytes32", "name": "orderHash", "type": "bytes32" },
      { "indexed": true, "internalType": "address", "name": "maker", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "taker", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "makerAssetId", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "takerAssetId", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "makerAmountFilled", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "takerAmountFilled", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "fee", "type": "uint256" }
    ],
    "name": "OrderFilled",
    "type": "event"
  }
] as const;

// Polymarket CTF Exchange (Legacy / Binary markets)
export const CTF_EXCHANGE_ADDRESS = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";

// Polymarket Neg Risk CTF Exchange (Current / Multi-outcome markets)
export const NEG_RISK_CTF_EXCHANGE_ADDRESS = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
