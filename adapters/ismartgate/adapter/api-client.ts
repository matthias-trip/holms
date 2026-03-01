import http from "node:http";
import { randomInt } from "node:crypto";
import { ISmartGateCipher } from "./cipher.js";
import type { DoorInfo, DoorStatus } from "./types.js";

const NONE_INT = -100000;
const REQUEST_TIMEOUT = 20_000;

export class ISmartGateClient {
  private cipher: ISmartGateCipher;
  private host: string;
  private username: string;
  private password: string;

  constructor(host: string, username: string, password: string) {
    this.host = host;
    this.username = username;
    this.password = password;
    this.cipher = new ISmartGateCipher(username, password);
  }

  async getInfo(): Promise<DoorInfo[]> {
    const payload = JSON.stringify([this.username, this.password, "info", "", ""]);
    const xml = await this.sendCommand(payload);
    return this.parseInfoXml(xml);
  }

  async activate(doorId: number, apicode: string): Promise<void> {
    const payload = JSON.stringify([this.username, this.password, "activate", String(doorId), apicode]);
    await this.sendCommand(payload);
  }

  async ping(): Promise<boolean> {
    try {
      await this.getInfo();
      return true;
    } catch {
      return false;
    }
  }

  private async sendCommand(payload: string): Promise<string> {
    const encrypted = this.cipher.encrypt(payload);
    const params = new URLSearchParams({
      data: encrypted,
      t: String(randomInt(1, 100_000_001)),
      token: this.cipher.token,
    });
    const url = `http://${this.host}/api.php?${params.toString()}`;

    return new Promise<string>((resolve, reject) => {
      const req = http.get(url, { timeout: REQUEST_TIMEOUT }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          try {
            const decrypted = this.cipher.decrypt(body);
            resolve(decrypted);
          } catch {
            // Fallback: response may be unencrypted (e.g. error XML)
            resolve(body);
          }
        });
        res.on("error", reject);
      });
      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`Request timed out after ${REQUEST_TIMEOUT}ms`));
      });
      req.on("error", reject);
    });
  }

  private parseInfoXml(xml: string): DoorInfo[] {
    const doors: DoorInfo[] = [];

    for (let i = 1; i <= 3; i++) {
      // Doors are nested elements: <door1>...<enabled>yes</enabled>...</door1>
      const doorBlock = this.xmlBlock(xml, `door${i}`);
      if (!doorBlock) continue;

      const enabled = this.xmlTag(doorBlock, "enabled");
      if (enabled !== "yes") continue;

      const sensor = this.xmlTag(doorBlock, "sensor") === "yes";
      const tempRaw = parseFloat(this.xmlTag(doorBlock, "temperature") || "");
      const voltRaw = parseInt(this.xmlTag(doorBlock, "voltage") || "", 10);

      doors.push({
        id: i,
        name: this.xmlTag(doorBlock, "name") || `Door ${i}`,
        status: (this.xmlTag(doorBlock, "status") || "undefined") as DoorStatus,
        temperature: isNaN(tempRaw) || tempRaw <= NONE_INT ? null : tempRaw,
        voltage: isNaN(voltRaw) || voltRaw <= NONE_INT ? null : voltRaw,
        sensor,
        enabled: true,
        mode: this.xmlTag(doorBlock, "mode") || "garage",
        isGate: this.xmlTag(doorBlock, "gate") === "yes",
        apicode: this.xmlTag(doorBlock, "apicode") || "",
      });
    }

    return doors;
  }

  /** Extract content of a nested XML element (may contain child elements). */
  private xmlBlock(xml: string, tag: string): string | null {
    const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return match?.[1] ?? null;
  }

  /** Extract text content of a leaf XML element. */
  private xmlTag(xml: string, tag: string): string {
    const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return match?.[1] ?? "";
  }
}
