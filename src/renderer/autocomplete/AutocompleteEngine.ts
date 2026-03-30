/**
 * AutocompleteEngine — matches the current terminal input against CLI specs
 * and command history to produce ranked suggestions.
 */

import {
  ALL_SPECS,
  SPEC_MAP,
  CommandSpec,
  SubcommandSpec,
  FlagSpec,
} from './completionSpecs';

export type SuggestionKind = 'command' | 'subcommand' | 'flag' | 'history' | 'path';

export interface Suggestion {
  /** The text to insert (the completion value) */
  text: string;
  /** Human-readable label shown in dropdown */
  label: string;
  /** Short description (flag meaning, command summary, etc.) */
  description: string;
  kind: SuggestionKind;
  /** For flags, show the long form if the user typed short, or vice-versa */
  alias?: string;
  /** Score for ranking (higher = better) */
  score: number;
}

/**
 * Parse the current input line into tokens, respecting basic quoting.
 * Returns the list of completed tokens and the current (incomplete) token.
 */
export function tokenize(input: string): { tokens: string[]; current: string } {
  const tokens: string[] = [];
  let i = 0;
  let buf = '';
  let inQuote: string | null = null;

  while (i < input.length) {
    const ch = input[i];
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        buf += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (buf.length > 0) {
        tokens.push(buf);
        buf = '';
      }
    } else {
      buf += ch;
    }
    i++;
  }

  // The trailing buffer is the "current" token being typed
  // But if the input ends with a space, the current token is empty
  const endsWithSpace = input.length > 0 && (input[input.length - 1] === ' ' || input[input.length - 1] === '\t');
  if (endsWithSpace) {
    if (buf.length > 0) tokens.push(buf);
    return { tokens, current: '' };
  }

  return { tokens, current: buf };
}

/**
 * Resolve the spec context: given parsed tokens, walk down the command/subcommand tree.
 * Returns the deepest matching spec and which tokens were consumed.
 */
function resolveSpec(tokens: string[]): {
  spec: CommandSpec | SubcommandSpec | null;
  depth: number; // how many tokens were consumed for command/subcommand navigation
  flags: FlagSpec[];
  subcommands: SubcommandSpec[];
} {
  if (tokens.length === 0) {
    return { spec: null, depth: 0, flags: [], subcommands: [] };
  }

  const rootSpec = SPEC_MAP.get(tokens[0]);
  if (!rootSpec) {
    return { spec: null, depth: 0, flags: [], subcommands: [] };
  }

  let current: CommandSpec | SubcommandSpec = rootSpec;
  let depth = 1;

  // Walk subcommands
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.startsWith('-')) continue; // skip flags
    const sub = current.subcommands?.find(s => s.name === tok);
    if (sub) {
      current = sub;
      depth = i + 1;
    } else {
      break;
    }
  }

  // Collect all applicable flags (from current spec + root global flags)
  const flags: FlagSpec[] = [
    ...(current.flags || []),
  ];
  // If we're deeper than root, also include root global flags
  if (depth > 1 && rootSpec.flags) {
    flags.push(...rootSpec.flags);
  }

  return {
    spec: current,
    depth,
    flags,
    subcommands: current.subcommands || [],
  };
}

/**
 * Check if a flag has already been used in the tokens.
 */
function isFlagUsed(flag: FlagSpec, tokens: string[]): boolean {
  for (const tok of tokens) {
    if (tok === flag.name) return true;
    if (flag.alias && tok === flag.alias) return true;
  }
  return false;
}

/**
 * Fuzzy-ish prefix match. Returns a score > 0 if `query` is a prefix of `candidate`,
 * or 0 if no match. Exact match scores highest.
 */
function matchScore(candidate: string, query: string): number {
  if (query.length === 0) return 1; // empty query matches everything weakly
  const lower = candidate.toLowerCase();
  const q = query.toLowerCase();
  if (lower === q) return 100; // exact
  if (lower.startsWith(q)) return 50 + (q.length / lower.length) * 40; // prefix
  // Contains match (weaker)
  if (lower.includes(q)) return 10 + (q.length / lower.length) * 20;
  return 0;
}

export interface AutocompleteOptions {
  /** Max suggestions to return */
  maxResults?: number;
  /** Command history entries (most recent first) */
  history?: string[];
  /** Path completions from the filesystem */
  pathCompletions?: string[];
}

/**
 * Main entry point: given the current input line, produce ranked suggestions.
 */
export function getSuggestions(
  inputLine: string,
  options: AutocompleteOptions = {}
): Suggestion[] {
  const { maxResults = 10, history = [], pathCompletions = [] } = options;
  const trimmed = inputLine.trimStart();
  if (trimmed.length === 0) {
    // Empty input: show recent history commands
    return history.slice(0, maxResults).map((h, i) => ({
      text: h,
      label: h,
      description: 'recent command',
      kind: 'history' as const,
      score: 100 - i,
    }));
  }

  const { tokens, current } = tokenize(trimmed);
  const results: Suggestion[] = [];

  // ── Phase 0: If no tokens yet (typing the very first word) ────────
  if (tokens.length === 0) {
    // Match against top-level commands
    for (const spec of ALL_SPECS) {
      const s = matchScore(spec.name, current);
      if (s > 0) {
        results.push({
          text: spec.name,
          label: spec.name,
          description: spec.description,
          kind: 'command',
          score: s + 5, // slight boost for known commands
        });
      }
    }

    // Match against history
    const seen = new Set(results.map(r => r.text));
    for (let i = 0; i < history.length && results.length < maxResults * 2; i++) {
      const h = history[i];
      if (seen.has(h)) continue;
      // Match the first word of the history entry
      const firstWord = h.split(/\s/)[0];
      const s = matchScore(firstWord, current);
      if (s > 0) {
        seen.add(h);
        results.push({
          text: h,
          label: h,
          description: 'recent command',
          kind: 'history',
          score: s - 5 + Math.max(0, 10 - i), // recency boost
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  // ── Phase 1: We have tokens — resolve the spec context ────────────
  const ctx = resolveSpec(tokens);

  // Determine if the current token looks like a flag
  const isTypingFlag = current.startsWith('-');

  // ── Phase 2: Complete subcommands ─────────────────────────────────
  if (!isTypingFlag && ctx.spec) {
    for (const sub of ctx.subcommands) {
      const s = matchScore(sub.name, current);
      if (s > 0) {
        results.push({
          text: sub.name,
          label: sub.name,
          description: sub.description,
          kind: 'subcommand',
          score: s + 10,
        });
      }
    }
  }

  // ── Phase 3: Complete flags ───────────────────────────────────────
  if (ctx.spec) {
    for (const flag of ctx.flags) {
      if (isFlagUsed(flag, tokens)) continue;
      // Match against both name and alias
      const s1 = matchScore(flag.name, current);
      const s2 = flag.alias ? matchScore(flag.alias, current) : 0;
      const s = Math.max(s1, s2);
      if (s > 0) {
        results.push({
          text: s2 > s1 && flag.alias ? flag.alias : flag.name,
          label: flag.alias ? `${flag.name} (${flag.alias})` : flag.name,
          description: flag.description,
          kind: 'flag',
          alias: flag.alias || undefined,
          score: s,
        });
      }
    }
  }

  // ── Phase 4: Path completions ─────────────────────────────────────
  for (const p of pathCompletions) {
    const basename = p.split('/').pop() || p;
    const s = matchScore(basename, current) || matchScore(p, current);
    if (s > 0 || current.length === 0) {
      results.push({
        text: p,
        label: p,
        description: 'path',
        kind: 'path',
        score: (s || 1) - 2,
      });
    }
  }

  // ── Phase 5: History suggestions ──────────────────────────────────
  const fullInput = trimmed;
  const seen = new Set(results.map(r => r.text));
  for (let i = 0; i < history.length && results.length < maxResults * 2; i++) {
    const h = history[i];
    if (seen.has(h)) continue;
    // The history entry must start with the same command
    if (!h.toLowerCase().startsWith(tokens[0].toLowerCase())) continue;
    const s = matchScore(h, fullInput);
    if (s > 0) {
      seen.add(h);
      results.push({
        text: h,
        label: h,
        description: 'recent command',
        kind: 'history',
        score: s - 10 + Math.max(0, 5 - i), // lower priority than spec matches
      });
    }
  }

  // ── Sort and return ───────────────────────────────────────────────
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}
