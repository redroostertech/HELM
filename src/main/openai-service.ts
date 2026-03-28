import OpenAI from 'openai';
import {
  AIService,
  AIExplanation,
  AISuggestion,
  buildExplainPrompt,
  buildSuggestPrompt,
  parseExplanation,
  parseSuggestion,
} from './ai-service';

export class OpenAIService implements AIService {
  readonly provider = 'openai' as const;
  private client: OpenAI;
  private model: string;

  constructor(apiKey?: string, model: string = 'auto', baseURL?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
    this.baseURL = baseURL || process.env.OPENAI_BASE_URL || undefined;
    this.client = null as any;
    this.model = model;
  }

  private apiKey: string;
  private baseURL: string | undefined;

  private getClient(): OpenAI {
    if (!this.client) {
      if (!this.apiKey) {
        throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY environment variable or pass it in.');
      }
      this.client = new OpenAI({
        apiKey: this.apiKey,
        ...(this.baseURL ? { baseURL: this.baseURL } : {}),
      });
    }
    return this.client;
  }

  async ask(question: string, context?: string): Promise<string> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: 'You are a helpful terminal tutor. Explain commands clearly and concisely for someone learning the command line.',
      },
    ];

    if (context) {
      messages.push({ role: 'user', content: `Context: ${context}\n\nQuestion: ${question}` });
    } else {
      messages.push({ role: 'user', content: question });
    }

    const response = await this.getClient().chat.completions.create({
      model: this.model,
      messages,
      temperature: 0.3,
    });

    return response.choices[0]?.message?.content?.trim() || '';
  }

  async explainCommand(command: string): Promise<AIExplanation> {
    const response = await this.getClient().chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: 'You are a terminal command expert. Always respond with valid JSON only, no markdown.',
        },
        { role: 'user', content: buildExplainPrompt(command) },
      ],
      temperature: 0.2,
    });

    const text = response.choices[0]?.message?.content?.trim() || '{}';
    return parseExplanation(text);
  }

  async suggestCommand(intent: string, workingDir: string): Promise<AISuggestion> {
    const response = await this.getClient().chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: 'You are a terminal command expert. Always respond with valid JSON only, no markdown.',
        },
        { role: 'user', content: buildSuggestPrompt(intent, workingDir) },
      ],
      temperature: 0.2,
    });

    const text = response.choices[0]?.message?.content?.trim() || '{}';
    return parseSuggestion(text);
  }
}
