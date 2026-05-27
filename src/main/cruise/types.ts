/**
 * Cruise Control — shared types.
 *
 * These re-export the DB types (the source of truth) plus orchestrator-internal
 * runtime shapes that don't belong in the schema.
 */

export type {
  CruisePhase,
  CruiseRunStatus,
  CruiseAgentRole,
  CruiseAgentStatus,
  CruiseRunConfig,
  CruiseRun,
  CruiseAgent,
  CruiseEvent,
  CruiseCheckpoint,
} from '../database';

import { CruisePhase, CruiseAgentRole } from '../database';

/**
 * Default agents for a Cruise run.
 *
 * All three are Claude Code sessions. Codex participates as a TOOL each
 * Claude session can invoke via the `/codex:adversarial-review` (or
 * `/codex:review`) slash command, not as a separate peer agent.
 *
 * Rationale: Claude Code is strong at structured output + tool use +
 * conversation; using it across roles keeps the protocol consistent, and
 * delegating review to Codex from inside a Claude session gives us
 * adversarial / second-opinion analysis without managing a separate CLI's
 * lifecycle.
 */
export const DEFAULT_AGENT_CONFIG: Array<{ role: CruiseAgentRole; programId: string; label: string }> = [
  { role: 'prd-refiner', programId: 'claude-code', label: 'PRD Refiner' },
  { role: 'builder',     programId: 'claude-code', label: 'Builder' },
  { role: 'reviewer',    programId: 'claude-code', label: 'Reviewer' },
];

/** Markers agents emit on stdout to signal phase completion */
export const MARKERS = {
  PRD_DRAFT_COMPLETE:        '===CRUISE:PRD-DRAFT-COMPLETE===',
  DEV_PLAN_COMPLETE:         '===CRUISE:DEV-PLAN-COMPLETE===',
  BUILD_COMPLETE:            '===CRUISE:BUILD-COMPLETE===',
  REVIEW_ACCEPT:             '===CRUISE:REVIEW-ACCEPT===',
  REVIEW_REQUEST_CHANGES:    '===CRUISE:REVIEW-REQUEST-CHANGES===',
  ATTENTION_REQUIRED:        '===CRUISE:NEED-USER-INPUT===',
} as const;

/** Block markers for structured embedded data inside an agent's output */
export const BLOCKS = {
  TEAM_BEGIN: '===CRUISE:TEAM-BEGIN===',
  TEAM_END:   '===CRUISE:TEAM-END===',
  GOAL_BEGIN: '===CRUISE:GOAL===',
  GOAL_END:   '===CRUISE:END===',
} as const;

/** Caps the orchestrator enforces on a parsed team plan */
export const TEAM_CAPS = {
  MIN_BUILDERS: 1,
  MAX_BUILDERS: 3,
  MIN_REVIEWERS: 1,
  MAX_REVIEWERS: 2,
} as const;

export interface TeamSpec {
  builders: Array<TeamMemberSpec>;
  reviewers: Array<TeamMemberSpec>;
}

export interface TeamMemberSpec {
  id: string;          // short id used in MSG-TO addresses, e.g. "backend"
  label: string;       // human-friendly card label, e.g. "Backend Builder"
  focus: string;       // 1-2 sentence description of this member's slice
  files?: string;      // optional ownership hint, e.g. "apps/api/, infra/db/"
}

/** Task prefix: ===CRUISE:TASK-FOR-{owner} severity=high=== … ===CRUISE:END=== */
export const TASK_PREFIX = '===CRUISE:TASK-FOR-';
export const TASK_SUFFIX = '===';

/**
 * Multi-agent message protocol.
 * An agent addresses another by emitting (on lines by themselves):
 *
 *   ===CRUISE:MSG-TO-builder===
 *   <body — can be multiple paragraphs>
 *   ===CRUISE:END===
 *
 * Valid destinations: prd-refiner, builder, reviewer, user, all.
 */
export const MSG_PREFIX = '===CRUISE:MSG-TO-';
export const MSG_SUFFIX = '===';
export const MSG_END = '===CRUISE:END===';

export type MessageTarget = 'prd-refiner' | 'builder' | 'reviewer' | 'user' | 'all';

export interface ExtractedMessage {
  target: MessageTarget;
  body: string;
}

/**
 * Pull all complete MSG-TO blocks out of an assistant_response chunk.
 * Returns the extracted messages and the residual text (with messages stripped),
 * so callers can still scan residual text for phase markers.
 */
export function extractMessages(content: string): { messages: ExtractedMessage[]; residual: string } {
  const messages: ExtractedMessage[] = [];
  const lines = content.split('\n');
  const residualLines: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith(MSG_PREFIX) && trimmed.endsWith(MSG_SUFFIX)) {
      const target = trimmed.slice(MSG_PREFIX.length, -MSG_SUFFIX.length).toLowerCase().trim();
      // Find matching MSG_END on a later line
      let endIdx = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === MSG_END) { endIdx = j; break; }
      }
      if (endIdx === -1) {
        // Unterminated — leave it in residual so partial streams aren't lost
        residualLines.push(line);
        i++;
        continue;
      }
      const body = lines.slice(i + 1, endIdx).join('\n').trim();
      if (isValidTarget(target) && body.length > 0) {
        messages.push({ target: target as MessageTarget, body });
      }
      i = endIdx + 1;
    } else {
      residualLines.push(line);
      i++;
    }
  }

  return { messages, residual: residualLines.join('\n') };
}

function isValidTarget(_t: string): boolean {
  // Targets are validated by the orchestrator against the live agent
  // registry for the run (since builder ids and reviewer ids are dynamic).
  // We accept any non-empty short token here; the orchestrator will mark
  // unresolvable ones as undeliverable.
  return true;
}

/**
 * Parse a TEAM block out of arbitrary text (typically an agent's output
 * or the contents of DEVELOPMENT_PLAN.md). The expected format is a
 * lightweight YAML-ish list — no full YAML parser dependency:
 *
 *   ===CRUISE:TEAM-BEGIN===
 *   builders:
 *     - id: backend
 *       label: Backend Builder
 *       focus: API service and database
 *       files: apps/api/, infra/db/
 *     - id: frontend
 *       label: Frontend Builder
 *       focus: React UI and state mgmt
 *       files: apps/web/
 *   reviewers:
 *     - id: primary
 *       label: Primary Reviewer
 *       focus: PRD coverage + correctness
 *   ===CRUISE:TEAM-END===
 *
 * Returns null if no complete block is found.
 */
export function extractTeam(content: string): TeamSpec | null {
  const startIdx = content.indexOf(BLOCKS.TEAM_BEGIN);
  if (startIdx === -1) return null;
  const after = content.slice(startIdx + BLOCKS.TEAM_BEGIN.length);
  const endIdx = after.indexOf(BLOCKS.TEAM_END);
  if (endIdx === -1) return null;
  const body = after.slice(0, endIdx);

  const team: TeamSpec = { builders: [], reviewers: [] };
  const lines = body.split('\n');
  let section: 'builders' | 'reviewers' | null = null;
  let cur: Partial<TeamMemberSpec> | null = null;

  const flush = () => {
    if (!cur) return;
    if (!cur.id || !cur.label || !cur.focus) { cur = null; return; }
    const member: TeamMemberSpec = { id: cur.id, label: cur.label, focus: cur.focus, files: cur.files };
    if (section === 'builders') team.builders.push(member);
    else if (section === 'reviewers') team.reviewers.push(member);
    cur = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Section header
    if (/^builders\s*:/i.test(trimmed)) { flush(); section = 'builders'; continue; }
    if (/^reviewers\s*:/i.test(trimmed)) { flush(); section = 'reviewers'; continue; }
    if (section == null) continue;

    // New member entry starts with "- id:"
    const newItem = trimmed.match(/^-\s*id\s*:\s*(.+)$/i);
    if (newItem) {
      flush();
      cur = { id: newItem[1].trim().replace(/^["']|["']$/g, '') };
      continue;
    }
    // Continuation field
    const kv = trimmed.match(/^([a-z_]+)\s*:\s*(.+)$/i);
    if (kv && cur) {
      const key = kv[1].toLowerCase();
      const val = kv[2].trim().replace(/^["']|["']$/g, '');
      if (key === 'label' || key === 'focus' || key === 'files') {
        (cur as any)[key] = val;
      } else if (key === 'id') {
        cur.id = val;
      }
    }
  }
  flush();

  return team;
}

export interface ExtractedTask {
  owner: string;          // role id this task is assigned to
  severity: 'low' | 'medium' | 'high' | 'critical' | 'info';
  body: string;
  related?: string;       // optional file:line or area
  goalId?: number;        // optional goal id this task addresses (goal=N)
}

/**
 * Pull TASK-FOR-{owner} blocks from arbitrary text. Format:
 *   ===CRUISE:TASK-FOR-builder-backend severity=high goal=12===
 *   <body>
 *   ===CRUISE:END===
 *
 * Severity defaults to "medium" if not specified or unrecognized.
 * `goal=N` is optional; when present it links the task to cruise_goals.id N.
 */
export function extractTasks(content: string): { tasks: ExtractedTask[]; residual: string } {
  const tasks: ExtractedTask[] = [];
  const lines = content.split('\n');
  const residualLines: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith(TASK_PREFIX) && trimmed.endsWith(TASK_SUFFIX)) {
      const inner = trimmed.slice(TASK_PREFIX.length, -TASK_SUFFIX.length);
      // Split owner from key=value pairs (space-separated)
      const parts = inner.split(/\s+/);
      const owner = parts[0]?.toLowerCase().trim();
      let severity: ExtractedTask['severity'] = 'medium';
      let related: string | undefined = undefined;
      let goalId: number | undefined = undefined;
      for (let p = 1; p < parts.length; p++) {
        const [k, v] = parts[p].split('=');
        if (k === 'severity' && v) {
          const sev = v.toLowerCase();
          if (sev === 'low' || sev === 'medium' || sev === 'high' || sev === 'critical' || sev === 'info') {
            severity = sev;
          }
        } else if (k === 'related' && v) {
          related = v;
        } else if (k === 'goal' && v) {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && n > 0) goalId = n;
        }
      }
      let endIdx = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '===CRUISE:END===') { endIdx = j; break; }
      }
      if (endIdx === -1) {
        residualLines.push(lines[i]);
        i++;
        continue;
      }
      const body = lines.slice(i + 1, endIdx).join('\n').trim();
      if (owner && body) tasks.push({ owner, severity, body, related, goalId });
      i = endIdx + 1;
    } else {
      residualLines.push(lines[i]);
      i++;
    }
  }
  return { tasks, residual: residualLines.join('\n') };
}

export interface ExtractedGoal {
  title: string;
  description?: string;
  acceptanceCriteria: string[];
  owner?: string;
}

/**
 * Pull CRUISE:GOAL blocks from arbitrary text. Format:
 *
 *   ===CRUISE:GOAL===
 *   title: Implement signup with email verification
 *   owner: builder-backend
 *   acceptance:
 *     - POST /signup returns 201 and creates a user
 *     - Verification email is enqueued for the new address
 *   description: |
 *     First-pass signup flow per PRD section 2.1.
 *   ===CRUISE:END===
 *
 * A goal MUST have a non-empty title. Owner is optional (null = run-level).
 * The `description` field uses YAML-style block scalar via "|" — every
 * following indented line up to the next top-level key is captured as-is.
 */
export function extractGoals(content: string): { goals: ExtractedGoal[]; residual: string } {
  const goals: ExtractedGoal[] = [];
  const lines = content.split('\n');
  const residualLines: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed === BLOCKS.GOAL_BEGIN) {
      let endIdx = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === BLOCKS.GOAL_END) { endIdx = j; break; }
      }
      if (endIdx === -1) {
        residualLines.push(lines[i]);
        i++;
        continue;
      }
      const body = lines.slice(i + 1, endIdx);
      const g = parseGoalBody(body);
      if (g && g.title) goals.push(g);
      i = endIdx + 1;
    } else {
      residualLines.push(lines[i]);
      i++;
    }
  }
  return { goals, residual: residualLines.join('\n') };
}

function parseGoalBody(lines: string[]): ExtractedGoal | null {
  let title = '';
  let owner: string | undefined;
  const acceptance: string[] = [];
  let description: string | undefined;

  let mode: 'top' | 'acceptance' | 'description' = 'top';
  let descIndent = -1;
  const descLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '');
    const trimmed = raw.trim();

    if (mode === 'description') {
      // capture indented lines as-is; stop on a new top-level key or empty-then-key
      if (trimmed === '') { descLines.push(''); continue; }
      const indent = raw.length - raw.replace(/^\s+/, '').length;
      const looksLikeTopKey = /^[a-z_]+\s*:/i.test(trimmed) && indent <= (descIndent === -1 ? 0 : descIndent - 1);
      if (looksLikeTopKey) {
        mode = 'top';
        // fall through to top-key handling below
      } else {
        if (descIndent === -1) descIndent = indent;
        descLines.push(raw.slice(Math.min(indent, descIndent)));
        continue;
      }
    }

    if (mode === 'acceptance') {
      const item = trimmed.match(/^-\s+(.+)$/);
      if (item) { acceptance.push(item[1].trim()); continue; }
      if (trimmed === '') continue;
      // Not a list item — fall through to top-key handling
      mode = 'top';
    }

    if (mode === 'top') {
      if (trimmed === '') continue;
      const kv = trimmed.match(/^([a-z_]+)\s*:\s*(.*)$/i);
      if (!kv) continue;
      const key = kv[1].toLowerCase();
      const val = kv[2];
      if (key === 'title') {
        title = val.trim().replace(/^["']|["']$/g, '');
      } else if (key === 'owner') {
        const o = val.trim().replace(/^["']|["']$/g, '');
        if (o) owner = o;
      } else if (key === 'acceptance') {
        mode = 'acceptance';
      } else if (key === 'description') {
        if (val.trim() === '|' || val.trim() === '') {
          mode = 'description';
          descIndent = -1;
        } else {
          description = val.trim().replace(/^["']|["']$/g, '');
        }
      }
    }
  }

  if (mode === 'description' && descLines.length > 0) {
    description = descLines.join('\n').trim();
  }
  if (!title) return null;
  return { title, description, acceptanceCriteria: acceptance, owner };
}

/** Clamp a parsed TeamSpec to the protocol caps. Returns the clamped spec
 *  plus a list of human-readable notes about anything that was trimmed. */
export function clampTeam(spec: TeamSpec): { team: TeamSpec; notes: string[] } {
  const notes: string[] = [];
  let builders = spec.builders;
  let reviewers = spec.reviewers;

  if (builders.length > TEAM_CAPS.MAX_BUILDERS) {
    notes.push(`Capped builders from ${builders.length} to ${TEAM_CAPS.MAX_BUILDERS}.`);
    builders = builders.slice(0, TEAM_CAPS.MAX_BUILDERS);
  }
  if (reviewers.length > TEAM_CAPS.MAX_REVIEWERS) {
    notes.push(`Capped reviewers from ${reviewers.length} to ${TEAM_CAPS.MAX_REVIEWERS}.`);
    reviewers = reviewers.slice(0, TEAM_CAPS.MAX_REVIEWERS);
  }
  if (builders.length < TEAM_CAPS.MIN_BUILDERS) {
    notes.push(`Team has no builders; the plan must list at least 1.`);
  }
  if (reviewers.length < TEAM_CAPS.MIN_REVIEWERS) {
    notes.push(`Team has no reviewers; defaulting to a single Primary Reviewer.`);
    reviewers = [{ id: 'primary', label: 'Primary Reviewer', focus: 'Verify PRD coverage, correctness, AGENTS.md conventions, and security.' }];
  }

  return { team: { builders, reviewers }, notes };
}

/** Event type names written to cruise_events (audit log) */
export const EVENT_TYPES = {
  RUN_STARTED:        'run.started',
  RUN_PAUSED:         'run.paused',
  RUN_RESUMED:        'run.resumed',
  RUN_STOPPED:        'run.stopped',
  RUN_COMPLETED:      'run.completed',
  RUN_FAILED:         'run.failed',
  PHASE_ENTERED:      'phase.entered',
  PHASE_EXITED:       'phase.exited',
  AGENT_SPAWNED:      'agent.spawned',
  AGENT_READY:        'agent.ready',
  AGENT_KICKED_OFF:   'agent.kicked-off',
  AGENT_KILLED:       'agent.killed',
  AGENT_OUTPUT:       'agent.output',
  AGENT_ATTENTION:    'agent.attention',
  MESSAGE_SENT:       'message.sent',
  MESSAGE_ROUTED:     'message.routed',
  MESSAGE_UNDELIVERABLE: 'message.undeliverable',
  ARTIFACT_WRITTEN:   'artifact.written',
  USER_APPROVAL:      'user.approval',
  REVIEW_DECISION:    'review.decision',
  CHECKPOINT_SAVED:   'checkpoint.saved',
  TEAM_PLANNED:       'team.planned',
  TEAM_PLAN_INVALID:  'team.plan-invalid',
  TASK_CREATED:       'task.created',
  TASK_RESOLVED:      'task.resolved',
  GOAL_CREATED:       'goal.created',
  GOAL_UPDATED:       'goal.updated',
  ERROR:              'error',
} as const;

/** Runtime status broadcast to renderer (not persisted) */
export interface AttentionSignal {
  runId: number;
  agentId: number;
  tabId: string;
  reason: string;
  at: number;
}

export interface PhaseChangeSignal {
  runId: number;
  from: CruisePhase;
  to: CruisePhase;
  at: number;
}
