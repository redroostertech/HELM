/**
 * Shared interface for AI services (OpenAI, Anthropic/Claude).
 * Both providers implement this interface so they can be swapped freely.
 */

export interface AIExplanation {
  summary: string;
  breakdown: string[];
  expectedOutcome: string;
  failureModes: string[];
  undoGuidance: string | null;
}

export interface AISuggestion {
  command: string;
  explanation: AIExplanation;
  isDangerous: boolean;
  requiresConfirmation: boolean;
}

export type AIProvider = 'openai' | 'anthropic';

export interface AIService {
  readonly provider: AIProvider;

  /** Ask a general question with optional context */
  ask(question: string, context?: string): Promise<string>;

  /** Get a structured explanation of a terminal command */
  explainCommand(command: string): Promise<AIExplanation>;

  /** Suggest a command based on user intent */
  suggestCommand(intent: string, workingDir: string): Promise<AISuggestion>;
}

/** Detect if a command is dangerous (shared across providers) */
export function isDangerousCommand(command: string): boolean {
  const dangerousPatterns = [
    /rm\s+-rf/,
    /rm\s+.*\/\*/,
    /sudo\s+rm/,
    />\s*\/dev\/sd/,
    /dd\s+if=/,
    /mkfs/,
    /curl.*\|\s*sh/,
    /wget.*\|\s*sh/,
    /chmod\s+-R\s+777/,
    /chown\s+-R/,
  ];
  return dangerousPatterns.some(pattern => pattern.test(command));
}

const EXPLAIN_PROMPT = `Explain this terminal command in detail. Format your response as JSON with these fields:
- summary: one-sentence plain English explanation
- breakdown: array of strings, each explaining a part of the command (flags, arguments, etc.)
- expectedOutcome: what will happen when this runs
- failureModes: array of common ways this command might fail
- undoGuidance: how to undo this command (if applicable, otherwise null)

Command: {{COMMAND}}

Respond ONLY with valid JSON, no markdown formatting.`;

const SUGGEST_PROMPT = `I want to: {{INTENT}}

Working directory: {{WORKING_DIR}}

Suggest a terminal command to accomplish this. Format your response as JSON with these fields:
- command: the actual command to run
- explanation: object with { summary, breakdown, expectedOutcome, failureModes, undoGuidance }
- isDangerous: boolean, true if this command could delete files, modify system state, etc.
- requiresConfirmation: boolean, true if user should explicitly approve

Respond ONLY with valid JSON, no markdown formatting.`;

export function buildExplainPrompt(command: string): string {
  return EXPLAIN_PROMPT.replace('{{COMMAND}}', command);
}

export function buildSuggestPrompt(intent: string, workingDir: string): string {
  return SUGGEST_PROMPT
    .replace('{{INTENT}}', intent)
    .replace('{{WORKING_DIR}}', workingDir);
}

export function parseExplanation(text: string): AIExplanation {
  try {
    return JSON.parse(text);
  } catch {
    return {
      summary: text.split('\n')[0] || 'Command explanation',
      breakdown: text.split('\n').slice(1, -2),
      expectedOutcome: 'See explanation above',
      failureModes: ['Unknown'],
      undoGuidance: null,
    };
  }
}

export function parseSuggestion(text: string): AISuggestion {
  try {
    return JSON.parse(text);
  } catch {
    return {
      command: 'echo "Could not parse suggestion"',
      explanation: {
        summary: 'Error parsing suggestion',
        breakdown: [],
        expectedOutcome: 'Unknown',
        failureModes: [],
        undoGuidance: null,
      },
      isDangerous: false,
      requiresConfirmation: false,
    };
  }
}
