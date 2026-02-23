import { initTRPC } from "@trpc/server";
import type { TRPCContext } from "./context.js";
import { devicesRouter } from "./routers/devices.js";
import { eventsRouter } from "./routers/events.js";
import { memoryRouter } from "./routers/memory.js";
import { reflexRouter } from "./routers/reflex.js";
import { chatRouter } from "./routers/chat.js";
import { approvalRouter } from "./routers/approval.js";
import { automationRouter } from "./routers/automation.js";
import { agentsRouter } from "./routers/agents.js";
import { pluginsRouter } from "./routers/plugins.js";
import { channelsRouter } from "./routers/channels.js";
import { deviceProvidersRouter } from "./routers/device-providers.js";
import { peopleRouter } from "./routers/people.js";
import { triageRouter } from "./routers/triage.js";
import { goalsRouter } from "./routers/goals.js";
import { historyRouter } from "./routers/history.js";
import { systemRouter } from "./routers/system.js";

const t = initTRPC.context<TRPCContext>().create();

export const appRouter = t.router({
  devices: devicesRouter,
  events: eventsRouter,
  memory: memoryRouter,
  reflex: reflexRouter,
  chat: chatRouter,
  approval: approvalRouter,
  automation: automationRouter,
  agents: agentsRouter,
  plugins: pluginsRouter,
  channels: channelsRouter,
  deviceProviders: deviceProvidersRouter,
  people: peopleRouter,
  triage: triageRouter,
  goals: goalsRouter,
  history: historyRouter,
  system: systemRouter,
});

export type AppRouter = typeof appRouter;
