/**
 * CLI Program Registry
 *
 * Defines known interactive CLI programs (Claude Code, Codex, Aider, etc.)
 * so HELM can detect when they're running inside the terminal and capture
 * user inputs/prompts sent to them.
 */

export interface CLIProgram {
  /** Unique identifier, e.g. "claude-code" */
  id: string;
  /** Display name shown in UI */
  name: string;
  /** Binary names that launch this program (matched against shell commands) */
  binaries: string[];
  /** Optional icon identifier for UI badges */
  icon?: string;
  /** Regex patterns that appear in PTY output when the program is waiting for input */
  promptPatterns: RegExp[];
  /** Regex patterns in PTY output that signal the program has exited back to shell */
  exitPatterns: RegExp[];
  /** Color for UI badge */
  color: string;
}

/**
 * Default registry of known CLI programs.
 * Users can extend this via settings.
 */
export const DEFAULT_CLI_REGISTRY: CLIProgram[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    binaries: ['claude'],
    icon: 'claude',
    promptPatterns: [
      />\s*$/m,               // Claude Code's input prompt
      /❯\s*$/m,               // Alternative prompt character
    ],
    exitPatterns: [
      /\$\s*$/m,              // Shell prompt reappears
      /❯\s*$/m,               // zsh prompt
      /➜\s+/m,                // oh-my-zsh prompt
    ],
    color: '#d97706',
  },
  {
    id: 'codex',
    name: 'Codex',
    binaries: ['codex'],
    icon: 'codex',
    promptPatterns: [
      />\s*$/m,
      /❯\s*$/m,
    ],
    exitPatterns: [
      /\$\s*$/m,
      /❯\s*$/m,
      /➜\s+/m,
    ],
    color: '#10b981',
  },
  {
    id: 'aider',
    name: 'Aider',
    binaries: ['aider'],
    icon: 'aider',
    promptPatterns: [
      />\s*$/m,
      /aider>\s*$/m,
    ],
    exitPatterns: [
      /\$\s*$/m,
      /❯\s*$/m,
      /➜\s+/m,
    ],
    color: '#8b5cf6',
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    binaries: ['gh copilot'],
    icon: 'copilot',
    promptPatterns: [
      />\s*$/m,
    ],
    exitPatterns: [
      /\$\s*$/m,
      /❯\s*$/m,
      /➜\s+/m,
    ],
    color: '#6366f1',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    binaries: ['gemini'],
    icon: 'gemini',
    promptPatterns: [
      />\s*$/m,
      /❯\s*$/m,
    ],
    exitPatterns: [
      /\$\s*$/m,
      /❯\s*$/m,
      /➜\s+/m,
    ],
    color: '#4285f4',
  },
];

/**
 * Matches a shell command against the CLI registry.
 * Returns the matching CLIProgram or null.
 */
export function detectCLIProgram(
  command: string,
  registry: CLIProgram[] = DEFAULT_CLI_REGISTRY
): CLIProgram | null {
  const trimmed = command.trim().toLowerCase();

  for (const program of registry) {
    for (const binary of program.binaries) {
      // Match exact command or command with arguments
      // e.g., "claude" matches "claude", "claude --help", "claude chat"
      if (
        trimmed === binary ||
        trimmed.startsWith(binary + ' ') ||
        trimmed.startsWith(binary + '\t')
      ) {
        return program;
      }
    }
  }

  return null;
}

/**
 * Checks if PTY output contains a shell prompt pattern,
 * indicating the CLI program has exited.
 *
 * Uses a configurable shell prompt regex that can be
 * refined based on the user's actual shell prompt.
 */
export function detectShellReturn(
  output: string,
  userPromptPattern?: RegExp
): boolean {
  if (userPromptPattern) {
    return userPromptPattern.test(output);
  }

  // Generic shell prompt detection heuristics
  const shellPatterns = [
    /\$\s*$/m,                    // bash default
    /❯\s*$/m,                     // zsh / starship
    /➜\s+/m,                      // oh-my-zsh
    />\s*$/m,                      // generic
    /\]\$\s*$/m,                   // [user@host dir]$
    /\]#\s*$/m,                    // root prompt
    /%\s*$/m,                      // zsh default
  ];

  return shellPatterns.some(p => p.test(output));
}
