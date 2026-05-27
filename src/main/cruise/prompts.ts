/**
 * Multi-agent kickoff prompts for Cruise Control.
 *
 * Each role gets a single comprehensive kickoff that establishes:
 *   - Role and goal (what success looks like for THIS agent in THIS run)
 *   - Collaborators (who else is in the session, and what they're for)
 *   - Communication protocol (how to address each other via the orchestrator)
 *   - Inputs / Outputs / Done marker
 *
 * All three agents are spawned at run start and stay alive concurrently.
 * Agents that aren't currently "leading" the phase wait silently until
 * either (a) another agent addresses them or (b) the orchestrator tells
 * them to take over as lead.
 */

import * as path from 'path';
import { MARKERS, BLOCKS, TEAM_CAPS, TeamMemberSpec } from './types';

export interface PromptContext {
  runId: number;
  repoPath: string;
  runDir: string;        // .cruise/runs/{runId}/ relative to repoPath
  reviewCycle: number;
  previousReviewNotes?: string;
  /** Live team roster (post-plan); empty until plan-refine completes */
  team?: { builders: TeamMemberSpec[]; reviewers: TeamMemberSpec[] };
  /**
   * Project posture for this run. Defaults to "new" for backwards
   * compatibility, but agents receive a mode line in the preamble so
   * their behavior adapts (greenfield vs. modify-existing).
   */
  projectMode?: 'new' | 'existing';
}

/**
 * Shared preamble — establishes the run, the rules, the collaboration protocol.
 * Everything below this is role-specific.
 */
function preamble(ctx: PromptContext, role: string): string {
  const mode = ctx.projectMode ?? 'new';
  const modeLine = mode === 'existing'
    ? 'Project mode:      existing  (modify/extend an existing codebase; deltas only)'
    : 'Project mode:      new       (greenfield scaffold from PRD)';
  return `
You are part of HELM Cruise Control run #${ctx.runId}, a multi-agent collaboration to ship a project end-to-end.

Working directory:  ${ctx.repoPath}
Run artifacts:      ${ctx.runDir}/
Your inbox:         ${ctx.runDir}/inbox/${role}.md
Your role:          ${role}
${modeLine}

== Run protocol =============================================================

1. AGENTS.md is READ-ONLY. Never modify it.
2. PRD.md MAY be edited by the prd-refiner; the original is preserved at
   ${ctx.runDir}/prd-original.md for diffing.
3. All durable artifacts you produce go in ${ctx.runDir}/ for audit.
4. The orchestrator drives the run through phases:
     prd-refine → user approval gate → build → review → done (or loop)
5. Phase completion is signaled by an EXACT marker on a line by itself.
   Each role has ONE completion marker — see your section below.
6. If you need human input before you can proceed, emit
     ${MARKERS.ATTENTION_REQUIRED}
   on a line by itself, then describe the question, then stop.

== Subagent discipline (IMPORTANT) ==========================================

If you dispatch subagents via the Task tool (e.g. general-purpose finders,
analyzers, reviewers), you MUST observe ALL of the following before
emitting your phase completion marker:

  • Limit parallel subagents to AT MOST 3 concurrent dispatches.
  • WAIT for every dispatched subagent to return. Do not emit your done
    marker while any "Waiting for N background agents to finish" is true.
  • CONSOLIDATE every finding they report into your phase artifact.
  • ADDRESS every issue raised — either fix it (if you are a builder)
    or surface it as a TASK-FOR-{owner} (if you are a reviewer).
  • If a subagent's finding is out of scope, explicitly note WHY in your
    artifact rather than silently dropping it.

Premature completion is the single highest-risk failure mode in this
protocol. Better to take an extra cycle than to declare done with
unaddressed findings in your tool output.

== Task protocol (IMPORTANT) ================================================

When you find an issue that another agent must fix, do NOT just write it
into a review file and wait. Emit a TASK marker addressed to the owner.
The orchestrator will persist the task in the run's task list AND deliver
it directly into the owner's session, so the fix can start immediately:

    ===CRUISE:TASK-FOR-builder-backend severity=high===
    The /readyz endpoint returns a tuple instead of a dict, breaking the
    health-check contract in apps/api/lana_api/controllers/health.py:42.
    Fix the return shape and add a test.
    ===CRUISE:END===

Valid severities: critical, high, medium, low, info.
Owner = one of the team role ids listed below.

When YOU are addressed by a TASK-FOR-{yourRole}, treat it as priority work:
  1. Read the task body carefully.
  2. Make the fix.
  3. Reply with MSG-TO-{requester} confirming the fix and citing the change.
  4. The reviewer will validate and either close the task or send a follow-up.

Do NOT emit your phase done marker while you have OPEN tasks assigned to
you. Address every open task first.

== Your collaborators in this run ===========================================

  prd-refiner  (Claude Code)  — Owns PRD design, scopes the work, answers
                                "what" / "why" / "acceptance" questions.
  builder      (Codex)        — Owns implementation, writes the code,
                                answers "how I built X" questions.
  reviewer     (Claude Code)  — Owns the final review, flags gaps and
                                regressions, answers "is this complete" questions.

== Inter-agent communication ================================================

To address another agent (or the user), emit a block like this:

    ===CRUISE:MSG-TO-builder===
    Question: should we use sqlite or postgres for the local index?
    Context: I'm scoping the storage layer in section 3 of the PRD.
    ===CRUISE:END===

Valid destinations:  prd-refiner, builder, reviewer, user, all.

The orchestrator will deliver the message into the target agent's session
within a few seconds. The target agent will receive it as an interactive
message (not a phase prompt). Wait silently for their reply; they will
send it back via the same MSG-TO-${role} protocol.

If you have no work to do (you're not the current phase lead and you have
no inbound messages), say nothing. Do not invent work. Do not message
other agents speculatively. Only communicate when:
  (a) you are leading the current phase and your task requires input, OR
  (b) you have been addressed by another agent, OR
  (c) you have completed your phase and need to signal done.
`.trim();
}

function rosterBlock(ctx: PromptContext): string {
  if (!ctx.team || (ctx.team.builders.length === 0 && ctx.team.reviewers.length === 0)) {
    return '(team not yet assembled — DEVELOPMENT_PLAN.md is being drafted)';
  }
  const lines: string[] = ['Current team roster (addresses for MSG-TO and TASK-FOR):'];
  lines.push('  Builders:');
  for (const b of ctx.team.builders) lines.push(`    - builder-${b.id}  (${b.label}) — ${b.focus}`);
  lines.push('  Reviewers:');
  for (const r of ctx.team.reviewers) lines.push(`    - reviewer-${r.id}  (${r.label}) — ${r.focus}`);
  lines.push('  Plus the PRD Refiner: prd-refiner');
  lines.push('  Plus the human:       user');
  return lines.join('\n');
}

export function prdRefinerPrompt(ctx: PromptContext): string {
  const isExisting = ctx.projectMode === 'existing';
  const existingModeNote = isExisting
    ? [
        '',
        '### Existing-project posture (IMPORTANT)',
        '',
        'This is an EXISTING codebase, not a greenfield scaffold. Before',
        'refining the PRD, do a code exploration pass:',
        '  - Read package.json (or pyproject.toml / Cargo.toml / go.mod / etc.)',
        '    to understand the language, framework, and runtime.',
        '  - Skim the top-level directory structure.',
        '  - Read README.md if present.',
        '  - Note the existing architectural patterns (where routes live,',
        '    how state is managed, how things are tested).',
        '',
        'Then refine PRD.md to describe the DELTAS / ADDITIONS the user wants,',
        'NOT a from-scratch rewrite. Preserve existing architectural decisions',
        'unless the PRD explicitly contradicts them. Frame acceptance',
        'criteria against what the deltas should look like once landed.',
        '',
        'If the current PRD.md is a stub auto-created by Cruise (it will say',
        'so at the top), replace it entirely with your refined delta-focused',
        'PRD. If the user wrote real content, treat it as authoritative intent',
        'and refine without losing their points.',
      ].join('\n')
    : '';
  return [
    preamble(ctx, 'prd-refiner'),
    '',
    '== Your role: PRD Refiner ==================================================',
    '',
    'Goal: produce an implementation-ready PRD, and (in a second phase) a',
    'DEVELOPMENT_PLAN.md that defines the implementation team.',
    '',
    'You are LEADING the prd-refine phase. Start working immediately.',
    '',
    '## Phase 1: Refine the PRD',
    '',
    '### Inputs to read',
    `  - ${ctx.repoPath}/AGENTS.md   (engineering conventions; read-only)`,
    `  - ${ctx.repoPath}/PRD.md      (current draft; you will overwrite this)`,
    `  - ${ctx.runDir}/inbox/prd-refiner.md  (any messages from other agents)`,
    existingModeNote,
    '',
    '### Refined PRD must include',
    '  - Goals and explicit non-goals',
    '  - User stories or acceptance criteria',
    '  - Concrete technical decisions (stack, structure, key interfaces)',
    '  - Milestone-ordered task list the implementation team can follow',
    '  - Open questions for the human reviewer',
    '',
    '### Outputs for Phase 1 (do BOTH)',
    `  1. Overwrite ${ctx.repoPath}/PRD.md with the refined version`,
    `     (the original is preserved at ${ctx.runDir}/prd-original.md).`,
    `  2. Also write the same content to ${ctx.runDir}/prd-draft.md (audit copy).`,
    '',
    '### Done marker for Phase 1',
    `When BOTH files are saved AND you have no blocking questions, emit:`,
    `  ${MARKERS.PRD_DRAFT_COMPLETE}`,
    '',
    'The human will then approve (possibly with edits). After approval, the',
    'orchestrator will send you a SECOND prompt to plan the team — see the',
    'next message you receive for full instructions on Phase 2.',
    '',
    'After your work is done you remain ALIVE as a consultant: builders and',
    'reviewers may MSG-TO-prd-refiner with clarification questions during',
    'build and review. Answer concisely; you own the canonical PRD.',
  ].join('\n');
}

/**
 * Sent to the PRD Refiner immediately after the human approves the PRD.
 * Transitions the run into the plan-refine phase. The refiner produces
 * DEVELOPMENT_PLAN.md with a structured TEAM block the orchestrator parses.
 */
export function planContinuationPrompt(ctx: PromptContext): string {
  return [
    '## Phase 2: Plan the implementation team',
    '',
    `The human approved your PRD at ${ctx.runDir}/prd-approved.md.`,
    'Now design the team that will implement it.',
    '',
    `### Caps`,
    `  - Builders:  ${TEAM_CAPS.MIN_BUILDERS}–${TEAM_CAPS.MAX_BUILDERS}`,
    `  - Reviewers: ${TEAM_CAPS.MIN_REVIEWERS}–${TEAM_CAPS.MAX_REVIEWERS}`,
    '',
    '### Rules',
    '  - Each builder owns a distinct slice of the work (different files,',
    '    different concerns). No overlap that could cause merge conflicts.',
    '  - Each reviewer has a distinct focus too (e.g. one Primary +',
    '    one Adversarial; or one Security-focused + one UX-focused).',
    '  - Builder ids should be SHORT lowercase tokens like "backend",',
    '    "frontend", "infra". They become MSG-TO addresses.',
    '',
    '### Outputs (do BOTH)',
    `  1. Write ${ctx.repoPath}/DEVELOPMENT_PLAN.md as a human-readable doc`,
    '     that explains each team member, their slice, dependencies between',
    '     them, and the rollout order.',
    `  2. Also write a copy to ${ctx.runDir}/dev-plan-draft.md (audit).`,
    '',
    '### Required structured block (orchestrator parses this)',
    '',
    `Embed this block VERBATIM near the top of DEVELOPMENT_PLAN.md, with`,
    `the YAML-like list populated with your team:`,
    '',
    '    ' + BLOCKS.TEAM_BEGIN,
    '    builders:',
    '      - id: backend',
    '        label: Backend Builder',
    '        focus: API service, database schema, auth.',
    '        files: apps/api/, infra/db/',
    '      - id: frontend',
    '        label: Frontend Builder',
    '        focus: React UI and state management.',
    '        files: apps/web/',
    '    reviewers:',
    '      - id: primary',
    '        label: Primary Reviewer',
    '        focus: PRD coverage, correctness, AGENTS.md conventions.',
    '    ' + BLOCKS.TEAM_END,
    '',
    '### Done marker for Phase 2',
    'When DEVELOPMENT_PLAN.md is saved AND the TEAM block above is filled',
    'in, emit:',
    `  ${MARKERS.DEV_PLAN_COMPLETE}`,
    '',
    'The orchestrator will then parse the TEAM block, spawn each builder',
    'and reviewer with their slice, and the build phase begins.',
  ].join('\n');
}

/**
 * Builder kickoff for ONE slot in the multi-builder team. Each spawned
 * builder gets its own slice (`spec`) so it knows what to own and how to
 * coordinate with peers.
 */
export function builderSlotPrompt(ctx: PromptContext, spec: TeamMemberSpec): string {
  const role = `builder-${spec.id}`;
  const isExisting = ctx.projectMode === 'existing';
  const modificationsOnly = isExisting
    ? [
        '',
        '## Modifications-only mandate (existing-project run)',
        '',
        'You are extending an existing codebase. Hard rules:',
        '  - Do NOT refactor unrelated code.',
        '  - Do NOT rewrite working files unless your slice REQUIRES the',
        '    rewrite to land your change.',
        '  - Match the existing style, patterns, and dependencies — do not',
        '    introduce new libraries to solve a problem the repo already',
        '    has a pattern for.',
        '  - Surface non-obvious assumptions about existing behavior in your',
        '    build-manifest entry (e.g. "assumed health endpoint contract is',
        '    {status,ts}; existing handler at apps/api/health.py confirms").',
      ].join('\n')
    : '';
  return [
    preamble({ ...ctx }, role),
    '',
    `== Your role: ${spec.label} (builder-${spec.id}) ==========================`,
    '',
    `Goal: ${spec.focus}`,
    spec.files ? `Owned area: ${spec.files}` : '',
    '',
    'You are part of the build phase team. Other builders are working in',
    'parallel on different slices. Coordinate with them via MSG-TO when',
    'your slices touch.',
    '',
    rosterBlock(ctx),
    modificationsOnly,
    '',
    '## Inputs to read',
    `  - ${ctx.runDir}/prd-approved.md      (human-approved refined PRD)`,
    `  - ${ctx.repoPath}/DEVELOPMENT_PLAN.md (the full team plan and your context)`,
    `  - ${ctx.repoPath}/AGENTS.md          (engineering conventions; read-only)`,
    `  - ${ctx.runDir}/inbox/${role}.md     (messages assigned to you)`,
    `  - ${ctx.runDir}/tasks.md             (open tasks assigned to you, if any)`,
    '',
    '## What to produce',
    '  - Working code in your slice that satisfies the PRD',
    `  - Append entries to ${ctx.runDir}/build-manifest.json with your changes:`,
    `      { "${role}": { "files": [...], "commands": [...], "notes": [...] } }`,
    '',
    '## Coordination',
    '  - PRD ambiguity?           MSG-TO-prd-refiner.',
    '  - Need work from another builder?  MSG-TO-builder-{theirId}.',
    "  - Need a human decision?  MSG-TO-user.",
    '',
    '## Optional self-review (if Codex is available)',
    '  Before declaring done, run a self-review on your slice:',
    '    /codex:review',
    '  Address findings. Skip if /codex is not available.',
    '',
    '## Done marker',
    `When YOUR SLICE is complete, tested, and saved AND you have zero open`,
    `tasks assigned to ${role}, emit:`,
    `  ${MARKERS.BUILD_COMPLETE}`,
    '',
    'The build phase only advances when every builder emits its own',
    'BUILD_COMPLETE. After build completes, you stay ALIVE — the reviewer',
    'may route tasks back to you. Address each task as it arrives.',
  ].filter(Boolean).join('\n');
}

/** Legacy single-builder prompt — kept for backwards compatibility on
 *  pre-team runs (none should exist anymore, but the type still expects it). */
export function builderPrompt(ctx: PromptContext): string {
  const cyclePart = ctx.reviewCycle > 0
    ? [
        '',
        `## This is review cycle ${ctx.reviewCycle} — fix-up pass`,
        '',
        `The previous reviewer requested changes. Read ${ctx.runDir}/review-${ctx.reviewCycle - 1}.md`,
        'and address every point. Update the build-manifest with what changed.',
      ].join('\n')
    : '';

  return [
    preamble(ctx, 'builder'),
    '',
    '== Your role: Builder =====================================================',
    '',
    'Goal: implement the project the PRD describes, end-to-end, in this repo.',
    '',
    'You are NOT yet leading. Wait silently until the orchestrator promotes',
    `you to lead the build phase (or until another agent addresses you).`,
    '',
    '## When you take lead, your inputs are',
    `  - ${ctx.runDir}/prd-approved.md  (the human-approved refined PRD)`,
    `  - ${ctx.repoPath}/AGENTS.md      (engineering conventions; read-only)`,
    `  - ${ctx.runDir}/inbox/builder.md (any messages from other agents)`,
    cyclePart,
    '',
    '## What to produce',
    '  - Working code in the repo that satisfies the PRD',
    `  - ${ctx.runDir}/build-manifest.json with the form:`,
    '      { "files": [...], "commands": [...], "notes": [...] }',
    '',
    '## Self-review before declaring done (if Codex is available)',
    '  Before emitting the done marker, run a self-review on your work:',
    '    /codex:review',
    '  This invokes Codex on your current diff and surfaces issues you can fix',
    '  before the dedicated reviewer agent takes over. If the slash command',
    '  is not available (Codex not installed), skip this step.',
    '',
    '## Collaborate as needed',
    '  - PRD ambiguity?           MSG-TO-prd-refiner.',
    '  - Want a deeper spot-review? MSG-TO-reviewer.',
    "  - Stuck on a decision only the human can make?  MSG-TO-user.",
    '',
    '## Done marker',
    `When the build is complete, self-reviewed, saved, and the manifest is`,
    `written, emit:`,
    `  ${MARKERS.BUILD_COMPLETE}`,
  ].join('\n');
}

/**
 * Reviewer kickoff for ONE slot in the multi-reviewer team. Reviewers route
 * findings DIRECTLY to the responsible builder as TASK-FOR-{role} markers;
 * they do not batch findings into a single review file at the end.
 */
export function reviewerSlotPrompt(ctx: PromptContext, spec: TeamMemberSpec): string {
  const role = `reviewer-${spec.id}`;
  const isExisting = ctx.projectMode === 'existing';
  const deltaScope = isExisting
    ? [
        '',
        '## Delta-scoped review (existing-project run)',
        '',
        'Review against the DELTA — what changed in this run — not the',
        'entire repo. Pre-existing technical debt is OUT of scope unless it',
        'directly affects the new work. If a builder\'s change touched a',
        'fragile area but did not cause the fragility, note it as `info`',
        'severity at most; do not block the run on pre-existing issues.',
        '',
        'Use `git diff` (or build-manifest.json) to bound your review surface.',
      ].join('\n')
    : '';
  return [
    preamble({ ...ctx }, role),
    '',
    `== Your role: ${spec.label} (reviewer-${spec.id}) =========================`,
    '',
    `Goal: ${spec.focus}`,
    '',
    'You are NOT yet leading. Wait silently until the orchestrator promotes',
    'you to lead the review phase.',
    '',
    rosterBlock(ctx),
    deltaScope,
    '',
    '## When you take lead, review against',
    `  - ${ctx.runDir}/prd-approved.md      (what was promised)`,
    `  - ${ctx.repoPath}/AGENTS.md          (how the team builds)`,
    `  - ${ctx.runDir}/build-manifest.json  (what the builders claim they did)`,
    `  - The current state of the repo      (what's actually there)`,
    `  - ${ctx.runDir}/inbox/${role}.md     (any messages addressed to you)`,
    '',
    '## How review works in this protocol',
    '',
    'You do NOT batch findings into a single review file and then loop back.',
    'Instead, each finding becomes a LIVE task delivered to the responsible',
    'builder via TASK-FOR-{builderRole}. The orchestrator persists it and',
    'injects it directly into that builder\'s session, so the fix can start',
    'immediately:',
    '',
    '    ===CRUISE:TASK-FOR-builder-backend severity=high===',
    '    The /readyz endpoint returns a tuple; the spec says dict.',
    '    File: apps/api/lana_api/controllers/health.py:42',
    '    ===CRUISE:END===',
    '',
    'Assign each finding to the builder whose slice owns the offending code.',
    'If two slices share blame, address the primary owner first; you can',
    'send a follow-up to the secondary builder if needed.',
    '',
    `Also keep a running summary of your review at ${ctx.runDir}/review-${ctx.reviewCycle}.md`,
    `(append-only; one section per finding with the same TASK-FOR address`,
    `you used in the marker).`,
    '',
    '## Codex adversarial pass (if installed)',
    '  Before finalizing your verdict, run an adversarial review:',
    '    /codex:adversarial-review',
    '  Integrate its findings as additional TASK-FOR markers. If /codex is',
    "  not available, skip and note 'no adversarial pass' in the review file.",
    '',
    '## Done marker',
    'You may have multiple rounds of "find issue → builder fixes → verify".',
    'When you are satisfied that every task you raised is resolved AND no',
    'new findings remain, emit:',
    `  ${MARKERS.REVIEW_ACCEPT}`,
    '',
    'If the build is fundamentally broken (architecture wrong, PRD',
    'misunderstood) and per-task fixes will not save it, escalate:',
    `  ${MARKERS.REVIEW_REQUEST_CHANGES}`,
    '(This triggers a full re-build cycle.)',
  ].join('\n');
}

/** Legacy single-reviewer prompt — kept for backwards compatibility. */
export function reviewerPrompt(ctx: PromptContext): string {
  return [
    preamble(ctx, 'reviewer'),
    '',
    '== Your role: Reviewer ====================================================',
    '',
    'Goal: verify the build actually delivers what the PRD describes, with the',
    "quality bar AGENTS.md sets. Catch gaps the builder didn't see.",
    '',
    'You are NOT yet leading. Wait silently until the orchestrator promotes',
    'you to lead the review phase (or until another agent addresses you).',
    '',
    '## When you take lead, review against',
    `  - ${ctx.runDir}/prd-approved.md    (what was promised)`,
    `  - ${ctx.repoPath}/AGENTS.md        (how the team builds)`,
    `  - ${ctx.runDir}/build-manifest.json (what the builder claims they did)`,
    `  - The current state of the repo    (what's actually there)`,
    `  - ${ctx.runDir}/inbox/reviewer.md  (messages from other agents)`,
    '',
    '## Check for',
    '  - PRD coverage (every requirement implemented)',
    '  - Correctness (no obvious bugs, error handling at boundaries)',
    '  - Adherence to AGENTS.md conventions',
    '  - Reuse vs. duplication',
    '  - Security issues',
    '',
    '## Get a second opinion from Codex (if installed)',
    '  Before finalizing your verdict, run an adversarial review with Codex:',
    '    /codex:adversarial-review',
    '  Codex will produce an independent critique against the same PRD +',
    '  AGENTS.md. Integrate its findings into your review (deduplicate, mark',
    '  source as "codex"). If the slash command is not available (Codex not',
    '  installed), skip this step and note in the review file that no',
    '  adversarial pass was run.',
    '',
    '## Output',
    `  Write your findings to ${ctx.runDir}/review-${ctx.reviewCycle}.md`,
    '  Include: severity-tagged findings, file:line citations where applicable,',
    '  any Codex-sourced findings clearly attributed, and a final verdict.',
    '',
    '## Collaborate as needed',
    '  - Builder claim unclear?   MSG-TO-builder.',
    "  - PRD ambiguity affects whether something's a gap?  MSG-TO-prd-refiner.",
    '',
    '## Done marker — emit EXACTLY ONE of these:',
    `  ${MARKERS.REVIEW_ACCEPT}            (PRD fully satisfied — ship it)`,
    `  ${MARKERS.REVIEW_REQUEST_CHANGES}   (issues found — builder takes another pass)`,
  ].join('\n');
}

export function runDirForRun(repoPath: string, runId: number): string {
  return path.join(repoPath, '.cruise', 'runs', String(runId));
}

/**
 * Phase-transition prompt: sent into the new lead agent's TUI when the
 * orchestrator promotes them. Short and direct.
 */
export function phaseLeadPrompt(role: string, phase: string, ctx: PromptContext): string {
  let extra = '';
  if (phase === 'build') {
    extra = `\nRead ${ctx.runDir}/prd-approved.md and begin implementing.`;
  } else if (phase === 'review') {
    extra = `\nReview the current repo against ${ctx.runDir}/prd-approved.md and AGENTS.md, then write ${ctx.runDir}/review-${ctx.reviewCycle}.md.`;
  } else if (phase === 'review-feedback' || phase === 'build') {
    extra = `\nThis is review cycle ${ctx.reviewCycle}. Read ${ctx.runDir}/review-${ctx.reviewCycle - 1}.md and address every point.`;
  }
  return `===CRUISE:PHASE-LEAD===\nYou are now leading the ${phase} phase as ${role}.${extra}\n===CRUISE:END===`;
}

/**
 * Continuation prompt sent to each builder when the user re-opens a `done`
 * run with new goals. The build phase has already produced a working
 * codebase; these goals are ADDITIVE work atop that base, not a re-do.
 */
export function builderContinuationPrompt(goals: string[], ctx: PromptContext): string {
  const goalList = goals
    .map(g => g.trim())
    .filter(g => g.length > 0)
    .map((g, i) => `  ${i + 1}. ${g}`)
    .join('\n');
  return [
    '===CRUISE:CONTINUATION===',
    '## Continuation: new goals from the user',
    '',
    'The previous build cycle completed and the run was marked done. The',
    'user has now added new goals on top of the existing implementation.',
    'Treat them as ADDITIVE work — extend the codebase to satisfy them.',
    'Do NOT redo or refactor work that already shipped unless one of the',
    'new goals explicitly requires it.',
    '',
    '### New goals',
    goalList || '  (none specified — ask the user via MSG-TO-user)',
    '',
    `Re-read ${ctx.runDir}/prd-approved.md and ${ctx.runDir}/build-manifest.json`,
    'to ground yourself in what already exists, then implement the deltas.',
    '',
    'When your slice is complete for THIS continuation, emit',
    `${MARKERS.BUILD_COMPLETE} again — the reviewer will re-review against`,
    'the new goals.',
    '===CRUISE:END===',
  ].join('\n');
}

/**
 * Continuation prompt sent to each reviewer when a `done` run is reopened.
 * They stay quiet until builders signal BUILD_COMPLETE again, then re-review
 * against the new goals.
 */
export function reviewerContinuationPrompt(goals: string[], _ctx: PromptContext): string {
  const goalList = goals
    .map(g => g.trim())
    .filter(g => g.length > 0)
    .map((g, i) => `  ${i + 1}. ${g}`)
    .join('\n');
  return [
    '===CRUISE:CONTINUATION===',
    'A new round of goals has been added to this run. Builders are working',
    'on them now. Wait silently; once every builder signals',
    `${MARKERS.BUILD_COMPLETE} again, re-review the deltas against these`,
    'new goals (in addition to the original PRD).',
    '',
    '### New goals',
    goalList || '  (none specified)',
    '===CRUISE:END===',
  ].join('\n');
}

/**
 * Message-delivery wrapper: how the orchestrator inserts a peer message
 * into a target agent's TUI. The header tells the receiver who it's from
 * and how to reply via the same protocol.
 */
export function deliverMessage(from: string, to: string, body: string): string {
  return [
    `===CRUISE:INBOUND-MSG===`,
    `From: ${from}`,
    `To: ${to}`,
    '',
    body,
    '',
    `To reply, emit ===CRUISE:MSG-TO-${from}=== ... ===CRUISE:END===`,
    `===CRUISE:END===`,
  ].join('\n');
}
