import https from "node:https";
import type { DiscoveredBridge, PairResult } from "./types.js";

/**
 * Discover Hue bridges on the local network via mDNS.
 * Requires `bonjour-service` for mDNS browsing.
 */
export async function discoverBridges(timeoutMs = 10_000): Promise<DiscoveredBridge[]> {
  const mod = await import("bonjour-service");
  const BonjourClass = mod.Bonjour ?? mod.default;
  const bonjour = new BonjourClass();

  return new Promise<DiscoveredBridge[]>((resolve) => {
    const bridges: DiscoveredBridge[] = [];
    const seen = new Set<string>();

    const browser = bonjour.find({ type: "hue" }, (service: any) => {
      const ip = (service.addresses as string[] | undefined)?.find((a: string) => a.includes("."));
      if (!ip || seen.has(ip)) return;
      seen.add(ip);
      bridges.push({
        ip,
        name: service.name ?? "Hue Bridge",
        id: service.txt?.bridgeid ?? service.name ?? ip,
      });
    });

    setTimeout(() => {
      browser.stop();
      bonjour.destroy();
      resolve(bridges);
    }, timeoutMs);
  });
}

/**
 * Pair with a Hue bridge by pressing the link button and calling POST /api.
 * Throws if link button has not been pressed (error type 101).
 */
export async function pairBridge(
  bridgeIp: string,
  appName = "holms#daemon",
): Promise<PairResult> {
  return new Promise<PairResult>((resolve, reject) => {
    const body = JSON.stringify({ devicetype: appName, generateclientkey: true });
    const req = https.request(
      `https://${bridgeIp}/api`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const raw = Buffer.concat(chunks).toString("utf-8");
            const data = JSON.parse(raw) as Array<{
              success?: { username: string; clientkey: string };
              error?: { type: number; description: string };
            }>;
            const entry = data[0];
            if (entry?.success) {
              resolve({
                api_key: entry.success.username,
                client_key: entry.success.clientkey,
              });
            } else if (entry?.error) {
              reject(new Error(
                entry.error.type === 101
                  ? "Link button not pressed. Press the button on the Hue bridge and try again."
                  : `Hue pairing error (${entry.error.type}): ${entry.error.description}`,
              ));
            } else {
              reject(new Error("Unexpected pairing response"));
            }
          } catch {
            reject(new Error("Failed to parse pairing response"));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
