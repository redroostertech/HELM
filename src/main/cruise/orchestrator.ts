/**
 * CruiseOrchestrator — drives multi-agent Cruise Control runs end-to-end.
 *
 * Responsibilities:
 *   - Validate the target repo
 *   - Persist a cruise_runs row + per-agent cruise_agents rows
 *   - Spawn agent tabs via the host's tab-creation hooks
 *   - Inject role-specific kickoff prompts once each CLI is detected
 *   - Subscribe to cliWatcher events and route them per agent
 *   - Detect phase-completion markers in assistant output
 *   - Run the state machine, emit phase changes and audit events
 *   - Manage Pause (soft, keep CLIs alive) and Stop (hard, kill CLIs + checkpoint)
 *
 * The orchestrator is dependency-injected via a hooks bundle so it has no
 * direct knowledge of Electron's BrowserWindow — the host (main.ts) supplies
 * tab creation + broadcast plumbing.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PTYManager, PendingTabContext } from '../pty-manager';
import { DatabaseManager, CruisePhase, CruiseRunConfig, CruiseAgentRole, CruiseRun, CruiseAgent } from '../database';
import { ArtifactStore } from './artifacts';
import { AttentionDetector } from './attention';
import { transition, MachineContext, isLiveAgentPhase } from './state-machine';
import {
  DEFAULT_AGENT_CONFIG,
  MARKERS,
  EVENT_TYPES,
  AttentionSignal,
  PhaseChangeSignal,
  extractMessages,
  extractTeam,
  clampTeam,
  extractTasks,
  TeamSpec,
  TeamMemberSpec,
  MessageTarget,
} from './types';
import {
  prdRefinerPrompt,
  builderSlotPrompt,
  reviewerSlotPrompt,
  planContinuationPrompt,
  builderContinuationPrompt,
  reviewerContinuationPrompt,
  runDirForRun,
  phaseLeadPrompt,
  deliverMessage,
} from './prompts';

export interface CruiseOrchestratorHooks {
  /** Spawn a new tab with the given pending context. Returns the new tabId. */
  spawnTab: (label: string, ctx: PendingTabContext) => string;
  /** Broadcast a generic event to the renderer (audit-log live tail) */
  broadcast: (channel: string, payload: any) => void;
}

interface RunState {
  runId: number;
  config: CruiseRunConfig;
  store: ArtifactStore;
  phase: CruisePhase;
  previousPhase: CruisePhase | null;
  reviewCycle: number;
  agents: AgentState[];
  /** True while orchestrator-side transitions are paused */
  paused: boolean;
  /** Team roster parsed from DEVELOPMENT_PLAN.md (post plan-refine) */
  team: TeamSpec | null;
  /** Per-builder BUILD_COMPLETE tracking (key: role) */
  buildersCompleted: Set<string>;
  /** Per-reviewer REVIEW_ACCEPT tracking (key: role) */
  reviewersAccepted: Set<string>;
}

interface AgentState {
  agentId: number;
  role: CruiseAgentRole;
  programId: string;
  label: string;
  tabId: string | null;
  cliSessionId: number | null;
  kickedOff: boolean;
  status: 'pending' | 'spawning' | 'active' | 'idle' | 'needs-input' | 'completed' | 'killed' | 'failed';
  /** Messages queued for delivery after this agent's kickoff finishes */
  pendingMessages: Array<{ from: string; body: string }>;
}

export class CruiseOrchestrator {
  private runs: Map<number, RunState> = new Map();
  private agentByTabId: Map<string, { runId: number; agentId: number }> = new Map();
  private agentByCliSession: Map<number, { runId: number; agentId: number }> = new Map();
  private attention: AttentionDetector;
  private listenersRegistered = false;

  constructor(
    private db: DatabaseManager,
    private ptyManager: PTYManager,
    private hooks: CruiseOrchestratorHooks,
  ) {
    this.attention = new AttentionDetector(
      (signal) => this.handleAttention(signal),
      (runId, agentId, tabId) => this.clearAttention(runId, agentId, tabId),
    );
  }

  /** Wire global listeners on ptyManager + cliWatcher. Idempotent. */
  attach(): void {
    if (this.listenersRegistered) return;
    this.listenersRegistered = true;

    this.ptyManager.onCLIStatus((tabId, active, _programName) => {
      const ref = this.agentByTabId.get(tabId);
      if (!ref) return;
      if (active) {
        this.handleAgentCLIReady(ref.runId, ref.agentId, tabId);
      } else {
        this.handleAgentCLIExited(ref.runId, ref.agentId, tabId);
      }
    });

    this.ptyManager.cliWatcher.onEvent((event) => {
      // Route into the right run/agent by cliSessionId
      // The cliSession may not have been mapped yet — we map it lazily here.
      this.maybeMapCliSession(event.cliSessionId).then(() => {
        const ref = this.agentByCliSession.get(event.cliSessionId);
        if (!ref) return;
        if (event.type === 'assistant_response') {
          this.attention.handleAssistantResponse(event.cliSessionId, event.content);
          this.handleAssistantResponse(ref.runId, ref.agentId, event.content);
        } else if (event.type === 'user_input') {
          this.attention.handleUserInput(event.cliSessionId);
        }
      }).catch(() => {});
    });
  }

  // ── Public API ────────────────────────────────────────────────────

  async start(config: CruiseRunConfig): Promise<{ runId: number }> {
    const projectMode: 'new' | 'existing' = config.projectMode === 'existing' ? 'existing' : 'new';
    const validate = ArtifactStore.validateRepo(config.targetRepo, projectMode);
    if (!validate.ok) throw new Error(validate.error || 'invalid repo');

    // For existing-project runs, materialize a PRD.md stub if one is missing
    // so the PRD-refiner has something to refine against. The stub also
    // explicitly cues the refiner to do an exploration pass first.
    if (projectMode === 'existing') {
      try { ArtifactStore.ensurePrdStub(config.targetRepo); } catch {}
    }

    const fullConfig: CruiseRunConfig = {
      ...config,
      projectMode,
      idleThresholdMs: config.idleThresholdMs ?? 4000,
      autoApprovePRD: config.autoApprovePRD ?? false,
      maxReviewCycles: config.maxReviewCycles ?? 3,
      agents: (config.agents && config.agents.length > 0) ? config.agents : DEFAULT_AGENT_CONFIG,
    };

    const runId = await this.db.createCruiseRun(config.targetRepo, fullConfig);
    const store = new ArtifactStore(config.targetRepo);
    store.initRun(runId, fullConfig);

    // Create per-agent rows
    const agents: AgentState[] = [];
    for (const a of fullConfig.agents) {
      const label = a.label || `${a.role}`;
      const agentId = await this.db.createCruiseAgent(runId, a.role, a.programId, label);
      agents.push({
        agentId,
        role: a.role,
        programId: a.programId,
        label,
        tabId: null,
        cliSessionId: null,
        kickedOff: false,
        status: 'pending',
        pendingMessages: [],
      });
    }

    const run: RunState = {
      runId,
      config: fullConfig,
      store,
      phase: 'prd-refine',
      previousPhase: null,
      reviewCycle: 0,
      agents,
      paused: false,
      team: null,
      buildersCompleted: new Set(),
      reviewersAccepted: new Set(),
    };
    this.runs.set(runId, run);

    await this.appendEvent(run, null, EVENT_TYPES.RUN_STARTED, { config: fullConfig });
    await this.appendEvent(run, null, EVENT_TYPES.PHASE_ENTERED, { phase: 'prd-refine' });
    this.hooks.broadcast('cruise:run-started', { runId });
    this.hooks.broadcast('cruise:phase-changed', { runId, from: 'idle', to: 'prd-refine', at: Date.now() } as PhaseChangeSignal);

    // Lazy spawn: only the lead agent for the current phase is spawned now.
    // The other agents stay "pending" until either (a) their phase becomes
    // active, or (b) another agent addresses them via MSG-TO (the orchestrator
    // summons them on-demand to receive the message).
    await this.promoteAgentToLead(run);

    return { runId };
  }

  async pause(runId: number): Promise<void> {
    const run = this.requireRun(runId);
    if (run.paused) return;
    run.paused = true;
    await this.db.updateCruiseRun(runId, { status: 'paused', paused_at: new Date().toISOString() });
    await this.appendEvent(run, null, EVENT_TYPES.RUN_PAUSED, {});
    this.hooks.broadcast('cruise:phase-changed', { runId, from: run.phase, to: 'paused', at: Date.now() } as PhaseChangeSignal);
  }

  async resume(runId: number): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) {
      // Resume from a stopped/persisted state: rehydrate then re-spawn agents
      await this.rehydrateRun(runId);
      const fresh = this.requireRun(runId);
      for (const ag of fresh.agents) {
        await this.spawnAgent(fresh, ag);
      }
      await this.db.updateCruiseRun(runId, { status: 'running', paused_at: null });
      await this.appendEvent(fresh, null, EVENT_TYPES.RUN_RESUMED, { source: 'cold' });
      return;
    }
    if (!run.paused) return;
    run.paused = false;
    await this.db.updateCruiseRun(runId, { status: 'running', paused_at: null });
    await this.appendEvent(run, null, EVENT_TYPES.RUN_RESUMED, { source: 'warm' });
  }

  async stop(runId: number): Promise<void> {
    const run = this.requireRun(runId);
    // Save a checkpoint before killing
    const snapshot = run.store.snapshotArtifacts(runId);
    await this.db.createCruiseCheckpoint(runId, run.phase, run.reviewCycle, snapshot);
    await this.appendEvent(run, null, EVENT_TYPES.CHECKPOINT_SAVED, { phase: run.phase });

    // Kill all agent tabs
    for (const ag of run.agents) {
      if (ag.tabId) {
        try { this.ptyManager.kill(ag.tabId); } catch {}
        await this.db.updateCruiseAgent(ag.agentId, { status: 'killed', ended_at: new Date().toISOString() });
        await this.appendEvent(run, ag.agentId, EVENT_TYPES.AGENT_KILLED, {});
        this.agentByTabId.delete(ag.tabId);
        if (ag.cliSessionId) {
          this.agentByCliSession.delete(ag.cliSessionId);
          this.attention.unwatch(ag.cliSessionId);
        }
      }
    }

    run.phase = 'stopped';
    await this.db.updateCruiseRun(runId, { status: 'stopped', current_phase: 'stopped', ended_at: new Date().toISOString() });
    await this.appendEvent(run, null, EVENT_TYPES.RUN_STOPPED, {});
    this.hooks.broadcast('cruise:run-finished', { runId, status: 'stopped' });
    this.runs.delete(runId);
  }

  async delete(runId: number): Promise<void> {
    // If the run is active, stop it first
    if (this.runs.has(runId)) {
      await this.stop(runId);
    }
    await this.db.deleteCruiseRun(runId);
  }

  /**
   * User has reviewed the PRD draft and approved it.
   * Transitions to plan-refine. The PRD Refiner stays alive and receives a
   * continuation prompt to produce DEVELOPMENT_PLAN.md with a structured
   * TEAM block describing the implementation team.
   */
  async approvePRD(runId: number, editedContent?: string): Promise<void> {
    const run = this.requireRun(runId);
    if (run.phase !== 'prd-approve') throw new Error(`run is in ${run.phase}, not prd-approve`);

    const draft = editedContent ?? (run.store.readPrdDraft(runId) || '');
    if (!draft.trim()) throw new Error('PRD draft is empty');
    run.store.writePrdApproved(runId, draft);
    await this.appendEvent(run, null, EVENT_TYPES.ARTIFACT_WRITTEN, { file: 'prd-approved.md' });
    await this.appendEvent(run, null, EVENT_TYPES.USER_APPROVAL, { phase: 'prd-refine' });

    // PRD Refiner stays ACTIVE — it is now leading plan-refine, and after
    // plan-refine completes, remains alive as a consultant for build/review.
    await this.transitionPhase(run, { type: 'prd-approved' });
  }

  /** Reviewer has rendered a decision (only used if reviewer doesn't emit marker itself) */
  async submitReviewDecision(runId: number, decision: 'accept' | 'request-changes'): Promise<void> {
    const run = this.requireRun(runId);
    if (run.phase !== 'review') throw new Error(`run is in ${run.phase}, not review`);
    if (decision === 'accept') {
      await this.transitionPhase(run, { type: 'review-accept' });
    } else {
      await this.transitionPhase(run, { type: 'review-request-changes' });
    }
  }

  /**
   * Re-open a `done` run with additional goals.
   *
   * The original team's tabs may still be alive (the run only became `done`
   * a moment ago) or may have been finalized (`finalize` kills agent tabs).
   * Either way we:
   *   - Load (or re-hydrate) the run.
   *   - Flip status back to running, phase back to build.
   *   - Re-spawn any agents whose tabs are gone, kick them off, and queue
   *     the continuation prompt to land after kickoff.
   *   - For agents whose tabs are still alive, inject the continuation
   *     prompt directly.
   *   - Emit a RUN_CONTINUED audit event with the new goals.
   */
  async continueWithGoals(runId: number, goals: string[]): Promise<void> {
    const cleanedGoals = (goals || []).map(g => (g || '').trim()).filter(g => g.length > 0);
    if (cleanedGoals.length === 0) throw new Error('at least one goal is required to continue');

    // Hydrate the run if it's not in memory (finalize() drops it from the map).
    let run = this.runs.get(runId);
    if (!run) {
      await this.rehydrateRun(runId);
      run = this.requireRun(runId);
    }
    if (run.phase !== 'done') {
      // Allow re-opening from done; bail otherwise.
      throw new Error(`continueWithGoals: run is in phase '${run.phase}', only 'done' runs can be continued`);
    }

    // Flip phase + status in memory and in DB.
    const fromPhase = run.phase;
    run.phase = 'build';
    run.previousPhase = fromPhase;
    run.paused = false;
    // Reset per-cycle trackers so a fresh BUILD_COMPLETE round can fire.
    run.buildersCompleted.clear();
    run.reviewersAccepted.clear();
    await this.db.updateCruiseRun(runId, {
      status: 'running',
      current_phase: 'build',
      ended_at: null,
    });
    await this.appendEvent(run, null, EVENT_TYPES.PHASE_EXITED, { phase: fromPhase });
    await this.appendEvent(run, null, EVENT_TYPES.PHASE_ENTERED, { phase: 'build', reviewCycle: run.reviewCycle, continuation: true });
    await this.appendEvent(run, null, EVENT_TYPES.RUN_CONTINUED, { goals: cleanedGoals, fromPhase });
    this.hooks.broadcast('cruise:phase-changed', { runId, from: fromPhase, to: 'build', at: Date.now() } as PhaseChangeSignal);

    const ctx = this.promptCtx(run);
    const builderMsg = builderContinuationPrompt(cleanedGoals, ctx);
    const reviewerMsg = reviewerContinuationPrompt(cleanedGoals, ctx);

    // Walk the existing team. For agents whose tabs are still alive, inject
    // directly. For ones whose tabs are gone (PTY closed or killed during
    // finalize), respawn — the kickoff path will run, then drain a queued
    // continuation message (we piggy-back on the existing pendingMessages
    // queue so the message arrives AFTER the kickoff lands).
    for (const ag of run.agents) {
      const isBuilder = ag.role.startsWith('builder-');
      const isReviewer = ag.role.startsWith('reviewer-');
      if (!isBuilder && !isReviewer) continue; // PRD-refiner stays passive
      const msg = isBuilder ? builderMsg : reviewerMsg;

      // Treat the agent's tab as alive iff we still hold an orchestrator
      // mapping for it AND the agent isn't marked killed/failed. `finalize`
      // calls ptyManager.kill() AND clears agentByTabId for every agent it
      // shuts down, so this mapping is a reliable proxy for liveness without
      // reaching into ptyManager internals.
      const tabAlive = !!ag.tabId
        && this.agentByTabId.has(ag.tabId)
        && ag.status !== 'killed'
        && ag.status !== 'failed';
      if (tabAlive && ag.tabId) {
        // Reset completion state for this agent so it can re-emit markers.
        ag.kickedOff = true; // already kicked off from prior phase
        ag.status = 'active';
        try { await this.db.updateCruiseAgent(ag.agentId, { status: 'active', ended_at: null }); } catch {}
        await this.injectIntoAgent(ag.tabId, msg);
        await this.appendEvent(run, ag.agentId, EVENT_TYPES.AGENT_KICKED_OFF, {
          role: ag.role, continuation: true,
        });
      } else {
        // Lazy respawn. Clear the dead tab mapping if any, queue the
        // continuation as a pending message (kickoffAgent drains queued
        // messages after re-kicking), and spawn.
        if (ag.tabId) {
          this.agentByTabId.delete(ag.tabId);
        }
        if (ag.cliSessionId) {
          this.agentByCliSession.delete(ag.cliSessionId);
          this.attention.unwatch(ag.cliSessionId);
          ag.cliSessionId = null;
        }
        ag.tabId = null;
        ag.kickedOff = false;
        ag.status = 'pending';
        ag.pendingMessages.push({ from: 'user', body: msg });
        await this.spawnAgent(run, ag);
        await this.appendEvent(run, ag.agentId, EVENT_TYPES.AGENT_KICKED_OFF, {
          role: ag.role, continuation: true, respawned: true,
        });
      }
    }
  }

  // ── Read API ──────────────────────────────────────────────────────

  async listRuns(): Promise<CruiseRun[]> {
    return this.db.listCruiseRuns();
  }

  async getRun(runId: number): Promise<{
    run: CruiseRun | null;
    agents: CruiseAgent[];
    events: any[];
    artifacts: { runDirExists: boolean; files: string[] };
  }> {
    const run = await this.db.getCruiseRun(runId);
    const agents = run ? await this.db.getCruiseAgents(runId) : [];
    const events = run ? await this.db.getCruiseEvents(runId) : [];
    let artifacts: { runDirExists: boolean; files: string[] } = { runDirExists: false, files: [] };
    if (run) {
      const dir = runDirForRun(run.target_repo, runId);
      if (fs.existsSync(dir)) {
        artifacts = { runDirExists: true, files: fs.readdirSync(dir) };
      }
    }
    return { run, agents, events, artifacts };
  }

  // ── Internal: phase transitions ───────────────────────────────────

  private async transitionPhase(run: RunState, trig: Parameters<typeof transition>[1]): Promise<void> {
    const ctx: MachineContext = {
      phase: run.phase,
      previousPhase: run.previousPhase,
      reviewCycle: run.reviewCycle,
      maxReviewCycles: run.config.maxReviewCycles ?? 3,
    };
    const result = transition(ctx, trig);
    if (!result.changed) return;
    const from = run.phase;
    run.phase = result.phase;
    run.previousPhase = result.previousPhase;
    run.reviewCycle = result.reviewCycle;

    await this.db.updateCruiseRun(run.runId, { current_phase: run.phase, review_cycle: run.reviewCycle });
    await this.appendEvent(run, null, EVENT_TYPES.PHASE_EXITED, { phase: from });
    await this.appendEvent(run, null, EVENT_TYPES.PHASE_ENTERED, { phase: run.phase, reviewCycle: run.reviewCycle });
    this.hooks.broadcast('cruise:phase-changed', { runId: run.runId, from, to: run.phase, at: Date.now() } as PhaseChangeSignal);

    // Activate / finalize as required
    if (run.phase === 'done') {
      await this.finalize(run, 'done');
      return;
    }
    if (run.phase === 'review-feedback') {
      // Cycle back to build with the previous review notes available
      await this.transitionPhase(run, { type: 'start' }); // synthesized to build
      return;
    }
    if (isLiveAgentPhase(run.phase)) {
      await this.promoteAgentToLead(run);
    }
  }

  private async finalize(run: RunState, status: 'done' | 'failed'): Promise<void> {
    // Kill any remaining agent tabs
    for (const ag of run.agents) {
      if (ag.tabId && ag.status !== 'killed' && ag.status !== 'completed') {
        try { this.ptyManager.kill(ag.tabId); } catch {}
        await this.db.updateCruiseAgent(ag.agentId, { status: 'killed', ended_at: new Date().toISOString() });
        this.agentByTabId.delete(ag.tabId);
        if (ag.cliSessionId) {
          this.agentByCliSession.delete(ag.cliSessionId);
          this.attention.unwatch(ag.cliSessionId);
        }
      }
    }
    await this.db.updateCruiseRun(run.runId, {
      status,
      current_phase: run.phase,
      ended_at: new Date().toISOString(),
    });
    await this.appendEvent(run, null, status === 'done' ? EVENT_TYPES.RUN_COMPLETED : EVENT_TYPES.RUN_FAILED, {});
    this.hooks.broadcast('cruise:run-finished', { runId: run.runId, status });
    this.runs.delete(run.runId);
  }

  // ── Internal: agent management ────────────────────────────────────

  /**
   * Drive whatever needs to happen at the start of the current phase.
   * Different phases have very different shapes now:
   *
   *   prd-refine   → spawn (or kickoff) the PRD Refiner
   *   plan-refine  → send the planContinuationPrompt into the PRD Refiner
   *                  (it stays alive across the prd→plan transition)
   *   build        → spawn every builder defined in the team; track per-
   *                  builder completion
   *   review       → spawn every reviewer defined in the team
   */
  private async promoteAgentToLead(run: RunState): Promise<void> {
    if (run.paused) return;

    if (run.phase === 'prd-refine') {
      const ag = run.agents.find(a => a.role === 'prd-refiner');
      if (!ag) {
        await this.appendEvent(run, null, EVENT_TYPES.ERROR, { reason: 'no prd-refiner configured' });
        return;
      }
      if (!ag.tabId) {
        (ag as any)._postKickoffPhasePrompt = true;
        await this.spawnAgent(run, ag);
      }
      return;
    }

    if (run.phase === 'plan-refine') {
      // PRD Refiner is already alive (or being spawned). Inject the
      // plan-continuation prompt so it produces DEVELOPMENT_PLAN.md.
      const ag = run.agents.find(a => a.role === 'prd-refiner');
      if (!ag) {
        await this.appendEvent(run, null, EVENT_TYPES.ERROR, { reason: 'plan-refine but no prd-refiner exists' });
        return;
      }
      const key = `${ag.role}:plan-refine`;
      if ((ag as any)._lastLeadKey === key) return;
      (ag as any)._lastLeadKey = key;
      if (!ag.tabId) {
        // PRD Refiner not spawned yet (shouldn't happen post-prd-refine, but be safe)
        (ag as any)._postKickoffPhasePrompt = true;
        await this.spawnAgent(run, ag);
        return;
      }
      const planMsg = planContinuationPrompt(this.promptCtx(run));
      await this.injectIntoAgent(ag.tabId, planMsg);
      await this.appendEvent(run, ag.agentId, EVENT_TYPES.AGENT_KICKED_OFF, { role: ag.role, leadPromotion: true, phase: 'plan-refine' });
      return;
    }

    if (run.phase === 'build') {
      // Spawn every builder in the team that isn't yet alive.
      if (!run.team) {
        await this.appendEvent(run, null, EVENT_TYPES.ERROR, { reason: 'build phase but no team parsed' });
        return;
      }
      for (const spec of run.team.builders) {
        const role = `builder-${spec.id}`;
        let ag = run.agents.find(a => a.role === role);
        if (!ag) {
          // Materialize the agent in DB + memory
          const label = spec.label;
          const programId = 'claude-code';
          const agentId = await this.db.createCruiseAgent(run.runId, role, programId, label);
          ag = {
            agentId, role, programId, label,
            tabId: null, cliSessionId: null, kickedOff: false,
            status: 'pending', pendingMessages: [],
          };
          run.agents.push(ag);
        }
        if (!ag.tabId) {
          (ag as any)._postKickoffPhasePrompt = false; // builderSlotPrompt is the full lead prompt
          await this.spawnAgent(run, ag);
        }
      }
      return;
    }

    if (run.phase === 'review') {
      // Spawn every reviewer; builders stay alive to receive routed tasks.
      if (!run.team) {
        await this.appendEvent(run, null, EVENT_TYPES.ERROR, { reason: 'review phase but no team parsed' });
        return;
      }
      for (const spec of run.team.reviewers) {
        const role = `reviewer-${spec.id}`;
        let ag = run.agents.find(a => a.role === role);
        if (!ag) {
          const label = spec.label;
          const programId = 'claude-code';
          const agentId = await this.db.createCruiseAgent(run.runId, role, programId, label);
          ag = {
            agentId, role, programId, label,
            tabId: null, cliSessionId: null, kickedOff: false,
            status: 'pending', pendingMessages: [],
          };
          run.agents.push(ag);
        }
        if (!ag.tabId) {
          await this.spawnAgent(run, ag);
        }
      }
    }
  }

  private async spawnAgent(run: RunState, ag: AgentState): Promise<void> {
    const binary = binaryForProgram(ag.programId);
    if (!binary) {
      await this.appendEvent(run, ag.agentId, EVENT_TYPES.ERROR, { reason: `no binary mapped for program ${ag.programId}` });
      return;
    }

    ag.status = 'spawning';
    await this.db.updateCruiseAgent(ag.agentId, { status: 'spawning' });

    // Build the launch command. For Claude Code agents we pass
    // --dangerously-skip-permissions so tool-permission prompts don't
    // stall the run (the user explicitly authorized the run on this repo
    // when starting it). One flag scales across all tool types and is
    // resilient to Claude Code prompt-copy updates.
    const launchCmd = buildLaunchCommand(ag.programId, binary);

    const label = `Cruise #${run.runId} · ${ag.label}`;
    const ctx: PendingTabContext = {
      cwd: run.config.targetRepo,
      initialCommand: launchCmd,
      source: 'cruise',
    };
    const tabId = this.hooks.spawnTab(label, ctx);
    ag.tabId = tabId;
    this.agentByTabId.set(tabId, { runId: run.runId, agentId: ag.agentId });
    await this.db.updateCruiseAgent(ag.agentId, { tab_id: tabId });
    await this.appendEvent(run, ag.agentId, EVENT_TYPES.AGENT_SPAWNED, { tabId, programId: ag.programId, role: ag.role });
  }

  /** Called when ptyManager.onCLIStatus reports the agent's CLI is live. */
  private async handleAgentCLIReady(runId: number, agentId: number, tabId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;
    const ag = run.agents.find(a => a.agentId === agentId);
    if (!ag) return;

    // Look up the cliSessionId from the active CLI
    // ptyManager exposes activeCLI per tab; reach in via getActiveCLI returns programId only,
    // but we can fish for the cli_session via DB on next event. For now mark as active.
    ag.status = 'active';
    await this.db.updateCruiseAgent(agentId, { status: 'active' });
    await this.appendEvent(run, agentId, EVENT_TYPES.AGENT_READY, { tabId });

    await this.kickoffAgent(run, ag);
  }

  private async handleAgentCLIExited(runId: number, agentId: number, _tabId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;
    const ag = run.agents.find(a => a.agentId === agentId);
    if (!ag) return;
    if (ag.cliSessionId) {
      this.attention.unwatch(ag.cliSessionId);
      this.agentByCliSession.delete(ag.cliSessionId);
    }
    // Don't immediately fail — the user may have exited the CLI mid-run on purpose.
    // Just log it.
    await this.appendEvent(run, agentId, EVENT_TYPES.AGENT_OUTPUT, { note: 'CLI exited' });
  }

  /** Map a cliSessionId to its (runId, agentId) by querying the DB for the tab_id. */
  private async maybeMapCliSession(cliSessionId: number): Promise<void> {
    if (this.agentByCliSession.has(cliSessionId)) return;

    // Find which tab this cliSession belongs to
    const tabId = this.ptyManager.getTabForCLISession(cliSessionId);
    if (!tabId) return;
    const ref = this.agentByTabId.get(tabId);
    if (!ref) return; // Not a cruise-managed tab
    this.agentByCliSession.set(cliSessionId, ref);

    // Update agent state
    const run = this.runs.get(ref.runId);
    if (run) {
      const ag = run.agents.find(a => a.agentId === ref.agentId);
      if (ag) {
        ag.cliSessionId = cliSessionId;
        await this.db.updateCruiseAgent(ag.agentId, { cli_session_id: cliSessionId });
        this.attention.watch(run.runId, ag.agentId, tabId, cliSessionId);
      }
    }
  }

  /**
   * Inject the role-specific full kickoff. Fires ONCE per agent when its CLI
   * first comes up. Subsequent phase transitions use `promoteAgentToLead`
   * which sends a much shorter "you are now leading" message instead of
   * re-establishing the agent's role from scratch.
   */
  private async kickoffAgent(run: RunState, ag: AgentState): Promise<void> {
    if (!ag.tabId) return;
    if (run.paused) return;
    if (ag.kickedOff) return;

    const promptCtx = this.promptCtx(run);
    let prompt: string;
    if (ag.role === 'prd-refiner') {
      prompt = prdRefinerPrompt(promptCtx);
    } else if (ag.role.startsWith('builder-')) {
      const id = ag.role.slice('builder-'.length);
      const spec = run.team?.builders.find(b => b.id === id);
      if (!spec) {
        await this.appendEvent(run, ag.agentId, EVENT_TYPES.ERROR, { reason: `no team spec for ${ag.role}` });
        return;
      }
      prompt = builderSlotPrompt(promptCtx, spec);
    } else if (ag.role.startsWith('reviewer-')) {
      const id = ag.role.slice('reviewer-'.length);
      const spec = run.team?.reviewers.find(r => r.id === id);
      if (!spec) {
        await this.appendEvent(run, ag.agentId, EVENT_TYPES.ERROR, { reason: `no team spec for ${ag.role}` });
        return;
      }
      prompt = reviewerSlotPrompt(promptCtx, spec);
    } else {
      await this.appendEvent(run, ag.agentId, EVENT_TYPES.ERROR, { reason: `unknown role ${ag.role}` });
      return;
    }

    await new Promise(r => setTimeout(r, 1500));
    await this.injectIntoAgent(ag.tabId, prompt);
    ag.kickedOff = true;
    await this.appendEvent(run, ag.agentId, EVENT_TYPES.AGENT_KICKED_OFF, { role: ag.role, reviewCycle: run.reviewCycle, promptBytes: prompt.length });

    // If this agent was spawned mid-run to become the new phase lead, send
    // the lead-promotion prompt right after the kickoff lands.
    if ((ag as any)._postKickoffPhasePrompt) {
      (ag as any)._postKickoffPhasePrompt = false;
      const leadMsg = phaseLeadPrompt(ag.role, run.phase, this.promptCtx(run));
      await new Promise(r => setTimeout(r, 500));
      await this.injectIntoAgent(ag.tabId, leadMsg);
      await this.appendEvent(run, ag.agentId, EVENT_TYPES.AGENT_KICKED_OFF, { role: ag.role, reviewCycle: run.reviewCycle, leadPromotion: true });
    }

    // Drain any messages that were queued for this agent before it was alive.
    if (ag.pendingMessages.length > 0) {
      const queued = ag.pendingMessages.splice(0);
      for (const msg of queued) {
        const payload = deliverMessage(msg.from, ag.role, msg.body);
        await new Promise(r => setTimeout(r, 400));
        await this.injectIntoAgent(ag.tabId, payload);
      }
    }
  }

  /** Build the PromptContext for this run (paths + cycle + carried review + team). */
  private promptCtx(run: RunState) {
    return {
      runId: run.runId,
      repoPath: run.config.targetRepo,
      runDir: path.relative(run.config.targetRepo, run.store.runDir(run.runId)) || '.cruise/runs/' + run.runId,
      reviewCycle: run.reviewCycle,
      previousReviewNotes: run.reviewCycle > 0 ? run.store.readReview(run.runId, run.reviewCycle - 1) || undefined : undefined,
      team: run.team ? { builders: run.team.builders, reviewers: run.team.reviewers } : undefined,
      projectMode: run.config.projectMode === 'existing' ? 'existing' as const : 'new' as const,
    };
  }

  /**
   * Inject text into an agent's TUI as a bracketed-paste block, then submit.
   * Splitting BPM_END and \r prevents the TUI from treating Enter as part
   * of the pasted content (Claude Code does this).
   */
  private async injectIntoAgent(tabId: string, text: string): Promise<void> {
    const BPM_START = '\x1b[200~';
    const BPM_END = '\x1b[201~';
    this.ptyManager.write(tabId, BPM_START + text + BPM_END);
    await new Promise(r => setTimeout(r, 250));
    this.ptyManager.write(tabId, '\r');
  }

  /**
   * Route a peer message from one agent to another (or to all, or to user).
   * Writes to the target's inbox file, persists in messages.jsonl, emits
   * audit events, and (for agent destinations) injects the message into
   * the target agent's TUI.
   */
  private async routeMessage(run: RunState, fromAgent: AgentState, target: MessageTarget, body: string): Promise<void> {
    const ts = new Date().toISOString();
    run.store.appendMessage(run.runId, { from: fromAgent.role, to: target, body, ts });
    await this.appendEvent(run, fromAgent.agentId, EVENT_TYPES.MESSAGE_SENT, {
      from: fromAgent.role,
      to: target,
      bodyPreview: body.slice(0, 200),
      bodyChars: body.length,
    });

    if (target === 'user') {
      // Surface as an attention signal so the UI highlights the run + sender tab
      if (fromAgent.tabId) {
        this.hooks.broadcast('cruise:attention', {
          runId: run.runId, agentId: fromAgent.agentId, tabId: fromAgent.tabId,
          reason: `message to user: ${body.slice(0, 120)}`,
          at: Date.now(),
        });
      }
      return;
    }

    const recipients: AgentState[] = [];
    if (target === 'all') {
      for (const a of run.agents) if (a.agentId !== fromAgent.agentId) recipients.push(a);
    } else {
      const a = run.agents.find(x => x.role === target);
      if (a) recipients.push(a);
    }

    if (recipients.length === 0) {
      await this.appendEvent(run, fromAgent.agentId, EVENT_TYPES.MESSAGE_UNDELIVERABLE, {
        from: fromAgent.role, to: target, reason: 'no matching recipient agent',
      });
      return;
    }

    for (const r of recipients) {
      if (!r.tabId) {
        // Lazy spawn: target agent isn't alive yet. Queue the message, spawn
        // the agent, and kickoffAgent will drain the queue once its CLI is up.
        r.pendingMessages.push({ from: fromAgent.role, body });
        await this.appendEvent(run, r.agentId, EVENT_TYPES.MESSAGE_ROUTED, {
          from: fromAgent.role, to: r.role, bodyChars: body.length, summoned: true,
        });
        await this.spawnAgent(run, r);
        continue;
      }
      const payload = deliverMessage(fromAgent.role, r.role, body);
      await this.injectIntoAgent(r.tabId, payload);
      await this.appendEvent(run, r.agentId, EVENT_TYPES.MESSAGE_ROUTED, {
        from: fromAgent.role, to: r.role, bodyChars: body.length,
      });
    }
  }

  // ── Internal: assistant output handling ──────────────────────────

  private async handleAssistantResponse(runId: number, agentId: number, content: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;
    if (run.paused) return;
    const fromAgent = run.agents.find(a => a.agentId === agentId);
    if (!fromAgent) return;

    // 1. Extract inter-agent MSG-TO blocks and route them.
    const msgExtract = extractMessages(content);
    for (const m of msgExtract.messages) {
      try { await this.routeMessage(run, fromAgent, m.target, m.body); }
      catch (e: any) {
        await this.appendEvent(run, fromAgent.agentId, EVENT_TYPES.ERROR, {
          reason: `routeMessage failed`, target: m.target, error: e?.message,
        });
      }
    }

    // 2. Extract TASK-FOR-{owner} blocks. Persist + route to the owner.
    const taskExtract = extractTasks(msgExtract.residual);
    for (const t of taskExtract.tasks) {
      try { await this.persistAndRouteTask(run, fromAgent, t.owner, t.severity, t.body, t.related || null); }
      catch (e: any) {
        await this.appendEvent(run, fromAgent.agentId, EVENT_TYPES.ERROR, {
          reason: `persistAndRouteTask failed`, owner: t.owner, error: e?.message,
        });
      }
    }

    const residual = taskExtract.residual;

    // 3. Snapshot the residual for audit
    const preview = residual.slice(0, 300);
    await this.appendEvent(run, agentId, EVENT_TYPES.AGENT_OUTPUT, {
      preview, totalChars: residual.length, role: fromAgent.role,
    });

    // 4. Phase-completion markers (scope-dependent)
    if (residual.includes(MARKERS.PRD_DRAFT_COMPLETE) && run.phase === 'prd-refine') {
      await this.transitionPhase(run, { type: 'prd-draft-complete' });
      return;
    }

    if (residual.includes(MARKERS.DEV_PLAN_COMPLETE) && run.phase === 'plan-refine') {
      // Parse the TEAM block, persist, then advance to build.
      const parsed = extractTeam(residual) || (() => {
        // Fallback: try to read DEVELOPMENT_PLAN.md from disk
        try {
          const planPath = path.join(run.config.targetRepo, 'DEVELOPMENT_PLAN.md');
          if (fs.existsSync(planPath)) {
            const txt = fs.readFileSync(planPath, 'utf-8');
            return extractTeam(txt);
          }
        } catch {}
        return null;
      })();

      if (!parsed) {
        await this.appendEvent(run, agentId, EVENT_TYPES.TEAM_PLAN_INVALID, { reason: 'no TEAM block found' });
        return;
      }
      const { team, notes } = clampTeam(parsed);
      if (team.builders.length === 0) {
        await this.appendEvent(run, agentId, EVENT_TYPES.TEAM_PLAN_INVALID, { reason: 'no builders', notes });
        return;
      }
      run.team = team;
      await this.appendEvent(run, null, EVENT_TYPES.TEAM_PLANNED, {
        builders: team.builders.map(b => ({ id: b.id, label: b.label, focus: b.focus })),
        reviewers: team.reviewers.map(r => ({ id: r.id, label: r.label, focus: r.focus })),
        notes,
      });
      await this.transitionPhase(run, { type: 'dev-plan-complete' });
      return;
    }

    // Multi-builder BUILD_COMPLETE: only fire the phase trigger when ALL
    // builders have individually emitted their completion marker.
    if (residual.includes(MARKERS.BUILD_COMPLETE) && run.phase === 'build' && fromAgent.role.startsWith('builder-')) {
      run.buildersCompleted.add(fromAgent.role);
      fromAgent.status = 'completed';
      await this.db.updateCruiseAgent(fromAgent.agentId, { status: 'completed', ended_at: new Date().toISOString() });
      await this.appendEvent(run, fromAgent.agentId, EVENT_TYPES.AGENT_OUTPUT, {
        role: fromAgent.role, note: 'BUILD_COMPLETE',
        completedCount: run.buildersCompleted.size,
        totalBuilders: run.team?.builders.length ?? 0,
      });
      const total = run.team?.builders.length ?? 0;
      if (run.buildersCompleted.size >= total && total > 0) {
        await this.transitionPhase(run, { type: 'build-complete' });
      }
      return;
    }

    // Multi-reviewer REVIEW_ACCEPT: only fire when ALL reviewers have accepted.
    if (residual.includes(MARKERS.REVIEW_ACCEPT) && run.phase === 'review' && fromAgent.role.startsWith('reviewer-')) {
      run.reviewersAccepted.add(fromAgent.role);
      fromAgent.status = 'completed';
      await this.db.updateCruiseAgent(fromAgent.agentId, { status: 'completed', ended_at: new Date().toISOString() });
      await this.appendEvent(run, null, EVENT_TYPES.REVIEW_DECISION, {
        decision: 'accept', cycle: run.reviewCycle, by: fromAgent.role,
        acceptedCount: run.reviewersAccepted.size,
        totalReviewers: run.team?.reviewers.length ?? 0,
      });
      const total = run.team?.reviewers.length ?? 0;
      if (run.reviewersAccepted.size >= total && total > 0) {
        await this.transitionPhase(run, { type: 'review-accept' });
      }
      return;
    }

    if (residual.includes(MARKERS.REVIEW_REQUEST_CHANGES) && run.phase === 'review' && fromAgent.role.startsWith('reviewer-')) {
      await this.appendEvent(run, null, EVENT_TYPES.REVIEW_DECISION, {
        decision: 'request-changes', cycle: run.reviewCycle, by: fromAgent.role,
      });
      // Reset per-cycle trackers
      run.buildersCompleted.clear();
      run.reviewersAccepted.clear();
      await this.transitionPhase(run, { type: 'review-request-changes' });
      return;
    }
  }

  /**
   * Persist a TASK-FOR-{owner} into cruise_tasks AND deliver it as a message
   * into the owner's TUI. If the owner agent isn't alive yet, the message
   * gets queued via routeMessage's lazy-spawn path.
   */
  private async persistAndRouteTask(
    run: RunState,
    fromAgent: AgentState,
    owner: string,
    severity: 'low' | 'medium' | 'high' | 'critical' | 'info',
    body: string,
    related: string | null,
  ): Promise<void> {
    const taskId = await this.db.createCruiseTask(run.runId, fromAgent.agentId, owner, severity, body, related);
    await this.appendEvent(run, fromAgent.agentId, EVENT_TYPES.TASK_CREATED, {
      taskId, from: fromAgent.role, owner, severity,
      bodyPreview: body.slice(0, 200), related,
    });

    // Mirror to .cruise/runs/{id}/tasks.md (append-only)
    try {
      const tasksFile = path.join(run.store.runDir(run.runId), 'tasks.md');
      const block = `\n## Task #${taskId} → ${owner}  (${severity})  · from ${fromAgent.role}\n${related ? `Related: ${related}\n` : ''}\n${body}\n`;
      fs.appendFileSync(tasksFile, block);
    } catch {}

    // Deliver as a message into the owner's session
    const wrappedBody =
      `[TASK #${taskId} · severity=${severity}${related ? ` · related=${related}` : ''}]\n\n` +
      body +
      `\n\nWhen this task is resolved, reply with MSG-TO-${fromAgent.role} confirming the fix.`;
    await this.routeMessage(run, fromAgent, owner as MessageTarget, wrappedBody);
  }

  // ── Internal: attention plumbing ─────────────────────────────────

  private async handleAttention(signal: AttentionSignal): Promise<void> {
    const run = this.runs.get(signal.runId);
    if (!run) return;
    const ag = run.agents.find(a => a.agentId === signal.agentId);
    if (!ag) return;
    ag.status = 'needs-input';
    await this.db.updateCruiseAgent(signal.agentId, { status: 'needs-input' });
    await this.appendEvent(run, signal.agentId, EVENT_TYPES.AGENT_ATTENTION, { reason: signal.reason, tabId: signal.tabId });
    this.hooks.broadcast('cruise:attention', signal);
  }

  private async clearAttention(runId: number, agentId: number, tabId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;
    const ag = run.agents.find(a => a.agentId === agentId);
    if (!ag) return;
    if (ag.status === 'needs-input') {
      ag.status = 'active';
      await this.db.updateCruiseAgent(agentId, { status: 'active' });
    }
    this.hooks.broadcast('cruise:attention-cleared', { runId, agentId, tabId, at: Date.now() });
  }

  // ── Internal: rehydration after Stop+Resume ──────────────────────

  private async rehydrateRun(runId: number): Promise<void> {
    const dbRun = await this.db.getCruiseRun(runId);
    if (!dbRun) throw new Error(`run ${runId} not found`);
    const agents = await this.db.getCruiseAgents(runId);

    const store = new ArtifactStore(dbRun.target_repo);

    // Resurrect agent slots (fresh tabId/cliSessionId — those will be assigned anew)
    const agentStates: AgentState[] = agents.map(a => ({
      agentId: a.id,
      role: a.role as CruiseAgentRole,
      programId: a.program_id,
      label: a.label || a.role,
      tabId: null,
      cliSessionId: null,
      kickedOff: false,
      status: 'pending',
      pendingMessages: [],
    }));

    // Try to recover the team roster from DEVELOPMENT_PLAN.md so resumed
    // runs (and Continue-from-Done) have the slot specs every builder/
    // reviewer agent's kickoff prompt needs.
    let team: TeamSpec | null = null;
    try {
      const planPath = path.join(dbRun.target_repo, 'DEVELOPMENT_PLAN.md');
      if (fs.existsSync(planPath)) {
        const txt = fs.readFileSync(planPath, 'utf-8');
        const parsed = extractTeam(txt);
        if (parsed) team = clampTeam(parsed).team;
      }
    } catch {}

    const run: RunState = {
      runId,
      config: typeof dbRun.config === 'string' ? JSON.parse(dbRun.config) : dbRun.config,
      store,
      phase: dbRun.current_phase,
      previousPhase: null,
      reviewCycle: dbRun.review_cycle,
      agents: agentStates,
      paused: false,
      team,
      buildersCompleted: new Set(),
      reviewersAccepted: new Set(),
    };
    this.runs.set(runId, run);
    await this.appendEvent(run, null, EVENT_TYPES.RUN_RESUMED, { source: 'rehydrate', phase: run.phase });
  }

  // ── Internal: helpers ────────────────────────────────────────────

  private requireRun(runId: number): RunState {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`run ${runId} is not active in this orchestrator (may have ended or never started)`);
    return run;
  }

  private async appendEvent(run: RunState, agentId: number | null, type: string, payload: any): Promise<void> {
    const phase = run.phase;
    const ts = new Date().toISOString();
    const evt = { runId: run.runId, agentId, type, phase, payload, ts };
    try {
      await this.db.appendCruiseEvent(run.runId, agentId, type, phase, payload);
      run.store.appendAudit(run.runId, evt);
    } catch {}
    this.hooks.broadcast('cruise:event', evt);
  }
}

function roleForPhase(phase: CruisePhase): CruiseAgentRole | null {
  switch (phase) {
    case 'prd-refine': return 'prd-refiner';
    case 'build':
    case 'review-feedback':
      return 'builder';
    case 'review': return 'reviewer';
    default: return null;
  }
}

function binaryForProgram(programId: string): string | null {
  // Map programId → shell command. Extend as new agent backends are supported.
  switch (programId) {
    case 'claude-code': return 'claude';
    case 'codex':       return 'codex';
    case 'aider':       return 'aider';
    default: return null;
  }
}

/**
 * Wrap a CLI binary with the flags Cruise wants every launch to use.
 *
 * For Claude Code: --dangerously-skip-permissions. Inside a Cruise run, the
 * user has explicitly authorized agents to act on the target repo, so the
 * tool-permission gating would just be friction — and one flag scales
 * uniformly across every Bash/Edit/Write/MCP call, where per-tool
 * settings.json patterns would need ongoing maintenance.
 */
function buildLaunchCommand(programId: string, binary: string): string {
  switch (programId) {
    case 'claude-code': return `${binary} --dangerously-skip-permissions`;
    default:            return binary;
  }
}
