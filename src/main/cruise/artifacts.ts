/**
 * ArtifactStore — owns the .cruise/ directory inside the target repo.
 *
 * Layout under <repo>/.cruise/runs/<runId>/:
 *   config.json           Frozen run config
 *   prd-original.md       Snapshot of repo's PRD.md at run start
 *   prd-draft.md          PRD-refiner output
 *   prd-approved.md       Final approved PRD (post-human review)
 *   review-<n>.md         Per-cycle reviewer output
 *   build-manifest.json   Builder-maintained list of touched files
 *   audit.jsonl           Mirror of cruise_events for git-trackability
 *
 * AGENTS.md and PRD.md themselves are never overwritten.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CruiseRunConfig } from '../database';

export class ArtifactStore {
  constructor(public readonly repoPath: string) {}

  static validateRepo(repoPath: string): { ok: boolean; error?: string } {
    if (!fs.existsSync(repoPath)) return { ok: false, error: `repo path does not exist: ${repoPath}` };
    if (!fs.statSync(repoPath).isDirectory()) return { ok: false, error: `not a directory: ${repoPath}` };
    if (!fs.existsSync(path.join(repoPath, 'AGENTS.md'))) {
      return { ok: false, error: `AGENTS.md not found in ${repoPath}` };
    }
    if (!fs.existsSync(path.join(repoPath, 'PRD.md'))) {
      return { ok: false, error: `PRD.md not found in ${repoPath}` };
    }
    return { ok: true };
  }

  cruiseDir(): string {
    return path.join(this.repoPath, '.cruise');
  }

  runDir(runId: number): string {
    return path.join(this.cruiseDir(), 'runs', String(runId));
  }

  /** Prepare the .cruise/runs/<runId>/ directory and copy PRD.md → prd-original.md */
  initRun(runId: number, config: CruiseRunConfig): void {
    const dir = this.runDir(runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'inbox'), { recursive: true });

    // Write run config
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));

    // Snapshot PRD.md and AGENTS.md so the audit trail is self-contained
    const prdSrc = path.join(this.repoPath, 'PRD.md');
    const agentsSrc = path.join(this.repoPath, 'AGENTS.md');
    try { fs.copyFileSync(prdSrc, path.join(dir, 'prd-original.md')); } catch {}
    try { fs.copyFileSync(agentsSrc, path.join(dir, 'agents-snapshot.md')); } catch {}

    // Initialize empty inbox files for each role
    for (const role of ['prd-refiner', 'builder', 'reviewer']) {
      const inboxFile = path.join(dir, 'inbox', `${role}.md`);
      if (!fs.existsSync(inboxFile)) {
        fs.writeFileSync(inboxFile, `# Inbox for ${role}\n\n_(messages from other agents will appear here)_\n`);
      }
    }

    // Ensure .cruise/.gitignore exists and ignores audit.jsonl + messages.jsonl by default
    const cruiseGitignore = path.join(this.cruiseDir(), '.gitignore');
    if (!fs.existsSync(cruiseGitignore)) {
      fs.writeFileSync(cruiseGitignore, 'runs/*/audit.jsonl\nruns/*/messages.jsonl\n');
    }
  }

  /** Append a message to the target's inbox file + the run's messages.jsonl */
  appendMessage(runId: number, msg: { from: string; to: string; body: string; ts: string }): void {
    const dir = this.runDir(runId);
    const inboxDir = path.join(dir, 'inbox');
    if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });

    // Append to the target's inbox markdown (skip for broadcast / user)
    if (msg.to !== 'user' && msg.to !== 'all') {
      const inboxFile = path.join(inboxDir, `${msg.to}.md`);
      const block = `\n---\n**From:** ${msg.from}  **At:** ${msg.ts}\n\n${msg.body}\n`;
      try { fs.appendFileSync(inboxFile, block); } catch {}
    } else if (msg.to === 'all') {
      // Broadcast: append to every inbox
      for (const role of ['prd-refiner', 'builder', 'reviewer']) {
        if (role === msg.from) continue;
        const inboxFile = path.join(inboxDir, `${role}.md`);
        const block = `\n---\n**From:** ${msg.from} (broadcast)  **At:** ${msg.ts}\n\n${msg.body}\n`;
        try { fs.appendFileSync(inboxFile, block); } catch {}
      }
    }

    // Always append to the canonical messages log
    const msgLog = path.join(dir, 'messages.jsonl');
    try { fs.appendFileSync(msgLog, JSON.stringify(msg) + '\n'); } catch {}
  }

  readPrdDraft(runId: number): string | null {
    const p = path.join(this.runDir(runId), 'prd-draft.md');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
  }

  writePrdApproved(runId: number, content: string): void {
    fs.writeFileSync(path.join(this.runDir(runId), 'prd-approved.md'), content);
  }

  readPrdApproved(runId: number): string | null {
    const p = path.join(this.runDir(runId), 'prd-approved.md');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
  }

  readReview(runId: number, cycle: number): string | null {
    const p = path.join(this.runDir(runId), `review-${cycle}.md`);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
  }

  /** Append a JSON event to audit.jsonl (mirror of cruise_events) */
  appendAudit(runId: number, event: any): void {
    const p = path.join(this.runDir(runId), 'audit.jsonl');
    try {
      fs.appendFileSync(p, JSON.stringify(event) + '\n');
    } catch {
      // Don't let audit-log writes break the orchestrator
    }
  }

  /** Snapshot of artifacts present in the run dir — used for checkpoints */
  snapshotArtifacts(runId: number): { files: Record<string, string> } {
    const dir = this.runDir(runId);
    const files: Record<string, string> = {};
    if (!fs.existsSync(dir)) return { files };
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      try {
        if (fs.statSync(p).isFile() && name !== 'audit.jsonl') {
          files[name] = fs.readFileSync(p, 'utf-8');
        }
      } catch {}
    }
    return { files };
  }
}
