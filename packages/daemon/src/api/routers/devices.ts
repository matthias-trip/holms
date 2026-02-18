import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import type { TRPCContext } from "../context.js";
import type { DeviceEvent } from "@holms/shared";

const t = initTRPC.context<TRPCContext>().create();

export const devicesRouter = t.router({
  list: t.procedure.query(async ({ ctx }) => {
    return ctx.deviceManager.getAllDevices();
  }),

  get: t.procedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.deviceManager.getDevice(input.id);
    }),

  command: t.procedure
    .input(
      z.object({
        deviceId: z.string(),
        command: z.string(),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.deviceManager.executeCommand(
        input.deviceId,
        input.command,
        input.params ?? {},
      );
    }),

  onEvent: t.procedure.subscription(({ ctx }) => {
    return observable<DeviceEvent>((emit) => {
      const handler = (event: DeviceEvent) => {
        emit.next(event);
      };
      ctx.eventBus.on("device:event", handler);
      return () => ctx.eventBus.off("device:event", handler);
    });
  }),
});
