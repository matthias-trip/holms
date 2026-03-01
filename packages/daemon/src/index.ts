import Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { loadConfig } from "./config.js";
import { EventBus } from "./event-bus.js";
import { MemoryStore } from "./memory/store.js";
import { ReflexStore } from "./reflex/store.js";
import { ChatStore } from "./chat/store.js";
import { ActivityStore } from "./activity/store.js";
import { ReflexEngine } from "./reflex/engine.js";
import { Habitat } from "./habitat/habitat.js";
import { ApprovalQueue } from "./coordinator/approval-queue.js";
import { OutcomeObserver } from "./coordinator/outcome-observer.js";
import { CoordinatorHub } from "./coordinator/coordinator-hub.js";
import { McpServerPool } from "./coordinator/mcp-pool.js";
import { createHabitatToolsServer } from "./habitat/tools.js";
import { createMemoryToolsServer } from "./memory/tools.js";
import { createReflexToolsServer } from "./reflex/tools.js";
import { createApprovalToolsServer } from "./coordinator/approval-queue.js";
import { createAutomationToolsServer } from "./automation/tools.js";
import { createTriageToolsServer } from "./triage/tools.js";
import { createChannelToolsServer } from "./channels/tools.js";
import { createProgressToolsServer } from "./coordinator/progress-tools.js";
import { createAskUserToolsServer } from "./coordinator/ask-user-tools.js";
import { ProactiveScheduler } from "./scheduler/proactive.js";
import { createSchedulerToolsServer } from "./scheduler/tools.js";
import { AutomationStore } from "./automation/store.js";
import { AutomationMatcher } from "./automation/matcher.js";
import { TriageStore } from "./triage/store.js";
import { TriageEngine } from "./triage/engine.js";
import { PluginManager } from "./plugins/manager.js";
import { ChannelManager } from "./channels/manager.js";
import { ChannelStore } from "./channels/store.js";
import { WebProvider } from "./channels/providers/web-provider.js";
import { WebChannelDescriptor } from "./channels/providers/web-descriptor.js";
import { SlackChannelDescriptor } from "./channels/providers/slack-descriptor.js";
import { WhatsAppChannelDescriptor } from "./channels/providers/whatsapp-descriptor.js";
import { PeopleStore } from "./people/store.js";
import { createPeopleToolsServer } from "./people/tools.js";
import { GoalStore } from "./goals/store.js";
import { createGoalToolsServer } from "./goals/tools.js";
import { HistoryStore } from "./history/store.js";
import { HistoryIngestion } from "./history/ingestion.js";
import { createHistoryToolsServer } from "./history/tools.js";
import { SecretStore } from "./habitat/secret-store.js";
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
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const memoryStore = await MemoryStore.create(config.dbPath, config.hfCacheDir);
  const reflexStore = new ReflexStore(config.dbPath);
  const chatStore = new ChatStore(config.dbPath);
  const activityStore = new ActivityStore(config.dbPath);
  const automationStore = new AutomationStore(config.dbPath);
  const triageStore = new TriageStore(config.dbPath);
  const peopleStore = new PeopleStore(config.dbPath);
  const goalStore = new GoalStore(config.dbPath);
  const historyStore = await HistoryStore.create(config.history.dbPath);
  console.log(`[Init] Stores initialized (${config.dbPath})`);

  // 3b. Init SecretStore (encryption key lives next to DB)
  const { dirname, resolve } = await import("node:path");
  const secretKeyPath = resolve(dirname(config.dbPath), "secret.key");
  const secretStore = new SecretStore(db, secretKeyPath);
  console.log(`[Init] SecretStore initialized`);

  // 4a. Init PluginManager (needed before Habitat for adapter discovery)
  const pluginManager = new PluginManager(config.builtinPluginsDir, config.pluginsDir, config.pluginsStatePath);

  // 4. Init Habitat (replaces DeviceManager)
  const habitat = new Habitat(db, eventBus, pluginManager.getAdapterModules(), secretStore);

  const historyIngestion = new HistoryIngestion(historyStore, eventBus, config.history);

  // 5. Init ReflexEngine
  const reflexEngine = new ReflexEngine(reflexStore, habitat, eventBus);

  // 5b. Init AutomationMatcher
  const automationMatcher = new AutomationMatcher(automationStore);

  // 6. Init ApprovalQueue
  const approvalQueue = new ApprovalQueue(habitat, eventBus);

  // 7. Init OutcomeObserver
  const outcomeObserver = new OutcomeObserver(
    eventBus,
    config.coordinator.observationWindowMs,
  );

  // 8. Init MCP server pool + CoordinatorHub
  const mcpPool = new McpServerPool();
  mcpPool.register("habitat", () => createHabitatToolsServer(habitat, memoryStore, secretStore));
  mcpPool.register("memory", () => createMemoryToolsServer(memoryStore));
  mcpPool.register("reflex", () => createReflexToolsServer(reflexStore));
  mcpPool.register("approval", () => createApprovalToolsServer(approvalQueue));
  mcpPool.register("automation", () => createAutomationToolsServer(automationStore));
  mcpPool.register("triage", () => createTriageToolsServer(triageStore, activityStore));
  mcpPool.register("people", () => createPeopleToolsServer(peopleStore));
  mcpPool.register("goals", () => createGoalToolsServer(goalStore));
  mcpPool.register("history", () => createHistoryToolsServer(historyStore));

  const hub = new CoordinatorHub(
    eventBus,
    habitat,
    memoryStore,
    config,
    mcpPool,
    pluginManager,
    peopleStore,
    goalStore,
    activityStore,
  );

  // 9. Init ChannelStore + ChannelManager
  const channelStore = new ChannelStore(config.dbPath);
  const channelManager = new ChannelManager(eventBus, chatStore, hub, channelStore, approvalQueue, peopleStore);

  // Register channel tools after ChannelManager exists — pool is read at query time, not captured
  mcpPool.register("channel", () => createChannelToolsServer(channelManager));
  mcpPool.register("progress", () => createProgressToolsServer(channelManager));

  // 9a. Init ask_user MCP tool (non-blocking — persists question as chat message)
  mcpPool.register("ask_user", () => createAskUserToolsServer(chatStore, eventBus, channelManager));

  // Register channel descriptors
  channelManager.registerDescriptor(new WebChannelDescriptor());
  channelManager.registerDescriptor(new SlackChannelDescriptor());
  channelManager.registerDescriptor(new WhatsAppChannelDescriptor());

  // Always register web provider directly (special case — no config needed)
  await channelManager.register(new WebProvider());

  // Start user-configured channels from store
  await channelManager.startEnabledProviders();

  // 9b. Init TriageEngine
  const triageEngine = new TriageEngine(triageStore, eventBus, config);

  // Start batch ticker (flushes batched events to coordinator)
  triageEngine.startBatchTicker((events) => {
    for (const event of events) {
      hub.enqueueEvent(event);
    }
  });

  // 10. Init ProactiveScheduler
  const scheduler = new ProactiveScheduler(
    hub,
    memoryStore,
    config,
    automationStore,
    eventBus,
  );

  // 10b. Register scheduler tools (after scheduler exists)
  mcpPool.register("scheduler", () => createSchedulerToolsServer(scheduler));

  // 10c. Wire channel manager into hub (breaks circular dep)
  hub.setChannelManager(channelManager);

  // 11. Start Habitat (loads config, starts adapters)
  await habitat.start();

  // 12. Wire event flow — habitat events drive everything
  eventBus.on("habitat:event", (event) => {
    // Reflex engine (sub-second local rules)
    reflexEngine.processEvent(event).catch(console.error);

    // Check for outcome reversals (always runs, orthogonal learning concern)
    const feedback = outcomeObserver.processEvent(event);
    if (feedback) {
      hub.handleOutcomeFeedback(feedback).catch(console.error);
    }

    // Automation matcher: check device_event + state_threshold triggers
    const matchedAutomations = automationMatcher.matchEvent(event);
    if (matchedAutomations.length > 0) {
      // Automations claimed this event — wake AI with each instruction, skip triage
      for (const automation of matchedAutomations) {
        eventBus.emit("automation:event_fired", { automation, event, timestamp: Date.now() });
        const channelHint = automation.channel ? `\nOrigin channel: ${automation.channel}` : "";
        const context = `Automation "${automation.id}" fired (${automation.trigger.type}).\nSummary: ${automation.summary}\nInstruction: ${automation.instruction}\nTriggering event: ${event.property} in ${event.space} (source: ${event.source})\nEvent state: ${JSON.stringify(event.state)}${channelHint}`;
        hub.handleProactiveWakeup("automation", context, undefined, automation.id, automation.summary).catch(console.error);
      }
      return; // Event claimed by automation — skip triage
    }

    // Triage: classify event into immediate / batched / silent
    const lane = triageEngine.classify(event);
    if (lane === "immediate") {
      hub.enqueueEvent(event);
    }
    // "batched" → already buffered inside triageEngine, flushed on periodic tick
    // "silent" → nothing, state is already updated by adapter
  });

  // Wire automation:time_fired flow
  eventBus.on("automation:time_fired", async (data) => {
    const { automation } = data;

    // ReflexEngine gets first crack — instant execution
    const handled = await reflexEngine.processAutomationEvent(automation).catch((err) => {
      console.error("[Automation] Reflex processing error:", err);
      return false;
    });

    // If no reflex matched, coordinator reasons about it
    if (!handled) {
      const triggerInfo = automation.trigger.type === "cron"
        ? `cron trigger: ${automation.trigger.expression}`
        : `${automation.trigger.type} trigger`;
      const channelHint = automation.channel ? `\nOrigin channel: ${automation.channel}` : "";
      const context = `Automation "${automation.id}" fired (${triggerInfo}).\nSummary: ${automation.summary}\nInstruction: ${automation.instruction}${channelHint}`;
      hub.handleProactiveWakeup("automation", context, undefined, automation.id, automation.summary).catch(console.error);
    }
  });

  // 12a. Persist approval proposals as chat messages + route to external channels
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
        message: data.message,
        approveLabel: data.approveLabel,
        rejectLabel: data.rejectLabel,
      }),
      timestamp: data.createdAt,
      status: "approval_pending",
      approvalId: data.id,
      channel,
    });

    // Route approval to originating channel + any explicitly configured routes
    channelManager.routeApproval(data, channel).catch((err) =>
      console.error("[Channels] Failed to route approval:", err)
    );
  });

  // 12b. Start history ingestion
  historyIngestion.start();

  // 12c. Init activity persistence (stores agent events to DB + re-emits on activity:stored)
  initActivityPersistence(eventBus, activityStore);

  // 12d. Purge old activities at startup + hourly
  {
    const { activities, events } = activityStore.purge(config.activity.maxAgeMs);
    if (activities > 0 || events > 0) {
      console.log(`[ActivityStore] Purged ${activities} activity rows and ${events} event rows older than ${config.activity.maxAgeMs / 3600_000}h`);
    }
  }
  const purgeInterval = setInterval(() => {
    const { activities, events } = activityStore.purge(config.activity.maxAgeMs);
    if (activities > 0 || events > 0) {
      console.log(`[ActivityStore] Purged ${activities} activity rows and ${events} event rows older than ${config.activity.maxAgeMs / 3600_000}h`);
    }
  }, 3600_000);

  // 13. Start tRPC API server
  const apiServer = startApiServer(
    {
      habitat,
      memoryStore,
      reflexStore,
      chatStore,
      activityStore,
      hub,
      approvalQueue,
      eventBus,
      automationStore,
      scheduler,
      pluginManager,
      channelManager,
      channelStore,
      peopleStore,
      triageStore,
      goalStore,
      historyStore,
      secretStore,
      config,
    },
    config.apiPort,
    config.frontendDistDir,
  );

  // 14. Start ProactiveScheduler
  scheduler.start();

  // 15. Onboarding check
  const adapterCount = habitat.configStore.listAdapters().length;
  const spaceCount = habitat.configStore.listSpaces().length;
  if (adapterCount === 0 && spaceCount === 0) {
    const { memories: onboardingMemories } = await memoryStore.query({ tags: ["system:onboarding_complete"] });
    if (onboardingMemories.length === 0) {
      console.log("[Init] No adapters or spaces configured — starting onboarding");
      hub.runOnboarding().catch((err) => {
        console.error("[Init] Onboarding error:", err);
      });
    }
  }

  console.log(`\n✅ Holms running — API on port ${config.apiPort}`);
  console.log("   Frontend: http://localhost:5173");
  console.log("   Press Ctrl+C to stop\n");

  // 16. Graceful shutdown
  const shutdown = async () => {
    console.log("\n\nShutting down...");
    clearInterval(purgeInterval);
    await channelManager.stopAll();
    scheduler.stop();
    historyIngestion.stop();
    triageEngine.stopBatchTicker();
    apiServer.close();
    await habitat.stop();
    memoryStore.close();
    reflexStore.close();
    chatStore.close();
    activityStore.close();
    automationStore.close();
    triageStore.close();
    channelStore.close();
    peopleStore.close();
    goalStore.close();
    await historyStore.close();
    db.close();
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
