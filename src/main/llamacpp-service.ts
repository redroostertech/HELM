import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  AIService,
  AIExplanation,
  AISuggestion,
  buildExplainPrompt,
  buildSuggestPrompt,
  parseExplanation,
  parseSuggestion,
} from './ai-service';

const DEFAULT_MODEL_DIR = path.join(os.homedir(), '.llama-models');
const DEFAULT_MODEL_NAME = 'qwen2.5-coder-3b-instruct-q4_k_m.gguf';
const LLAMA_SERVER_PORT = 8787;

export class LlamaCppService implements AIService {
  readonly provider = 'local' as any;
  private serverProcess: ChildProcess | null = null;
  private serverReady: boolean = false;
  private llamaServerPath: string;
  private modelPath: string;
  private port: number;

  constructor(options?: {
    llamaServerPath?: string;
    modelPath?: string;
    port?: number;
  }) {
    // Find llama-server binary
    this.llamaServerPath = options?.llamaServerPath
      || process.env.LLAMA_SERVER_PATH
      || path.join(os.homedir(), 'llama.cpp', 'build', 'bin', 'llama-server');

    // Find model
    this.modelPath = options?.modelPath
      || process.env.LLAMA_MODEL_PATH
      || path.join(DEFAULT_MODEL_DIR, DEFAULT_MODEL_NAME);

    this.port = options?.port || LLAMA_SERVER_PORT;
  }

  /** Check if llama-server binary exists */
  isAvailable(): boolean {
    return fs.existsSync(this.llamaServerPath);
  }

  /** Check if a model is downloaded */
  hasModel(): boolean {
    return fs.existsSync(this.modelPath);
  }

  /** Get model file size in MB */
  getModelSizeMB(): number {
    if (!this.hasModel()) return 0;
    const stats = fs.statSync(this.modelPath);
    return Math.round(stats.size / (1024 * 1024));
  }

  /** Start the llama-server process */
  async startServer(): Promise<void> {
    if (this.serverReady) return;
    if (!this.isAvailable()) {
      throw new Error(`llama-server not found at: ${this.llamaServerPath}`);
    }
    if (!this.hasModel()) {
      throw new Error(`Model not found at: ${this.modelPath}`);
    }

    console.log(`🦙 Starting llama-server on port ${this.port}...`);
    console.log(`   Model: ${path.basename(this.modelPath)} (${this.getModelSizeMB()} MB)`);

    this.serverProcess = spawn(this.llamaServerPath, [
      '-m', this.modelPath,
      '--port', String(this.port),
      '-c', '2048',        // context window (smaller to fit in memory)
      '-ngl', '0',         // CPU only (safer for varied hardware)
      '--threads', String(Math.max(1, os.cpus().length - 2)),
      '--no-warmup',       // skip warmup to start faster
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });

    this.serverProcess.stderr?.on('data', (data) => {
      const msg = data.toString();
      // Log server output for debugging
      if (msg.includes('error') || msg.includes('fatal')) {
        console.error('🦙', msg.trim());
      }
    });

    this.serverProcess.on('exit', (code) => {
      console.log(`🦙 llama-server exited with code ${code}`);
      this.serverReady = false;
      this.serverProcess = null;
    });

    // Poll health endpoint until server is ready (up to 60s)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.serverReady) {
          reject(new Error('llama-server startup timed out'));
        }
      }, 60000);

      const check = setInterval(async () => {
        try {
          const resp = await fetch(`http://127.0.0.1:${this.port}/health`);
          if (resp.ok) {
            this.serverReady = true;
            clearInterval(check);
            clearTimeout(timeout);
            console.log('🦙 llama-server ready');
            resolve();
          }
        } catch {
          // Server not ready yet
        }
      }, 1000);
    });
  }

  /** Stop the server */
  stopServer(): void {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
      this.serverReady = false;
      console.log('🦙 llama-server stopped');
    }
  }

  private async chat(messages: Array<{ role: string; content: string }>): Promise<string> {
    if (!this.serverReady) {
      await this.startServer();
    }

    const response = await fetch(`http://127.0.0.1:${this.port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        temperature: 0.2,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      throw new Error(`llama-server returned ${response.status}`);
    }

    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content?.trim() || '';
  }

  async ask(question: string, context?: string): Promise<string> {
    const messages = [
      {
        role: 'system',
        content: 'You are a helpful terminal tutor. Explain commands clearly and concisely for someone learning the command line.',
      },
      {
        role: 'user',
        content: context ? `Context: ${context}\n\nQuestion: ${question}` : question,
      },
    ];
    return this.chat(messages);
  }

  async explainCommand(command: string): Promise<AIExplanation> {
    const messages = [
      {
        role: 'system',
        content: 'You are a terminal command expert. Always respond with valid JSON only, no markdown.',
      },
      { role: 'user', content: buildExplainPrompt(command) },
    ];
    const text = await this.chat(messages);
    return parseExplanation(text);
  }

  async suggestCommand(intent: string, workingDir: string): Promise<AISuggestion> {
    const messages = [
      {
        role: 'system',
        content: 'You are a terminal command expert. Always respond with valid JSON only, no markdown.',
      },
      { role: 'user', content: buildSuggestPrompt(intent, workingDir) },
    ];
    const text = await this.chat(messages);
    return parseSuggestion(text);
  }
}
