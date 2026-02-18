import type { SpecialistProposal, ConflictFlag, SpecialistResult } from "@holms/shared";

export interface ConflictResolution {
  keep: SpecialistProposal[];
  discard: SpecialistProposal[];
  conflicts: ConflictFlag[];
  explanation: string;
}

export function detectConflicts(results: SpecialistResult[]): ConflictResolution {
  const allProposals = results.flatMap((r) => r.proposals);
  const allConflicts = results.flatMap((r) => r.conflicts);

  // Group proposals by deviceId
  const byDevice = new Map<string, SpecialistProposal[]>();
  for (const proposal of allProposals) {
    const existing = byDevice.get(proposal.deviceId) ?? [];
    existing.push(proposal);
    byDevice.set(proposal.deviceId, existing);
  }

  const keep: SpecialistProposal[] = [];
  const discard: SpecialistProposal[] = [];
  const explanations: string[] = [];

  for (const [deviceId, proposals] of byDevice) {
    if (proposals.length === 1) {
      keep.push(proposals[0]!);
      continue;
    }

    // Multiple proposals for same device — resolve by priority then confidence
    const sorted = [...proposals].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return confidenceValue(b.confidence) - confidenceValue(a.confidence);
    });

    const winner = sorted[0]!;
    const losers = sorted.slice(1);

    keep.push(winner);
    discard.push(...losers);

    explanations.push(
      `Device ${deviceId}: kept ${winner.specialist}'s proposal (priority=${winner.priority}, confidence=${winner.confidence}), discarded ${losers.map((l) => l.specialist).join(", ")}`,
    );
  }

  const explanation =
    explanations.length > 0
      ? `Resolved ${explanations.length} device conflict(s):\n${explanations.join("\n")}`
      : "No conflicts detected between specialist proposals.";

  return { keep, discard, conflicts: allConflicts, explanation };
}

function confidenceValue(confidence: string): number {
  switch (confidence) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}
