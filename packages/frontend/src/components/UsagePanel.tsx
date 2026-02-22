import { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, LineChart, Line,
} from "recharts";
import { Card, CardBody, Tabs, Tab } from "@heroui/react";
import { trpc } from "../trpc";
import type { AgentActivity, TurnTrigger } from "@holms/shared";

// ── Types ──

interface TurnMetrics {
  turnId: string;
  trigger: TurnTrigger;
  model: string;
  timestamp: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
}

interface Totals {
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  avgDurationMs: number;
  avgDurationApiMs: number;
  cacheHitRatio: number;
  turnCount: number;
}

type TimeRange = "1h" | "6h" | "24h" | "7d" | "all";

const TIME_RANGES: { id: TimeRange; label: string; ms: number }[] = [
  { id: "1h", label: "1h", ms: 3600_000 },
  { id: "6h", label: "6h", ms: 21600_000 },
  { id: "24h", label: "24h", ms: 86400_000 },
  { id: "7d", label: "7d", ms: 604800_000 },
  { id: "all", label: "All", ms: Infinity },
];

const MODEL_INFO: { match: string; label: string; color: string }[] = [
  { match: "opus", label: "Opus", color: "#a78bfa" },
  { match: "sonnet", label: "Sonnet", color: "var(--accent-9)" },
  { match: "haiku", label: "Haiku", color: "#34d399" },
];

function modelLabel(id: string): string {
  const info = MODEL_INFO.find((m) => id.includes(m.match));
  return info ? info.label : id;
}

function modelColor(id: string): string {
  const info = MODEL_INFO.find((m) => id.includes(m.match));
  return info ? info.color : "var(--gray-9)";
}

interface ModelStats {
  model: string;
  label: string;
  color: string;
  turns: number;
  cost: number;
  tokens: number;
}

function computeModelStats(metrics: TurnMetrics[]): ModelStats[] {
  const map = new Map<string, { turns: number; cost: number; tokens: number }>();
  for (const m of metrics) {
    const key = m.model || "unknown";
    const existing = map.get(key) ?? { turns: 0, cost: 0, tokens: 0 };
    existing.turns += 1;
    existing.cost += m.costUsd;
    existing.tokens += m.inputTokens + m.outputTokens;
    map.set(key, existing);
  }
  return Array.from(map.entries())
    .map(([model, s]) => ({
      model,
      label: modelLabel(model),
      color: modelColor(model),
      ...s,
    }))
    .sort((a, b) => b.cost - a.cost);
}

const TRIGGER_COLORS: Record<string, string> = {
  user_message: "var(--accent-9)",
  device_events: "var(--warm)",
  proactive: "#a78bfa",
  automation: "#34d399",
  approval_result: "#f472b6",
  outcome_feedback: "#fb923c",
  suggestions: "#94a3b8",
};

// ── Helpers ──

function extractMetrics(
  turns: { turnId: string; activities: AgentActivity[] }[],
): TurnMetrics[] {
  return turns
    .map((turn) => {
      const startAct = turn.activities.find((a) => a.type === "turn_start");
      const resultAct = turn.activities.find((a) => a.type === "result");
      if (!resultAct) return null;

      const d = resultAct.data as Record<string, unknown>;
      const sd = (startAct?.data ?? {}) as Record<string, unknown>;

      return {
        turnId: turn.turnId,
        trigger: (sd.trigger as TurnTrigger) ?? "user_message",
        model: ((d.model as string) || (sd.model as string) || "unknown"),
        timestamp: resultAct.timestamp,
        costUsd: (d.costUsd as number) ?? 0,
        inputTokens: (d.inputTokens as number) ?? 0,
        outputTokens: (d.outputTokens as number) ?? 0,
        cacheReadTokens: (d.cacheReadTokens as number) ?? 0,
        cacheCreationTokens: (d.cacheCreationTokens as number) ?? 0,
        durationMs: (d.durationMs as number) ?? 0,
        durationApiMs: (d.durationApiMs as number) ?? 0,
        numTurns: (d.numTurns as number) ?? 0,
      };
    })
    .filter((m): m is TurnMetrics => m !== null);
}

function computeTotals(metrics: TurnMetrics[]): Totals {
  if (metrics.length === 0) {
    return {
      cost: 0, inputTokens: 0, outputTokens: 0,
      cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0,
      avgDurationMs: 0, avgDurationApiMs: 0, cacheHitRatio: 0, turnCount: 0,
    };
  }

  let cost = 0, input = 0, output = 0, cacheRead = 0, cacheCreate = 0;
  let durSum = 0, durApiSum = 0;

  for (const m of metrics) {
    cost += m.costUsd;
    input += m.inputTokens;
    output += m.outputTokens;
    cacheRead += m.cacheReadTokens;
    cacheCreate += m.cacheCreationTokens;
    durSum += m.durationMs;
    durApiSum += m.durationApiMs;
  }

  const totalInput = input + cacheRead + cacheCreate;
  const cacheHitRatio = totalInput > 0 ? cacheRead / totalInput : 0;

  return {
    cost, inputTokens: input, outputTokens: output,
    cacheReadTokens: cacheRead, cacheCreationTokens: cacheCreate,
    totalTokens: input + output,
    avgDurationMs: durSum / metrics.length,
    avgDurationApiMs: durApiSum / metrics.length,
    cacheHitRatio,
    turnCount: metrics.length,
  };
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return n.toLocaleString();
}

function fmtCost(n: number): string {
  if (n < 0.01 && n > 0) return "<$0.01";
  return "$" + n.toFixed(2);
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return ms.toFixed(0) + "ms";
  return (ms / 1000).toFixed(1) + "s";
}

// ── Summary Card ──

function StatCard({ label, value, sub, index }: { label: string; value: string; sub?: string; index?: number }) {
  return (
    <Card className="flex-1 min-w-[140px] animate-fade-in" style={{ background: "var(--gray-3)", border: "1px solid var(--gray-a5)", animationDelay: `${(index ?? 0) * 50}ms` }}>
      <CardBody>
        <p className="text-xs mb-1" style={{ color: "var(--gray-9)" }}>{label}</p>
        <p className="text-xl font-bold" style={{ color: "var(--gray-12)" }}>{value}</p>
        {sub && <p className="text-xs mt-1" style={{ color: "var(--gray-9)" }}>{sub}</p>}
      </CardBody>
    </Card>
  );
}

// ── Token Breakdown Bar (Recharts) ──

function TokenBreakdownBar({ totals }: { totals: Totals }) {
  const segments = [
    { label: "Input", value: totals.inputTokens, color: "var(--accent-9)" },
    { label: "Output", value: totals.outputTokens, color: "var(--warm)" },
    { label: "Cache Read", value: totals.cacheReadTokens, color: "#34d399" },
    { label: "Cache Create", value: totals.cacheCreationTokens, color: "#a78bfa" },
  ];
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;

  const data = [segments.reduce((acc, seg) => ({ ...acc, [seg.label]: seg.value }), { name: "Tokens" } as Record<string, unknown>)];

  return (
    <div>
      <p className="text-sm font-medium mb-2" style={{ color: "var(--gray-12)" }}>Token Breakdown</p>
      <ResponsiveContainer width="100%" height={28}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" hide />
          {segments.map((seg) => (
            <Bar key={seg.label} dataKey={seg.label} stackId="tokens" fill={seg.color} radius={0} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="flex gap-4 mt-2 flex-wrap">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm" style={{ background: seg.color }} />
            <span className="text-xs" style={{ color: "var(--gray-9)" }}>{seg.label}: {fmt(seg.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Model Cost Breakdown Bar ──

function ModelBreakdownBar({ stats }: { stats: ModelStats[] }) {
  const total = stats.reduce((s, m) => s + m.cost, 0);
  if (total === 0 || stats.length === 0) return null;

  const data = [
    stats.reduce(
      (acc, s) => ({ ...acc, [s.label]: s.cost }),
      { name: "Cost" } as Record<string, unknown>,
    ),
  ];

  return (
    <div>
      <p className="text-sm font-medium mb-2" style={{ color: "var(--gray-12)" }}>Cost by Model</p>
      <ResponsiveContainer width="100%" height={28}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" hide />
          {stats.map((s) => (
            <Bar key={s.label} dataKey={s.label} stackId="cost" fill={s.color} radius={0} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="flex gap-4 mt-2 flex-wrap">
        {stats.map((s) => (
          <div key={s.model} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm" style={{ background: s.color }} />
            <span className="text-xs" style={{ color: "var(--gray-9)" }}>
              {s.label}: {fmtCost(s.cost)} ({((s.cost / total) * 100).toFixed(0)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Per-model Summary Row ──

function ModelSummaryRow({ stats }: { stats: ModelStats[] }) {
  if (stats.length === 0) return null;

  return (
    <div className="flex gap-2 flex-wrap">
      {stats.map((s) => (
        <div
          key={s.model}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px]"
          style={{ background: "var(--gray-3)", border: "1px solid var(--gray-a5)" }}
        >
          <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
          <span className="font-medium" style={{ color: "var(--gray-12)" }}>{s.label}</span>
          <span style={{ color: "var(--gray-9)" }}>
            {s.turns} turn{s.turns !== 1 ? "s" : ""}
          </span>
          <span style={{ color: "var(--gray-9)" }}>{fmtCost(s.cost)}</span>
          <span style={{ color: "var(--gray-9)" }}>{fmt(s.tokens)} tok</span>
        </div>
      ))}
    </div>
  );
}

// ── Cost per Turn (Recharts) ──

function CostPerTurnChart({ metrics }: { metrics: TurnMetrics[] }) {
  const last = metrics.slice(-20);
  if (last.length === 0) return null;

  const data = last.map((m, i) => ({
    index: i,
    cost: m.costUsd,
    trigger: m.trigger,
    label: `${m.trigger}: ${fmtCost(m.costUsd)}`,
  }));

  return (
    <div>
      <p className="text-sm font-medium mb-2" style={{ color: "var(--gray-12)" }}>
        Cost per Turn <span style={{ color: "var(--gray-9)", fontWeight: 400 }}>(last {last.length})</span>
      </p>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <XAxis dataKey="index" hide />
          <YAxis hide />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload;
              return (
                <div className="px-2 py-1 rounded text-[11px]" style={{ background: "var(--gray-12)", color: "var(--gray-1)" }}>
                  {d.label}
                </div>
              );
            }}
          />
          <Bar dataKey="cost" radius={[2, 2, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={index} fill={TRIGGER_COLORS[entry.trigger] ?? "var(--gray-9)"} opacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Cache Donut (Recharts) ──

function CacheDonut({ ratio }: { ratio: number }) {
  const pct = (ratio * 100).toFixed(1);
  const data = [
    { name: "Hit", value: ratio, fill: "#34d399" },
    { name: "Miss", value: 1 - ratio, fill: "var(--gray-a5)" },
  ];

  return (
    <div>
      <p className="text-sm font-medium mb-2" style={{ color: "var(--gray-12)" }}>Cache Hit Ratio</p>
      <div className="flex justify-center">
        <ResponsiveContainer width={100} height={100}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={28}
              outerRadius={40}
              dataKey="value"
              startAngle={90}
              endAngle={-270}
              strokeWidth={0}
            >
              {data.map((entry, index) => (
                <Cell key={index} fill={entry.fill} />
              ))}
            </Pie>
            <text
              x="50%"
              y="50%"
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--gray-12)"
              fontSize={16}
              fontWeight={600}
            >
              {pct}%
            </text>
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Tokens per Turn (Recharts) ──

function TokensPerTurnChart({ metrics }: { metrics: TurnMetrics[] }) {
  const last = metrics.slice(-20);
  if (last.length === 0) return null;

  const data = last.map((m, i) => ({
    index: i,
    input: m.inputTokens,
    output: m.outputTokens,
  }));

  return (
    <div>
      <p className="text-sm font-medium mb-2" style={{ color: "var(--gray-12)" }}>
        Tokens per Turn <span style={{ color: "var(--gray-9)", fontWeight: 400 }}>(last {last.length})</span>
      </p>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <XAxis dataKey="index" hide />
          <YAxis hide />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div className="px-2 py-1 rounded text-[11px]" style={{ background: "var(--gray-12)", color: "var(--gray-1)" }}>
                  Input: {fmt(d.input)} / Output: {fmt(d.output)}
                </div>
              );
            }}
          />
          <Bar dataKey="input" stackId="tokens" fill="var(--accent-9)" opacity={0.85} radius={0} />
          <Bar dataKey="output" stackId="tokens" fill="var(--warm)" opacity={0.85} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex gap-3 mt-1">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm" style={{ background: "var(--accent-9)" }} />
          <span className="text-xs" style={{ color: "var(--gray-9)" }}>Input</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm" style={{ background: "var(--warm)" }} />
          <span className="text-xs" style={{ color: "var(--gray-9)" }}>Output</span>
        </div>
      </div>
    </div>
  );
}

// ── Duration Lines (Recharts) ──

function DurationChart({ metrics }: { metrics: TurnMetrics[] }) {
  const last = metrics.slice(-20);
  if (last.length < 2) return null;

  const data = last.map((m, i) => ({
    index: i,
    total: m.durationMs,
    api: m.durationApiMs,
  }));

  return (
    <div>
      <p className="text-sm font-medium mb-2" style={{ color: "var(--gray-12)" }}>
        Duration Trends <span style={{ color: "var(--gray-9)", fontWeight: 400 }}>(last {last.length})</span>
      </p>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <XAxis dataKey="index" hide />
          <YAxis hide />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div className="px-2 py-1 rounded text-[11px]" style={{ background: "var(--gray-12)", color: "var(--gray-1)" }}>
                  Total: {fmtDuration(d.total)} / API: {fmtDuration(d.api)}
                </div>
              );
            }}
          />
          <Line type="monotone" dataKey="total" stroke="var(--accent-9)" strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="api" stroke="var(--warm)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex gap-3 mt-1">
        <div className="flex items-center gap-1">
          <div className="w-4 h-0.5" style={{ background: "var(--accent-9)" }} />
          <span className="text-xs" style={{ color: "var(--gray-9)" }}>Total</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-0.5" style={{ background: "var(--warm)", borderTop: "1px dashed var(--warm)" }} />
          <span className="text-xs" style={{ color: "var(--gray-9)" }}>API only</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Panel ──

export default function UsagePanel() {
  const [range, setRange] = useState<TimeRange>("24h");
  const { data: turns } = trpc.agents.turns.useQuery({ limit: 200 });

  const allMetrics = useMemo(() => extractMetrics(turns ?? []), [turns]);

  const filteredMetrics = useMemo(() => {
    if (range === "all") return allMetrics;
    const cutoff = Date.now() - TIME_RANGES.find((r) => r.id === range)!.ms;
    return allMetrics.filter((m) => m.timestamp >= cutoff);
  }, [allMetrics, range]);

  const totals = useMemo(() => computeTotals(filteredMetrics), [filteredMetrics]);
  const modelStats = useMemo(() => computeModelStats(filteredMetrics), [filteredMetrics]);

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--gray-2)" }}>
      {/* Header */}
      <div
        className="flex justify-between items-center flex-shrink-0 px-6 py-4"
        style={{ borderBottom: "1px solid var(--gray-a3)", background: "var(--gray-1)" }}
      >
        <h3 className="text-base font-bold" style={{ color: "var(--gray-12)" }}>Usage</h3>
        <Tabs
          variant="light"
          size="sm"
          selectedKey={range}
          onSelectionChange={(key) => setRange(key as TimeRange)}
        >
          {TIME_RANGES.map((tr) => (
            <Tab key={tr.id} title={tr.label} />
          ))}
        </Tabs>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {totals.turnCount === 0 ? (
          <div className="flex items-center justify-center h-40">
            <span className="text-sm" style={{ color: "var(--gray-9)" }}>No usage data in this time range.</span>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="flex gap-3 flex-wrap">
              <StatCard
                label="Total Cost"
                value={fmtCost(totals.cost)}
                index={0}
              />
              <StatCard
                label="Tokens"
                value={fmt(totals.totalTokens)}
                sub={`${fmt(totals.inputTokens)} in / ${fmt(totals.outputTokens)} out`}
                index={1}
              />
              <StatCard
                label="Cache Hit"
                value={`${(totals.cacheHitRatio * 100).toFixed(1)}%`}
                sub={`${fmt(totals.cacheReadTokens)} read / ${fmt(totals.cacheCreationTokens)} created`}
                index={2}
              />
              <StatCard
                label="Avg Duration"
                value={fmtDuration(totals.avgDurationMs)}
                sub={totals.avgDurationApiMs > 0 ? `API: ${fmtDuration(totals.avgDurationApiMs)}` : undefined}
                index={3}
              />
            </div>

            {/* Token Breakdown */}
            <Card className="animate-fade-in" style={{ background: "var(--gray-3)", border: "1px solid var(--gray-a5)", animationDelay: "200ms" }}>
              <CardBody>
                <TokenBreakdownBar totals={totals} />
              </CardBody>
            </Card>

            {/* Model Cost Breakdown */}
            {modelStats.length > 0 && (
              <Card className="animate-fade-in" style={{ background: "var(--gray-3)", border: "1px solid var(--gray-a5)", animationDelay: "250ms" }}>
                <CardBody>
                  <ModelBreakdownBar stats={modelStats} />
                </CardBody>
              </Card>
            )}

            {/* Per-model Summary */}
            <ModelSummaryRow stats={modelStats} />

            {/* Charts Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="animate-fade-in" style={{ background: "var(--gray-3)", border: "1px solid var(--gray-a5)", animationDelay: "300ms" }}>
                <CardBody>
                  <CostPerTurnChart metrics={filteredMetrics} />
                </CardBody>
              </Card>
              <Card className="animate-fade-in" style={{ background: "var(--gray-3)", border: "1px solid var(--gray-a5)", animationDelay: "350ms" }}>
                <CardBody>
                  <CacheDonut ratio={totals.cacheHitRatio} />
                </CardBody>
              </Card>
              <Card className="animate-fade-in" style={{ background: "var(--gray-3)", border: "1px solid var(--gray-a5)", animationDelay: "400ms" }}>
                <CardBody>
                  <TokensPerTurnChart metrics={filteredMetrics} />
                </CardBody>
              </Card>
              <Card className="animate-fade-in" style={{ background: "var(--gray-3)", border: "1px solid var(--gray-a5)", animationDelay: "450ms" }}>
                <CardBody>
                  <DurationChart metrics={filteredMetrics} />
                </CardBody>
              </Card>
            </div>

            {/* Turn count */}
            <p className="text-xs text-center pb-2" style={{ color: "var(--gray-9)" }}>
              {totals.turnCount} turn{totals.turnCount !== 1 ? "s" : ""} in range
            </p>
          </>
        )}
      </div>
    </div>
  );
}
