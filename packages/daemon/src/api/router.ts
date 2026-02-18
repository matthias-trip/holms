import { initTRPC } from "@trpc/server";
import type { TRPCContext } from "./context.js";
import { devicesRouter } from "./routers/devices.js";
import { eventsRouter } from "./routers/events.js";
import { memoryRouter } from "./routers/memory.js";
import { reflexRouter } from "./routers/reflex.js";
import { chatRouter } from "./routers/chat.js";
import { approvalRouter } from "./routers/approval.js";
import { scheduleRouter } from "./routers/schedule.js";
import { agentsRouter } from "./routers/agents.js";
import { pluginsRouter } from "./routers/plugins.js";

const t = initTRPC.context<TRPCContext>().create();

export const appRouter = t.router({
  devices: devicesRouter,
  events: eventsRouter,
  memory: memoryRouter,
  reflex: reflexRouter,
  chat: chatRouter,
  approval: approvalRouter,
  schedule: scheduleRouter,
  agents: agentsRouter,
  plugins: pluginsRouter,
});

export type AppRouter = typeof appRouter;
