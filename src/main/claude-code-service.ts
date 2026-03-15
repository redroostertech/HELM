import { spawn } from 'child_process';

export interface ClaudeExplanation {
  summary: string;
  breakdown: string[];
  expectedOutcome: string;
  failureModes: string[];
  undoGuidance: string | null;
}

export interface ClaudeSuggestion {
  command: string;
  explanation: ClaudeExplanation;
  isDangerous: boolean;
  requiresConfirmation: boolean;
}

export class ClaudeCodeService {
  /**
   * Ask Claude Code a general question with optional context
   */
  async ask(question: string, context?: string): Promise<string> {
    const prompt = context
      ? `Context: ${context}\n\nQuestion: ${question}`
      : question;

    return this.runClaudeCode(prompt);
  }

  /**
   * Get detailed explanation of a command
   */
  async explainCommand(command: string): Promise<ClaudeExplanation> {
    const prompt = `Explain this terminal command in detail. Format your response as JSON with these fields:
- summary: one-sentence plain English explanation
- breakdown: array of strings, each explaining a part of the command (flags, arguments, etc.)
- expectedOutcome: what will happen when this runs
- failureModes: array of common ways this command might fail
- undoGuidance: how to undo this command (if applicable, otherwise null)

Command: ${command}

Respond ONLY with valid JSON, no markdown formatting.`;

    const response = await this.runClaudeCode(prompt);

    try {
      return JSON.parse(response);
    } catch (e) {
      // Fallback if Claude doesn't return valid JSON
      return {
        summary: response.split('\n')[0] || 'Command explanation',
        breakdown: response.split('\n').slice(1, -2),
        expectedOutcome: 'See explanation above',
        failureModes: ['Unknown'],
        undoGuidance: null,
      };
    }
  }

  /**
   * Suggest a command based on user intent
   */
  async suggestCommand(intent: string, workingDir: string): Promise<ClaudeSuggestion> {
    const prompt = `I want to: ${intent}

Working directory: ${workingDir}

Suggest a terminal command to accomplish this. Format your response as JSON with these fields:
- command: the actual command to run
- explanation: object with { summary, breakdown, expectedOutcome, failureModes, undoGuidance }
- isDangerous: boolean, true if this command could delete files, modify system state, etc.
- requiresConfirmation: boolean, true if user should explicitly approve

Respond ONLY with valid JSON, no markdown formatting.`;

    const response = await this.runClaudeCode(prompt);

    try {
      return JSON.parse(response);
    } catch (e) {
      // Fallback
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

  /**
   * Detect if a command is dangerous
   */
  isDangerousCommand(command: string): boolean {
    const dangerousPatterns = [
      /rm\s+-rf/,           // rm -rf
      /rm\s+.*\/\*/,        // rm with wildcards
      /sudo\s+rm/,          // sudo rm
      />\s*\/dev\/sd/,      // writing to disk
      /dd\s+if=/,           // dd command
      /mkfs/,               // formatting
      /:{%raw%}(){:;}{%endraw%}/,           // fork bomb
      /curl.*\|\s*sh/,      // curl pipe to shell
      /wget.*\|\s*sh/,      // wget pipe to shell
      /chmod\s+-R\s+777/,   // dangerous permissions
      /chown\s+-R/,         // recursive ownership change
    ];

    return dangerousPatterns.some(pattern => pattern.test(command));
  }

  /**
   * Run Claude Code CLI and capture output
   */
  private async runClaudeCode(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Spawn claude CLI with the prompt
      const claude = spawn('claude', ['--message', prompt], {
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      claude.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      claude.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      claude.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Claude Code exited with code ${code}: ${stderr}`));
        } else {
          resolve(stdout.trim());
        }
      });

      claude.on('error', (err) => {
        reject(new Error(`Failed to spawn Claude Code: ${err.message}`));
      });
    });
  }
}
