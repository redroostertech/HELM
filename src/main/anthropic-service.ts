import Anthropic from '@anthropic-ai/sdk';
import {
  AIService,
  AIExplanation,
  AISuggestion,
  buildExplainPrompt,
  buildSuggestPrompt,
  parseExplanation,
  parseSuggestion,
} from './ai-service';

export class AnthropicService implements AIService {
  readonly provider = 'anthropic' as const;
  private client: Anthropic;
  private model: string;

  constructor(apiKey?: string, model: string = 'claude-sonnet-4-20250514') {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.model = model;
  }

  async ask(question: string, context?: string): Promise<string> {
    const userContent = context
      ? `Context: ${context}\n\nQuestion: ${question}`
      : question;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: 'You are a helpful terminal tutor. Explain commands clearly and concisely for someone learning the command line.',
      messages: [{ role: 'user', content: userContent }],
    });

    const block = response.content[0];
    return block.type === 'text' ? block.text.trim() : '';
  }

  async explainCommand(command: string): Promise<AIExplanation> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: 'You are a terminal command expert. Always respond with valid JSON only, no markdown.',
      messages: [{ role: 'user', content: buildExplainPrompt(command) }],
    });

    const block = response.content[0];
    const text = block.type === 'text' ? block.text.trim() : '{}';
    return parseExplanation(text);
  }

  async suggestCommand(intent: string, workingDir: string): Promise<AISuggestion> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: 'You are a terminal command expert. Always respond with valid JSON only, no markdown.',
      messages: [{ role: 'user', content: buildSuggestPrompt(intent, workingDir) }],
    });

    const block = response.content[0];
    const text = block.type === 'text' ? block.text.trim() : '{}';
    return parseSuggestion(text);
  }
}
