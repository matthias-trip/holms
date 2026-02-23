import { initTRPC } from "@trpc/server";
import type { TRPCContext } from "../context.js";

const t = initTRPC.context<TRPCContext>().create();

// --- Semver helpers ---

function parseSemver(v: string): [number, number, number] | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

// --- GHCR version check ---

let cachedLatest: { version: string | null; fetchedAt: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchLatestVersion(): Promise<string | null> {
  try {
    // 1. Get anonymous token
    const tokenRes = await fetch(
      "https://ghcr.io/token?scope=repository:matthias-trip/holms:pull"
    );
    if (!tokenRes.ok) return null;
    const { token } = (await tokenRes.json()) as { token: string };

    // 2. List tags
    const tagsRes = await fetch(
      "https://ghcr.io/v2/matthias-trip/holms/tags/list",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!tagsRes.ok) return null;
    const { tags } = (await tagsRes.json()) as { tags: string[] };

    // 3. Filter semver tags and find highest
    const semverTags = tags.filter((t) => parseSemver(t) !== null);
    if (semverTags.length === 0) return null;

    semverTags.sort((a, b) => compareSemver(b, a));
    return semverTags[0];
  } catch {
    return null;
  }
}

async function getLatestVersion(bypassCache = false): Promise<string | null> {
  if (
    !bypassCache &&
    cachedLatest &&
    Date.now() - cachedLatest.fetchedAt < CACHE_TTL
  ) {
    return cachedLatest.version;
  }

  const version = await fetchLatestVersion();
  cachedLatest = { version, fetchedAt: Date.now() };
  return version;
}

// --- Version info ---

function getVersionInfo(latest: string | null) {
  const current = process.env.HOLMS_VERSION || "dev";
  const isDev = current === "dev";
  const environment = isDev ? ("development" as const) : ("docker" as const);
  const watchtowerAvailable = !!process.env.WATCHTOWER_HTTP_API_TOKEN;

  let updateAvailable = false;
  if (!isDev && latest) {
    updateAvailable = compareSemver(latest, current) > 0;
  }

  return {
    current,
    latest,
    updateAvailable,
    environment,
    watchtowerAvailable,
  };
}

// --- Router ---

export const systemRouter = t.router({
  version: t.procedure.query(async () => {
    const latest = await getLatestVersion();
    return getVersionInfo(latest);
  }),

  checkForUpdate: t.procedure.mutation(async () => {
    const latest = await getLatestVersion(true);
    return getVersionInfo(latest);
  }),

  triggerUpdate: t.procedure.mutation(async () => {
    const token = process.env.WATCHTOWER_HTTP_API_TOKEN;
    if (!token) {
      return { success: false, message: "Watchtower is not configured" };
    }

    try {
      const res = await fetch("http://watchtower:8080/v1/update", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        return { success: true, message: "Update triggered — restarting..." };
      }
      return {
        success: false,
        message: `Watchtower returned ${res.status}: ${res.statusText}`,
      };
    } catch (err) {
      return {
        success: false,
        message: `Could not reach Watchtower: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }),
});
