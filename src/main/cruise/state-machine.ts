/**
 * Cruise Control state machine — pure transitions, no side effects.
 *
 * The orchestrator owns side effects (spawning agents, writing files); the
 * state machine owns *what* the next phase is given the current one and an
 * input signal.
 */

import { CruisePhase } from './types';

export type Trigger =
  | { type: 'start' }
  | { type: 'prd-draft-complete' }
  | { type: 'prd-approved' }
  | { type: 'dev-plan-complete' }
  | { type: 'build-complete' }
  | { type: 'review-accept' }
  | { type: 'review-request-changes' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'fail' };

export interface MachineContext {
  phase: CruisePhase;
  previousPhase: CruisePhase | null;   // remembered across pause so resume goes back
  reviewCycle: number;
  maxReviewCycles: number;
}

export interface TransitionResult {
  phase: CruisePhase;
  previousPhase: CruisePhase | null;
  reviewCycle: number;
  /** True if this trigger caused a phase change */
  changed: boolean;
  /** Optional reason for transition refusal */
  reason?: string;
}

export function transition(ctx: MachineContext, trig: Trigger): TransitionResult {
  const base = {
    phase: ctx.phase,
    previousPhase: ctx.previousPhase,
    reviewCycle: ctx.reviewCycle,
    changed: false,
  };

  // Pause / Resume / Stop are global — accepted from most phases.
  if (trig.type === 'pause') {
    if (ctx.phase === 'paused' || isTerminal(ctx.phase)) return { ...base, reason: 'already paused or terminal' };
    return { ...base, phase: 'paused', previousPhase: ctx.phase, changed: true };
  }

  if (trig.type === 'resume') {
    if (ctx.phase !== 'paused') return { ...base, reason: 'not paused' };
    const target = ctx.previousPhase || 'prd-refine';
    return { ...base, phase: target, previousPhase: null, changed: true };
  }

  if (trig.type === 'stop') {
    if (isTerminal(ctx.phase)) return { ...base, reason: 'already terminal' };
    return { ...base, phase: 'stopped', previousPhase: ctx.phase, changed: true };
  }

  if (trig.type === 'fail') {
    if (isTerminal(ctx.phase)) return { ...base, reason: 'already terminal' };
    return { ...base, phase: 'failed', previousPhase: ctx.phase, changed: true };
  }

  // Phase-specific transitions
  switch (ctx.phase) {
    case 'idle':
      if (trig.type === 'start') return { ...base, phase: 'prd-refine', changed: true };
      break;

    case 'prd-refine':
      if (trig.type === 'prd-draft-complete') return { ...base, phase: 'prd-approve', changed: true };
      break;

    case 'prd-approve':
      if (trig.type === 'prd-approved') return { ...base, phase: 'plan-refine', changed: true };
      break;

    case 'plan-refine':
      if (trig.type === 'dev-plan-complete') return { ...base, phase: 'build', changed: true };
      break;

    case 'build':
      // Note: the orchestrator fires this trigger ONLY when every spawned
      // builder has individually emitted BUILD_COMPLETE.
      if (trig.type === 'build-complete') return { ...base, phase: 'review', changed: true };
      break;

    case 'review':
      // Normal path: reviewer routes findings live to builders via
      // TASK-FOR-{builder} markers. Builders fix in place; reviewer
      // emits REVIEW_ACCEPT once all findings are resolved.
      if (trig.type === 'review-accept') return { ...base, phase: 'done', changed: true };
      // Escalation path: reviewer judges the work fundamentally broken
      // and requests a full re-build cycle. Counts against maxReviewCycles.
      if (trig.type === 'review-request-changes') {
        const nextCycle = ctx.reviewCycle + 1;
        if (nextCycle >= ctx.maxReviewCycles) {
          return { ...base, phase: 'done', reviewCycle: nextCycle, changed: true, reason: 'max review cycles reached' };
        }
        return { ...base, phase: 'review-feedback', reviewCycle: nextCycle, changed: true };
      }
      break;

    case 'review-feedback':
      // Synthesized transition: orchestrator re-kicks builders, machine goes back to build
      if (trig.type === 'start') return { ...base, phase: 'build', changed: true };
      break;
  }

  return { ...base, reason: `no transition for ${trig.type} in ${ctx.phase}` };
}

export function isTerminal(p: CruisePhase): boolean {
  return p === 'done' || p === 'stopped' || p === 'failed';
}

export function isLiveAgentPhase(p: CruisePhase): boolean {
  return p === 'prd-refine' || p === 'plan-refine' || p === 'build' || p === 'review';
}
