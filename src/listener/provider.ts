import { createPublicClient, webSocket, PublicClient } from 'viem';
import { polygon } from 'viem/chains';

/**
 * Create a Viem Public Client with WebSocket transport.
 * Configured for auto-reconnection to handle network drops.
 *
 * @param rpcUrl - WebSocket RPC URL (must start with wss://)
 */
export function createViemClient(rpcUrl: string): PublicClient {
  if (!rpcUrl.startsWith('wss://') && !rpcUrl.startsWith('ws://')) {
    throw new Error(`Invalid RPC URL: ${rpcUrl}. Must be a WebSocket URL (wss:// or ws://)`);
  }

  return createPublicClient({
    chain: polygon,
    transport: webSocket(rpcUrl, {
      reconnect: {
        delay: 1000,
        attempts: Number.MAX_SAFE_INTEGER, // Infinite reconnects
      },
      timeout: 30000,
    }),
  });
}
