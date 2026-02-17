import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import type { TRPCContext } from "../context.js";
import type { AgentActivity } from "@holms/shared";
import { v4 as uuid } from "uuid";

const t = initTRPC.context<TRPCContext>().create();

export const chatRouter = t.router({
  send: t.procedure
    .input(z.object({ message: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.coordinator.handleUserRequest(input.message);
      return { id: uuid(), role: "assistant" as const, content: result, timestamp: Date.now() };
    }),

  onActivity: t.procedure.subscription(({ ctx }) => {
    return observable<AgentActivity>((emit) => {
      const handlers: Array<() => void> = [];

      const thinkingHandler = (data: { prompt: string; timestamp: number }) => {
        emit.next({
          id: uuid(),
          type: "thinking",
          data: { prompt: data.prompt },
          timestamp: data.timestamp,
        });
      };
      ctx.eventBus.on("agent:thinking", thinkingHandler);
      handlers.push(() => ctx.eventBus.off("agent:thinking", thinkingHandler));

      const toolHandler = (data: { tool: string; input: unknown; timestamp: number }) => {
        emit.next({
          id: uuid(),
          type: "tool_use",
          data: { tool: data.tool, input: data.input },
          timestamp: data.timestamp,
        });
      };
      ctx.eventBus.on("agent:tool_use", toolHandler);
      handlers.push(() => ctx.eventBus.off("agent:tool_use", toolHandler));

      const resultHandler = (data: { result: string; cost: number; timestamp: number }) => {
        emit.next({
          id: uuid(),
          type: "result",
          data: { result: data.result, cost: data.cost },
          timestamp: data.timestamp,
        });
      };
      ctx.eventBus.on("agent:result", resultHandler);
      handlers.push(() => ctx.eventBus.off("agent:result", resultHandler));

      const reflectionHandler = (data: { insight: string; timestamp: number }) => {
        emit.next({
          id: uuid(),
          type: "reflection",
          data: { insight: data.insight },
          timestamp: data.timestamp,
        });
      };
      ctx.eventBus.on("agent:reflection", reflectionHandler);
      handlers.push(() => ctx.eventBus.off("agent:reflection", reflectionHandler));

      const outcomeHandler = (data: { action: string; feedback: string; timestamp: number }) => {
        emit.next({
          id: uuid(),
          type: "outcome",
          data: { action: data.action, feedback: data.feedback },
          timestamp: data.timestamp,
        });
      };
      ctx.eventBus.on("agent:outcome", outcomeHandler);
      handlers.push(() => ctx.eventBus.off("agent:outcome", outcomeHandler));

      return () => handlers.forEach((h) => h());
    });
  }),
});
