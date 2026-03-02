import { createTRPCReact } from "@trpc/react-query";
import {
  httpBatchLink,
  httpLink,
  splitLink,
  wsLink,
  createWSClient,
} from "@trpc/client";
import type { AppRouter } from "../../daemon/src/api/router.js";

export const trpc = createTRPCReact<AppRouter>();

const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const httpUrl = `${window.location.origin}/trpc`;

/**
 * Create a tRPC client bound to a specific access token.
 * Call this only after authentication so the WS connection starts with a valid token.
 */
export function createTrpcClient(getAccessToken: () => string | null) {
  function getAuthHeaders(): Record<string, string> {
    const token = getAccessToken();
    if (token) return { Authorization: `Bearer ${token}` };
    return {};
  }

  function makeWsUrl(): string {
    const token = getAccessToken();
    const base = `${wsProtocol}//${window.location.host}/trpc`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  }

  const wsClient = createWSClient({ url: makeWsUrl });

  const client = trpc.createClient({
    links: [
      splitLink({
        condition: (op) => op.type === "subscription",
        true: wsLink({ client: wsClient }),
        false: splitLink({
          // Route slow AI-generated queries to non-batching link
          condition: (op) => op.path === "chat.suggestions",
          true: httpLink({ url: httpUrl, headers: getAuthHeaders }),
          false: httpBatchLink({ url: httpUrl, headers: getAuthHeaders }),
        }),
      }),
    ],
  });

  return { client, close: () => wsClient.close() };
}
