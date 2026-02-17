import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import type { TRPCContext } from "../context.js";
import type { BusEvent } from "@holms/shared";

const t = initTRPC.context<TRPCContext>().create();

// In-memory ring buffer for recent events
const MAX_EVENTS = 200;
const eventLog: BusEvent[] = [];

export function pushEventLog(event: BusEvent): void {
  eventLog.push(event);
  if (eventLog.length > MAX_EVENTS) {
    eventLog.shift();
  }
}

export const eventsRouter = t.router({
  recent: t.procedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }).optional())
    .query(({ input }) => {
      const limit = input?.limit ?? 50;
      return eventLog.slice(-limit);
    }),

  onEvent: t.procedure.subscription(({ ctx }) => {
    return observable<BusEvent>((emit) => {
      const handlers: Array<() => void> = [];

      const deviceHandler = (data: unknown) => {
        const event: BusEvent = { type: "device:event", data: data as Record<string, unknown>, timestamp: Date.now() };
        pushEventLog(event);
        emit.next(event);
      };
      ctx.eventBus.on("device:event", deviceHandler);
      handlers.push(() => ctx.eventBus.off("device:event", deviceHandler));

      const thinkingHandler = (data: { prompt: string; timestamp: number }) => {
        const event: BusEvent = { type: "agent:thinking", data: data as unknown as Record<string, unknown>, timestamp: data.timestamp };
        pushEventLog(event);
        emit.next(event);
      };
      ctx.eventBus.on("agent:thinking", thinkingHandler);
      handlers.push(() => ctx.eventBus.off("agent:thinking", thinkingHandler));

      const toolHandler = (data: { tool: string; input: unknown; timestamp: number }) => {
        const event: BusEvent = { type: "agent:tool_use", data: data as unknown as Record<string, unknown>, timestamp: data.timestamp };
        pushEventLog(event);
        emit.next(event);
      };
      ctx.eventBus.on("agent:tool_use", toolHandler);
      handlers.push(() => ctx.eventBus.off("agent:tool_use", toolHandler));

      const resultHandler = (data: { result: string; cost: number; timestamp: number }) => {
        const event: BusEvent = { type: "agent:result", data: data as unknown as Record<string, unknown>, timestamp: data.timestamp };
        pushEventLog(event);
        emit.next(event);
      };
      ctx.eventBus.on("agent:result", resultHandler);
      handlers.push(() => ctx.eventBus.off("agent:result", resultHandler));

      const reflexHandler = (data: unknown) => {
        const event: BusEvent = { type: "reflex:triggered", data: data as Record<string, unknown>, timestamp: Date.now() };
        pushEventLog(event);
        emit.next(event);
      };
      ctx.eventBus.on("reflex:triggered", reflexHandler);
      handlers.push(() => ctx.eventBus.off("reflex:triggered", reflexHandler));

      return () => handlers.forEach((h) => h());
    });
  }),
});
