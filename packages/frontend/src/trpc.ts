import { createTRPCReact } from "@trpc/react-query";
import {
  httpBatchLink,
  splitLink,
  wsLink,
  createWSClient,
} from "@trpc/client";
import type { AppRouter } from "../../daemon/src/api/router.js";

export const trpc = createTRPCReact<AppRouter>();

const wsClient = createWSClient({
  url: `ws://localhost:3100`,
});

export const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: (op) => op.type === "subscription",
      true: wsLink({ client: wsClient }),
      false: httpBatchLink({ url: "http://localhost:3100" }),
    }),
  ],
});
