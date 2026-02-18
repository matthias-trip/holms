import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import type { TRPCContext } from "../context.js";
import type { BusEvent, TriageLane } from "@holms/shared";
import type { EventBus } from "../../event-bus.js";
import type { ActivityStore } from "../../activity/store.js";

const t = initTRPC.context<TRPCContext>().create();

/**
 * Register a single set of event bus listeners that persist events to the DB.
 * Call this once at server startup, not per-subscriber.
 */
export function initEventPersistence(eventBus: EventBus, activityStore: ActivityStore): void {
  eventBus.on("device:event", (data: unknown) => {
    activityStore.addEvent({ type: "device:event", data: data as Record<string, unknown>, timestamp: Date.now() });
  });
  eventBus.on("agent:thinking", (data: { prompt: string; timestamp: number }) => {
    activityStore.addEvent({ type: "agent:thinking", data: data as unknown as Record<string, unknown>, timestamp: data.timestamp });
  });
  eventBus.on("agent:tool_use", (data: { tool: string; input: unknown; timestamp: number }) => {
    activityStore.addEvent({ type: "agent:tool_use", data: data as unknown as Record<string, unknown>, timestamp: data.timestamp });
  });
  eventBus.on("agent:result", (data) => {
    activityStore.addEvent({ type: "agent:result", data: data as unknown as Record<string, unknown>, timestamp: data.timestamp });
  });
  eventBus.on("reflex:triggered", (data: unknown) => {
    activityStore.addEvent({ type: "reflex:triggered", data: data as Record<string, unknown>, timestamp: Date.now() });
  });
}

export const eventsRouter = t.router({
  recent: t.procedure
    .input(z.object({ limit: z.number().min(1).max(500).default(200) }).optional())
    .query(({ ctx, input }) => {
      const limit = input?.limit ?? 200;
      return ctx.activityStore.getEvents(limit);
    }),

  onEvent: t.procedure.subscription(({ ctx }) => {
    return observable<BusEvent>((emit) => {
      const handlers: Array<() => void> = [];

      const deviceHandler = (data: unknown) => {
        emit.next({ type: "device:event", data: data as Record<string, unknown>, timestamp: Date.now() });
      };
      ctx.eventBus.on("device:event", deviceHandler);
      handlers.push(() => ctx.eventBus.off("device:event", deviceHandler));

      const thinkingHandler = (data: { prompt: string; timestamp: number }) => {
        emit.next({ type: "agent:thinking", data: data as unknown as Record<string, unknown>, timestamp: data.timestamp });
      };
      ctx.eventBus.on("agent:thinking", thinkingHandler);
      handlers.push(() => ctx.eventBus.off("agent:thinking", thinkingHandler));

      const toolHandler = (data: { tool: string; input: unknown; timestamp: number }) => {
        emit.next({ type: "agent:tool_use", data: data as unknown as Record<string, unknown>, timestamp: data.timestamp });
      };
      ctx.eventBus.on("agent:tool_use", toolHandler);
      handlers.push(() => ctx.eventBus.off("agent:tool_use", toolHandler));

      const resultHandler = (data: Parameters<import("../../event-bus.js").EventBusEvents["agent:result"]>[0]) => {
        emit.next({ type: "agent:result", data: data as unknown as Record<string, unknown>, timestamp: data.timestamp });
      };
      ctx.eventBus.on("agent:result", resultHandler);
      handlers.push(() => ctx.eventBus.off("agent:result", resultHandler));

      const reflexHandler = (data: unknown) => {
        emit.next({ type: "reflex:triggered", data: data as Record<string, unknown>, timestamp: Date.now() });
      };
      ctx.eventBus.on("reflex:triggered", reflexHandler);
      handlers.push(() => ctx.eventBus.off("reflex:triggered", reflexHandler));

      return () => handlers.forEach((h) => h());
    });
  }),

  onTriageClassify: t.procedure.subscription(({ ctx }) => {
    return observable<{
      deviceId: string;
      eventType: string;
      lane: TriageLane;
      ruleId: string | null;
      reason: string;
      timestamp: number;
    }>((emit) => {
      const handler = (data: {
        deviceId: string;
        eventType: string;
        lane: TriageLane;
        ruleId: string | null;
        reason: string;
        timestamp: number;
      }) => {
        emit.next(data);
      };
      ctx.eventBus.on("agent:triage_classify", handler);
      return () => ctx.eventBus.off("agent:triage_classify", handler);
    });
  }),
});
