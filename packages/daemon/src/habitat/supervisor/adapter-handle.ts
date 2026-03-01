import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { v4 as uuid } from "uuid";
import type { PropertyName } from "../types.js";
import type { SecretStore } from "../secret-store.js";
import type {
  ChildMessage,
  EntityRegistration,
  EntityGroup,
  ParentMessage,
} from "./ipc-protocol.js";
import { PROTOCOL_VERSION } from "./ipc-protocol.js";

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface AdapterLogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: number;
}

const LOG_BUFFER_SIZE = 500;

export type StateChangeHandler = (
  adapterId: string,
  entityId: string,
  property: PropertyName,
  state: Record<string, unknown>,
  previousState?: Record<string, unknown>,
) => void;

export class AdapterHandle {
  readonly adapterId: string;
  readonly adapterType: string;
  private config: Record<string, unknown>;
  private child: ChildProcess | null = null;
  private pending = new Map<string, PendingRequest>();
  private onStateChange: StateChangeHandler;
  private onLog?: (entry: AdapterLogEntry) => void;
  private secretStore?: SecretStore;
  private readyPromise: Promise<{ entities: EntityRegistration[]; groups: EntityGroup[] }> | null = null;
  private readyResolve: ((result: { entities: EntityRegistration[]; groups: EntityGroup[] }) => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private _running = false;
  private _groups: EntityGroup[] = [];
  private logBuffer: AdapterLogEntry[] = [];

  private entryPath: string;

  constructor(
    adapterId: string,
    adapterType: string,
    entryPath: string,
    config: Record<string, unknown>,
    onStateChange: StateChangeHandler,
    onLog?: (entry: AdapterLogEntry) => void,
    secretStore?: SecretStore,
  ) {
    this.adapterId = adapterId;
    this.adapterType = adapterType;
    this.entryPath = entryPath;
    this.config = config;
    this.onStateChange = onStateChange;
    this.onLog = onLog;
    this.secretStore = secretStore;
  }

  get running(): boolean {
    return this._running;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get groups(): EntityGroup[] {
    return this._groups;
  }

  getLogs(): AdapterLogEntry[] {
    return this.logBuffer.slice();
  }

  private pushLog(level: AdapterLogEntry["level"], message: string): void {
    const entry: AdapterLogEntry = { level, message, timestamp: Date.now() };
    this.logBuffer.push(entry);
    if (this.logBuffer.length > LOG_BUFFER_SIZE) {
      this.logBuffer.shift();
    }
    this.onLog?.(entry);
  }

  async start(): Promise<{ entities: EntityRegistration[]; groups: EntityGroup[] }> {
    this.readyPromise = new Promise<{ entities: EntityRegistration[]; groups: EntityGroup[] }>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    this.child = spawn("node", [this.entryPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    // Read NDJSON from stdout
    const stdoutRl = createInterface({ input: this.child.stdout! });
    stdoutRl.on("line", (line) => {
      let msg: ChildMessage;
      try {
        msg = JSON.parse(line) as ChildMessage;
      } catch {
        // Non-JSON output — treat as raw log
        console.log(`[adapter:${this.adapterId}] ${line}`);
        this.pushLog("info", line);
        return;
      }
      this.handleMessage(msg);
    });

    // Forward stderr to daemon console
    const stderrRl = createInterface({ input: this.child.stderr! });
    stderrRl.on("line", (line) => {
      console.error(`[adapter:${this.adapterId}:stderr] ${line}`);
      this.pushLog("error", line);
    });

    this.child.on("exit", (code, signal) => {
      this._running = false;
      this.pushLog("warn", `Process exited (code=${code}, signal=${signal})`);
      for (const [, req] of this.pending) {
        clearTimeout(req.timer);
        req.reject(new Error(`Adapter ${this.adapterId} exited (code=${code}, signal=${signal})`));
      }
      this.pending.clear();
      if (this.readyReject) {
        this.readyReject(new Error(`Adapter ${this.adapterId} exited before ready`));
        this.readyResolve = null;
        this.readyReject = null;
      }
    });

    this.child.on("error", (err) => {
      console.error(`[adapter:${this.adapterId}] process error:`, err.message);
    });

    // Swallow EPIPE on stdin — the child may exit before we finish writing
    this.child.stdin!.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code !== "EPIPE") {
        console.error(`[adapter:${this.adapterId}] stdin error:`, err.message);
      }
    });

    // Resolve secret references to plaintext for the child process
    const resolvedConfig = this.secretStore
      ? this.secretStore.resolveAll(this.config)
      : this.config;

    // Send init
    this.send({
      type: "init",
      protocolVersion: PROTOCOL_VERSION,
      adapterId: this.adapterId,
      adapterType: this.adapterType,
      config: resolvedConfig,
    });

    const result = await this.readyPromise;
    this._running = true;
    return result;
  }

  async observe(entityId: string, property: PropertyName): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>({
      type: "observe",
      requestId: uuid(),
      entityId,
      property,
    });
  }

  async execute(
    entityId: string,
    property: PropertyName,
    command: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }> {
    return this.request<{ success: boolean; error?: string }>({
      type: "execute",
      requestId: uuid(),
      entityId,
      property,
      command,
    });
  }

  async query(
    entityId: string,
    property: PropertyName,
    params: Record<string, unknown>,
  ): Promise<{ items: Record<string, unknown>[]; total?: number; truncated?: boolean }> {
    return this.request<{ items: Record<string, unknown>[]; total?: number; truncated?: boolean }>({
      type: "query",
      requestId: uuid(),
      entityId,
      property,
      params,
    }, 30_000); // 30s timeout for potentially large queries
  }

  async ping(): Promise<boolean> {
    try {
      await this.request<void>({
        type: "ping",
        requestId: uuid(),
      });
      return true;
    } catch {
      return false;
    }
  }

  async discover(params: Record<string, unknown> = {}): Promise<{
    gateways: Array<{ id: string; name: string; address: string; metadata?: Record<string, unknown> }>;
    message?: string;
  }> {
    return this.request({
      type: "discover",
      requestId: uuid(),
      params,
    }, 30_000); // 30s timeout for network scan
  }

  async pair(params: Record<string, unknown> = {}): Promise<{
    success: boolean;
    credentials?: Record<string, unknown>;
    error?: string;
    message?: string;
  }> {
    return this.request({
      type: "pair",
      requestId: uuid(),
      params,
    }, 60_000); // 60s timeout for user interaction
  }

  async stop(): Promise<void> {
    if (!this.child) return;

    // If the child already exited (e.g. SIGINT propagation), clean up immediately
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      this._running = false;
      this.child = null;
      return;
    }

    this.send({ type: "shutdown" });

    await new Promise<void>((resolve) => {
      const sigterm = setTimeout(() => {
        this.child?.kill("SIGTERM");
      }, 5000);

      const sigkill = setTimeout(() => {
        this.child?.kill("SIGKILL");
        resolve();
      }, 7000);

      this.child!.once("exit", () => {
        clearTimeout(sigterm);
        clearTimeout(sigkill);
        resolve();
      });
    });

    this._running = false;
    this.child = null;
  }

  private get tag() { return `[adapter:${this.adapterId}]`; }

  private send(msg: ParentMessage): void {
    if (this.child?.stdin?.writable) {
      console.log(`${this.tag} ▶ ${msg.type}${this.requestSuffix(msg)}`);
      this.child.stdin.write(JSON.stringify(msg) + "\n");
    }
  }

  private request<T>(msg: ParentMessage & { requestId: string }, timeoutMs = 10_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(msg.requestId);
        reject(new Error(`Adapter ${this.adapterId} request timeout: ${msg.type}`));
      }, timeoutMs);

      this.pending.set(msg.requestId, { resolve, reject, timer });
      this.send(msg);
    });
  }

  private handleMessage(msg: ChildMessage): void {
    switch (msg.type) {
      case "ready":
        console.log(`${this.tag} ◀ ready (${msg.entities.length} entities, ${msg.groups?.length ?? 0} groups)`);
        this.pushLog("info", `Ready — ${msg.entities.length} entities, ${msg.groups?.length ?? 0} groups`);
        this._groups = msg.groups ?? [];
        this.readyResolve?.({ entities: msg.entities, groups: this._groups });
        this.readyResolve = null;
        this.readyReject = null;
        break;

      case "observe_result": {
        console.log(`${this.tag} ◀ observe_result`);
        this.pushLog("debug", `Observe result received`);
        const req = this.pending.get(msg.requestId);
        if (req) {
          clearTimeout(req.timer);
          this.pending.delete(msg.requestId);
          req.resolve(msg.state);
        }
        break;
      }

      case "execute_result": {
        console.log(`${this.tag} ◀ execute_result success=${msg.success}${msg.error ? ` error=${msg.error}` : ""}`);
        this.pushLog(msg.success ? "info" : "warn", `Execute ${msg.success ? "succeeded" : `failed: ${msg.error ?? "unknown"}`}`);
        const req = this.pending.get(msg.requestId);
        if (req) {
          clearTimeout(req.timer);
          this.pending.delete(msg.requestId);
          req.resolve({ success: msg.success, error: msg.error });
        }
        break;
      }

      case "pong": {
        const req = this.pending.get(msg.requestId);
        if (req) {
          clearTimeout(req.timer);
          this.pending.delete(msg.requestId);
          req.resolve(undefined);
        }
        break;
      }

      case "discover_result": {
        console.log(`${this.tag} ◀ discover_result (${msg.gateways.length} gateways)`);
        this.pushLog("info", `Discovery: ${msg.gateways.length} gateways found`);
        const req = this.pending.get(msg.requestId);
        if (req) {
          clearTimeout(req.timer);
          this.pending.delete(msg.requestId);
          req.resolve({ gateways: msg.gateways, message: msg.message });
        }
        break;
      }

      case "pair_result": {
        console.log(`${this.tag} ◀ pair_result success=${msg.success}`);
        this.pushLog(msg.success ? "info" : "warn", `Pairing ${msg.success ? "succeeded" : "failed"}`);
        const req = this.pending.get(msg.requestId);
        if (req) {
          clearTimeout(req.timer);
          this.pending.delete(msg.requestId);
          req.resolve({
            success: msg.success,
            credentials: msg.credentials,
            error: msg.error,
            message: msg.message,
          });
        }
        break;
      }

      case "query_result": {
        console.log(`${this.tag} ◀ query_result (${msg.items.length} items)`);
        this.pushLog("debug", `Query result: ${msg.items.length} items`);
        const req = this.pending.get(msg.requestId);
        if (req) {
          clearTimeout(req.timer);
          this.pending.delete(msg.requestId);
          req.resolve({ items: msg.items, total: msg.total, truncated: msg.truncated });
        }
        break;
      }

      case "state_changed":
        console.log(`${this.tag} ◀ state_changed ${msg.entityId}/${msg.property}`);
        this.pushLog("debug", `State changed: ${msg.entityId}/${msg.property}`);
        this.onStateChange(this.adapterId, msg.entityId, msg.property, msg.state, msg.previousState);
        break;

      case "error": {
        if (msg.requestId) {
          const req = this.pending.get(msg.requestId);
          if (req) {
            clearTimeout(req.timer);
            this.pending.delete(msg.requestId);
            req.reject(new Error(msg.message));
          }
        }
        console.error(`${this.tag} ◀ error:`, msg.message);
        this.pushLog("error", msg.message);
        break;
      }

      case "log":
        console.log(`${this.tag} [${msg.level}] ${msg.message}`);
        this.pushLog(msg.level as AdapterLogEntry["level"], msg.message);
        break;
    }
  }

  private requestSuffix(msg: ParentMessage): string {
    switch (msg.type) {
      case "observe": return ` ${msg.entityId}/${msg.property}`;
      case "execute": return ` ${msg.entityId}/${msg.property}`;
      case "query": return ` ${msg.entityId}/${msg.property}`;
      default: return "";
    }
  }
}
