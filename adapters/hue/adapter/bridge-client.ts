import https from "node:https";
import type {
  HueApiResponse,
  HueLight,
  HueGroupedLight,
  HueDevice,
  HueRoom,
  HueZone,
  HueScene,
  HueMotion,
  HueTemperature,
  HueLightLevel,
  HueContact,
} from "./types.js";

export class HueBridgeClient {
  private agent: https.Agent;
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(
    private bridgeIp: string,
    private apiKey: string,
  ) {
    this.agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
    this.baseUrl = `https://${bridgeIp}`;
    this.headers = {
      "hue-application-key": apiKey,
      "Content-Type": "application/json",
    };
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const req = https.request(
        url,
        {
          method,
          agent: this.agent,
          headers: this.headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf-8");
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`Hue API ${method} ${path}: HTTP ${res.statusCode} — ${raw}`));
              return;
            }
            try {
              resolve(JSON.parse(raw) as T);
            } catch {
              reject(new Error(`Hue API: invalid JSON response from ${path}`));
            }
          });
        },
      );
      req.on("error", reject);
      if (body !== undefined) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  async getResources<T>(resourceType: string): Promise<T[]> {
    const resp = await this.request<HueApiResponse<T>>("GET", `/clip/v2/resource/${resourceType}`);
    if (resp.errors?.length) {
      throw new Error(`Hue API errors: ${resp.errors.map((e) => e.description).join(", ")}`);
    }
    return resp.data;
  }

  async getResource<T>(resourceType: string, id: string): Promise<T> {
    const resp = await this.request<HueApiResponse<T>>("GET", `/clip/v2/resource/${resourceType}/${id}`);
    if (resp.errors?.length) {
      throw new Error(`Hue API errors: ${resp.errors.map((e) => e.description).join(", ")}`);
    }
    return resp.data[0]!;
  }

  getLights() { return this.getResources<HueLight>("light"); }
  getDevices() { return this.getResources<HueDevice>("device"); }
  getRooms() { return this.getResources<HueRoom>("room"); }
  getZones() { return this.getResources<HueZone>("zone"); }
  getScenes() { return this.getResources<HueScene>("scene"); }
  getMotionSensors() { return this.getResources<HueMotion>("motion"); }
  getTemperatureSensors() { return this.getResources<HueTemperature>("temperature"); }
  getLightLevelSensors() { return this.getResources<HueLightLevel>("light_level"); }
  getContactSensors() { return this.getResources<HueContact>("contact"); }
  getGroupedLights() { return this.getResources<HueGroupedLight>("grouped_light"); }

  async setLightState(id: string, body: Record<string, unknown>): Promise<void> {
    await this.request("PUT", `/clip/v2/resource/light/${id}`, body);
  }

  async setGroupedLightState(id: string, body: Record<string, unknown>): Promise<void> {
    await this.request("PUT", `/clip/v2/resource/grouped_light/${id}`, body);
  }

  async activateScene(id: string): Promise<void> {
    await this.request("PUT", `/clip/v2/resource/scene/${id}`, { recall: { action: "active" } });
  }

  async ping(): Promise<boolean> {
    try {
      await this.getResources("bridge");
      return true;
    } catch {
      return false;
    }
  }

  getHttpsAgent(): https.Agent {
    return this.agent;
  }

  getBridgeIp(): string {
    return this.bridgeIp;
  }

  getApiKey(): string {
    return this.apiKey;
  }

  destroy(): void {
    this.agent.destroy();
  }
}
