import { v4 as uuid } from "uuid";
import { loadConfig } from "./config.js";
import { EventBus } from "./event-bus.js";
import { MemoryStore } from "./memory/store.js";
import { ReflexStore } from "./reflex/store.js";
import { ChatStore } from "./chat/store.js";
import { ActivityStore } from "./activity/store.js";
import { ReflexEngine } from "./reflex/engine.js";
import { DeviceManager } from "./devices/manager.js";
import { DummyProvider } from "./devices/providers/dummy.js";
import { ApprovalQueue } from "./coordinator/approval-queue.js";
import { OutcomeObserver } from "./coordinator/outcome-observer.js";
import { CoordinatorHub } from "./coordinator/coordinator-hub.js";
import { ProactiveScheduler } from "./scheduler/proactive.js";
import { ScheduleStore } from "./schedule/store.js";
import { TriageStore } from "./triage/store.js";
import { TriageEngine } from "./triage/engine.js";
import { PluginManager } from "./plugins/manager.js";
import { ChannelManager } from "./channels/manager.js";
import { WebProvider } from "./channels/web-provider.js";
import { startApiServer } from "./api/server.js";
import { initActivityPersistence } from "./api/routers/chat.js";

async function main() {
  console.log("🏠 Holms — AI-Driven Home Automation");
  console.log("=====================================\n");

  // 1. Load config
  const config = loadConfig();

  // 2. Init EventBus
  const eventBus = new EventBus();

  // 3. Init stores
  const memoryStore = await MemoryStore.create(config.dbPath, config.hfCacheDir);
  const reflexStore = new ReflexStore(config.dbPath);
  const chatStore = new ChatStore(config.dbPath);
  const activityStore = new ActivityStore(config.dbPath);
  const scheduleStore = new ScheduleStore(config.dbPath);
  const triageStore = new TriageStore(config.dbPath);
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

  // 7b. Init PluginManager
  const pluginManager = new PluginManager(config.builtinPluginsDir, config.pluginsDir, config.pluginsStatePath);

  // 8. Init CoordinatorHub (replaces single Coordinator)
  const hub = new CoordinatorHub(
    eventBus,
    deviceManager,
    memoryStore,
    reflexStore,
    approvalQueue,
    config,
    scheduleStore,
    triageStore,
    pluginManager,
  );

  // 9. Init ChannelManager + register WebProvider
  const channelManager = new ChannelManager(eventBus, chatStore, hub);
  await channelManager.register(new WebProvider());

  // 9b. Init TriageEngine
  const triageEngine = new TriageEngine(triageStore, eventBus, deviceManager, config);

  // Register command echo listener
  deviceManager.onCommandExecuted((deviceId, command) => {
    triageEngine.expectCommandEcho(deviceId, command);
  });

  // Start batch ticker (flushes batched events to coordinator)
  triageEngine.startBatchTicker((events) => {
    for (const event of events) {
      hub.enqueueEvent(event);
    }
  });

  // 10. Init ProactiveScheduler
  const scheduler = new ProactiveScheduler(
    hub,
    deviceManager,
    memoryStore,
    config,
    scheduleStore,
    eventBus,
  );

  // 11. Connect all devices
  await deviceManager.connectAll();

  // 12. Wire event flow
  deviceManager.onEvent((event) => {
    // Broadcast to event bus (frontend gets all events)
    eventBus.emit("device:event", event);

    // Reflex engine (sub-second local rules)
    reflexEngine.processEvent(event).catch(console.error);

    // Check for outcome reversals
    const feedback = outcomeObserver.processEvent(event);
    if (feedback) {
      hub.handleOutcomeFeedback(feedback).catch(console.error);
    }

    // Triage: classify event into immediate / batched / silent
    const lane = triageEngine.classify(event);
    if (lane === "immediate") {
      hub.enqueueEvent(event);
    }
    // "batched" → already buffered inside triageEngine, flushed on periodic tick
    // "silent" → nothing, state is already updated by provider
  });

  // Wire schedule:fired flow
  eventBus.on("schedule:fired", async (data) => {
    const { schedule } = data;

    // ReflexEngine gets first crack — instant execution
    const handled = await reflexEngine.processScheduleEvent(schedule).catch((err) => {
      console.error("[Schedule] Reflex processing error:", err);
      return false;
    });

    // If no reflex matched, coordinator reasons about it
    if (!handled) {
      const context = `Schedule "${schedule.id}" fired.\nInstruction: ${schedule.instruction}\nRecurrence: ${schedule.recurrence}`;
      hub.handleProactiveWakeup("schedule", context).catch(console.error);
    }
  });

  // Approval results are fed back to the coordinator from the approval router
  // (which also posts the response to chat), so no duplicate wiring here.

  // 12a. Persist approval proposals as chat messages (resolution handled in approval router)
  eventBus.on("approval:pending", (data) => {
    const channel = hub.getApprovalChannel(data.id);
    chatStore.add({
      id: uuid(),
      role: "assistant",
      content: JSON.stringify({
        approvalId: data.id,
        deviceId: data.deviceId,
        command: data.command,
        params: data.params,
        reason: data.reason,
      }),
      timestamp: data.createdAt,
      status: "approval_pending",
      approvalId: data.id,
      channel,
    });
  });

  // 12b. Init activity persistence (stores agent events to DB + re-emits on activity:stored)
  initActivityPersistence(eventBus, activityStore, hub);

  // 13. Start tRPC API server
  const apiServer = startApiServer(
    {
      deviceManager,
      memoryStore,
      reflexStore,
      chatStore,
      activityStore,
      hub,
      approvalQueue,
      eventBus,
      scheduleStore,
      scheduler,
      pluginManager,
      channelManager,
      config,
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
    await channelManager.stopAll();
    scheduler.stop();
    triageEngine.stopBatchTicker();
    apiServer.close();
    await deviceManager.disconnectAll();
    memoryStore.close();
    reflexStore.close();
    chatStore.close();
    activityStore.close();
    scheduleStore.close();
    triageStore.close();
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
