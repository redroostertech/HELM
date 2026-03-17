import { AIService, AIExplanation, AISuggestion } from './ai-service';
import { HelmAPI } from './helm-api';

/**
 * Proxy AI Service — routes AI requests through the RedRoosterTech-Web backend.
 * Used for non-BYOK tiers (Free, Basic, Pro) so the API key stays on the server.
 */
export class ProxyAIService implements AIService {
  readonly provider = 'openai' as const; // backend currently uses OpenAI
  private api: HelmAPI;
  private token: string;

  constructor(api: HelmAPI, token: string) {
    this.api = api;
    this.token = token;
  }

  /** Update the token (e.g. after refresh) */
  setToken(token: string): void {
    this.token = token;
  }

  async ask(question: string, context?: string): Promise<string> {
    const result = await this.api.aiAsk(this.token, question, context);
    return result.answer;
  }

  async explainCommand(command: string): Promise<AIExplanation> {
    const result = await this.api.aiExplain(this.token, command);
    // The backend returns the explanation fields at the top level (plus a usage field)
    const { usage, ...explanation } = result;
    return explanation as AIExplanation;
  }

  async suggestCommand(intent: string, workingDir: string): Promise<AISuggestion> {
    const result = await this.api.aiSuggest(this.token, intent, workingDir);
    const { usage, ...suggestion } = result;
    return suggestion as AISuggestion;
  }
}
