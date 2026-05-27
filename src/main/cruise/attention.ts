/**
 * AttentionDetector — decides when an agent's tab is blocked on user input.
 *
 * Inputs:
 *   - cliWatcher events (assistant_response chunks)
 *   - explicit ===CRUISE:NEED-USER-INPUT=== marker in assistant output
 *   - shell idle gap: time since last assistant_response > idleThresholdMs
 *
 * Output: emits AttentionSignal via callback. Auto-clears when the agent
 * emits a new assistant_response (got input + replied) or when the
 * orchestrator transitions phase.
 */

import { AttentionSignal } from './types';
import { MARKERS } from './types';

interface AgentWatch {
  runId: number;
  agentId: number;
  tabId: string;
  cliSessionId: number;
  lastResponseAt: number;
  lastResponseContent: string;
  attentionActive: boolean;
  idleTimer: NodeJS.Timeout | null;
}

export type AttentionCallback = (signal: AttentionSignal) => void;
export type AttentionClearCallback = (runId: number, agentId: number, tabId: string) => void;

export class AttentionDetector {
  private watches: Map<number, AgentWatch> = new Map(); // key = cliSessionId
  private idleThresholdMs: number;
  private onAttention: AttentionCallback;
  private onClear: AttentionClearCallback;

  constructor(
    onAttention: AttentionCallback,
    onClear: AttentionClearCallback,
    idleThresholdMs: number = 4000,
  ) {
    this.onAttention = onAttention;
    this.onClear = onClear;
    this.idleThresholdMs = idleThresholdMs;
  }

  watch(runId: number, agentId: number, tabId: string, cliSessionId: number): void {
    this.watches.set(cliSessionId, {
      runId,
      agentId,
      tabId,
      cliSessionId,
      lastResponseAt: Date.now(),
      lastResponseContent: '',
      attentionActive: false,
      idleTimer: null,
    });
  }

  unwatch(cliSessionId: number): void {
    const w = this.watches.get(cliSessionId);
    if (!w) return;
    if (w.idleTimer) clearTimeout(w.idleTimer);
    if (w.attentionActive) {
      this.onClear(w.runId, w.agentId, w.tabId);
    }
    this.watches.delete(cliSessionId);
  }

  unwatchAll(): void {
    for (const id of Array.from(this.watches.keys())) {
      this.unwatch(id);
    }
  }

  /** Call when cli-watcher emits an assistant_response */
  handleAssistantResponse(cliSessionId: number, content: string): void {
    const w = this.watches.get(cliSessionId);
    if (!w) return;
    w.lastResponseAt = Date.now();
    w.lastResponseContent = content;

    // If the agent explicitly declared it needs input, fire immediately.
    if (content.includes(MARKERS.ATTENTION_REQUIRED)) {
      this.fireAttention(w, 'agent requested user input');
      return;
    }

    // Clear any prior attention (the agent kept working / responded again)
    if (w.attentionActive) {
      w.attentionActive = false;
      this.onClear(w.runId, w.agentId, w.tabId);
    }

    // Re-arm idle timer
    if (w.idleTimer) clearTimeout(w.idleTimer);
    w.idleTimer = setTimeout(() => this.onIdleElapsed(w), this.idleThresholdMs);
  }

  /** Call when cli-watcher emits a user_input — clears attention */
  handleUserInput(cliSessionId: number): void {
    const w = this.watches.get(cliSessionId);
    if (!w) return;
    if (w.attentionActive) {
      w.attentionActive = false;
      this.onClear(w.runId, w.agentId, w.tabId);
    }
  }

  /** Called when an agent has been idle (no new assistant chunk) for the threshold */
  private onIdleElapsed(w: AgentWatch): void {
    if (w.attentionActive) return;
    // Heuristic: if the most recent assistant_response ended with a question
    // mark, or contains common "please" / "would you like" / "could you"
    // patterns, treat as input-required.
    const tail = w.lastResponseContent.slice(-300).toLowerCase();
    const looksLikeQuestion =
      tail.trimEnd().endsWith('?') ||
      /please (clarify|confirm|specify|let me know)/i.test(tail) ||
      /(would|could) you (like|prefer|want)/i.test(tail) ||
      /which (option|approach|version) (do you|would you)/i.test(tail);

    if (looksLikeQuestion) {
      this.fireAttention(w, 'agent appears to be waiting on a question');
    }
  }

  private fireAttention(w: AgentWatch, reason: string): void {
    w.attentionActive = true;
    if (w.idleTimer) {
      clearTimeout(w.idleTimer);
      w.idleTimer = null;
    }
    this.onAttention({
      runId: w.runId,
      agentId: w.agentId,
      tabId: w.tabId,
      reason,
      at: Date.now(),
    });
  }
}
