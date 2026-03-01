import type { BrinkSystem, AppGuiDescription, WriteParameter } from "./types.js";

const BASE_URL = "https://www.brink-home.com/portal/api/portal";

export class BrinkClient {
  private username: string;
  private password: string;
  private cookie: string | null = null;

  constructor(username: string, password: string) {
    this.username = username;
    this.password = password;
  }

  async login(): Promise<void> {
    const res = await fetch(`${BASE_URL}/UserLogon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: this.username, password: this.password }),
      redirect: "manual",
    });

    if (!res.ok && res.status !== 302) {
      throw new Error(`Login failed: ${res.status} ${res.statusText}`);
    }

    this.cookie = this.extractCookie(res);
    if (!this.cookie) {
      // Some endpoints return 200 with a cookie in the body or just set session state
      // Try a follow-up request to verify we're authenticated
      const body = await res.text();
      if (body.includes("false") || body.includes("error")) {
        throw new Error("Login failed: invalid credentials");
      }
    }
  }

  async getSystemList(): Promise<BrinkSystem[]> {
    const data = await this.authedFetch<BrinkSystem[]>(`${BASE_URL}/GetSystemList`);
    return data;
  }

  async getState(gatewayId: number, systemId: number): Promise<AppGuiDescription> {
    const url = `${BASE_URL}/GetAppGuiDescriptionForGateway?GatewayId=${gatewayId}&SystemId=${systemId}`;
    const data = await this.authedFetch<AppGuiDescription>(url);
    return data;
  }

  async writeParameters(
    gatewayId: number,
    systemId: number,
    params: WriteParameter[],
  ): Promise<void> {
    // Match Homey's request format exactly — include DependendReadValuesAfterWrite
    // and don't throw on the response (the async write endpoint may return non-standard status)
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.cookie) {
      headers["Cookie"] = this.cookie;
    }

    const res = await fetch(`${BASE_URL}/WriteParameterValuesAsync`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        GatewayId: gatewayId,
        SystemId: systemId,
        WriteParameterValues: params,
        SendInOneBundle: true,
        DependendReadValuesAfterWrite: [],
      }),
    });

    // Re-authenticate and retry on 401
    if (res.status === 401) {
      await this.login();
      const retryHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.cookie) {
        retryHeaders["Cookie"] = this.cookie;
      }
      const retry = await fetch(`${BASE_URL}/WriteParameterValuesAsync`, {
        method: "POST",
        headers: retryHeaders,
        body: JSON.stringify({
          GatewayId: gatewayId,
          SystemId: systemId,
          WriteParameterValues: params,
          SendInOneBundle: true,
          DependendReadValuesAfterWrite: [],
        }),
      });
      if (!retry.ok) {
        throw new Error(`Brink write failed after re-auth: ${retry.status} ${retry.statusText}`);
      }
      return;
    }

    if (!res.ok) {
      throw new Error(`Brink write failed: ${res.status} ${res.statusText}`);
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.authedFetch(`${BASE_URL}/GetSystemList`);
      return true;
    } catch {
      return false;
    }
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private async authedFetch<T = unknown>(url: string, init?: RequestInit): Promise<T> {
    const doFetch = async (): Promise<Response> => {
      const headers: Record<string, string> = {
        ...(init?.headers as Record<string, string> ?? {}),
      };
      if (this.cookie) {
        headers["Cookie"] = this.cookie;
      }
      return fetch(url, { ...init, headers });
    };

    let res = await doFetch();

    // Re-authenticate on 401
    if (res.status === 401) {
      await this.login();
      res = await doFetch();
    }

    if (!res.ok) {
      throw new Error(`Brink API error: ${res.status} ${res.statusText} (${url})`);
    }

    const text = await res.text();
    if (!text) return undefined as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  private extractCookie(res: Response): string | null {
    // Response.headers.getSetCookie() is available in Node 20+
    const setCookies = res.headers.getSetCookie?.() ?? [];
    if (setCookies.length > 0) {
      // Extract cookie name=value pairs, drop attributes
      return setCookies
        .map((c) => c.split(";")[0])
        .join("; ");
    }

    // Fallback: try raw header
    const raw = res.headers.get("set-cookie");
    if (raw) {
      return raw.split(";")[0];
    }

    return null;
  }
}
