import type { ApprovalAction } from "./types.js";

/**
 * Reusable approval helper that channel providers can compose with.
 * Provides button ID parsing and callback firing — providers only need
 * to implement the platform-specific sendApproval() + response handling.
 */
export class ApprovalMixin {
  private approvalCallback: ((action: ApprovalAction) => Promise<void>) | null = null;

  onApprovalAction(callback: (action: ApprovalAction) => Promise<void>): void {
    this.approvalCallback = callback;
  }

  /** Parse a button/action ID like "approve_<uuid>" → { approvalId, decision } or null */
  parseApprovalButtonId(buttonId: string): { approvalId: string; decision: "approve" | "reject" } | null {
    const match = buttonId.match(/^(approve|reject)_(.+)$/);
    if (!match) return null;
    return { decision: match[1] as "approve" | "reject", approvalId: match[2] };
  }

  /** Fire the approval callback. Returns true if handled. */
  async fireApprovalAction(approvalId: string, decision: "approve" | "reject", userId: string): Promise<boolean> {
    if (!this.approvalCallback) return false;
    await this.approvalCallback({ approvalId, decision, userId });
    return true;
  }
}
