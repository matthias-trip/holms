import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import type { TRPCContext } from "../context.js";

export interface ImportProgress {
  deviceId: string;
  phase: "fetching" | "processing" | "deleting" | "inserting" | "cataloging" | "done" | "error";
  processed: number;
  total: number;
  message?: string;
}

const t = initTRPC.context<TRPCContext>().create();

export const historyRouter = t.router({
  importFromHA: t.procedure
    .input(z.object({
      deviceId: z.string(),
      days: z.number().min(1).max(365),
      resolution: z.string().regex(/^\d+[smh]$/).optional().default("1m"),
    }))
    .mutation(async () => {
      // TODO: Reimplement via Habitat's history import capabilities
      throw new Error("HA history import has been removed during Habitat migration. Use Habitat's native history capabilities.");
    }),

  onImportProgress: t.procedure
    .input(z.object({ deviceId: z.string() }))
    .subscription(({ ctx, input }) => {
      return observable<ImportProgress>((emit) => {
        const handler = (data: { deviceId: string; phase: string; processed: number; total: number; message?: string }) => {
          if (data.deviceId === input.deviceId) {
            emit.next(data as ImportProgress);
          }
        };
        ctx.eventBus.on("history:import_progress", handler);
        return () => ctx.eventBus.off("history:import_progress", handler);
      });
    }),
});
