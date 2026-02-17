import { initTRPC } from "@trpc/server";
import type { TRPCContext } from "./context.js";
import { devicesRouter } from "./routers/devices.js";
import { eventsRouter } from "./routers/events.js";
import { memoryRouter } from "./routers/memory.js";
import { reflexRouter } from "./routers/reflex.js";
import { chatRouter } from "./routers/chat.js";
import { approvalRouter } from "./routers/approval.js";

const t = initTRPC.context<TRPCContext>().create();

export const appRouter = t.router({
  devices: devicesRouter,
  events: eventsRouter,
  memory: memoryRouter,
  reflex: reflexRouter,
  chat: chatRouter,
  approval: approvalRouter,
});

export type AppRouter = typeof appRouter;
