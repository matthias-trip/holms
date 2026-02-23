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
const wsUrl = `${wsProtocol}//${window.location.host}/trpc`;
const httpUrl = `${window.location.origin}/trpc`;

const wsClient = createWSClient({
  url: wsUrl,
});

export const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: (op) => op.type === "subscription",
      true: wsLink({ client: wsClient }),
      false: splitLink({
        // Route slow AI-generated queries to non-batching link
        condition: (op) => op.path === "chat.suggestions",
        true: httpLink({ url: httpUrl }),
        false: httpBatchLink({ url: httpUrl }),
      }),
    }),
  ],
});
