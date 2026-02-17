import { loadConfig } from "./config.js";
import { EventBus } from "./event-bus.js";
import { MemoryStore } from "./memory/store.js";
import { ReflexStore } from "./reflex/store.js";
import { ReflexEngine } from "./reflex/engine.js";
import { DeviceManager } from "./devices/manager.js";
import { DummyProvider } from "./devices/providers/dummy.js";
import { ApprovalQueue } from "./coordinator/approval-queue.js";
import { OutcomeObserver } from "./coordinator/outcome-observer.js";
import { Coordinator } from "./coordinator/coordinator.js";
import { ProactiveScheduler } from "./scheduler/proactive.js";
import { SpecialistRegistry } from "./specialists/registry.js";
import { startApiServer } from "./api/server.js";

async function main() {
  console.log("🏠 Holms — AI-Driven Home Automation");
  console.log("=====================================\n");

  // 1. Load config
  const config = loadConfig();

  // 2. Init EventBus
  const eventBus = new EventBus();

  // 3. Init stores
  const memoryStore = new MemoryStore(config.dbPath);
  const reflexStore = new ReflexStore(config.dbPath);
  console.log(`[Init] Stores initialized (${config.dbPath})`);

  // 4. Init DeviceManager + DummyProvider
  const deviceManager = new DeviceManager();
  const dummyProvider = new DummyProvider();
  deviceManager.registerProvider(dummyProvider);

  // 5. Init ReflexEngine
  const reflexEngine = new ReflexEngine(reflexStore, deviceManager, eventBus);

  // 6. Init ApprovalQueue
  const approvalQueue = new ApprovalQueue(deviceManager, eventBus);

  // 7. Init OutcomeObserver
  const outcomeObserver = new OutcomeObserver(
    eventBus,
    config.coordinator.observationWindowMs,
  );

  // 8. Init SpecialistRegistry
  const specialistRegistry = new SpecialistRegistry();

  // 9. Init Coordinator
  const coordinator = new Coordinator(
    eventBus,
    deviceManager,
    memoryStore,
    reflexStore,
    approvalQueue,
    outcomeObserver,
    config,
  );

  // 10. Init ProactiveScheduler
  const scheduler = new ProactiveScheduler(
    coordinator,
    deviceManager,
    memoryStore,
    config,
  );

  // 11. Connect all devices
  await deviceManager.connectAll();

  // 12. Wire event flow
  deviceManager.onEvent((event) => {
    // Broadcast to event bus
    eventBus.emit("device:event", event);

    // Reflex engine (sub-second local rules)
    reflexEngine.processEvent(event).catch(console.error);

    // Check for outcome reversals
    const feedback = outcomeObserver.processEvent(event);
    if (feedback) {
      coordinator.handleOutcomeFeedback(feedback).catch(console.error);
    }

    // Queue for coordinator (batched)
    coordinator.enqueueEvent(event);
  });

  // Wire approval results back to coordinator
  eventBus.on("approval:resolved", (data) => {
    coordinator
      .handleApprovalResult(data.id, data.approved, data.reason)
      .catch(console.error);
  });

  // 13. Start tRPC API server
  const apiServer = startApiServer(
    {
      deviceManager,
      memoryStore,
      reflexStore,
      coordinator,
      approvalQueue,
      eventBus,
    },
    config.apiPort,
  );

  // 14. Start ProactiveScheduler
  scheduler.start();

  console.log(`\n✅ Holms running — API on port ${config.apiPort}`);
  console.log("   Frontend: http://localhost:5173");
  console.log("   Press Ctrl+C to stop\n");

  // 15. Graceful shutdown
  const shutdown = async () => {
    console.log("\n\nShutting down...");
    scheduler.stop();
    apiServer.close();
    await deviceManager.disconnectAll();
    memoryStore.close();
    reflexStore.close();
    console.log("Goodbye!");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
