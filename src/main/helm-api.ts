import { app } from 'electron';

/**
 * HELM API client — connects to RedRoosterTech-Web backend.
 * Dev mode: localhost:1234
 * Production: https://helm.lanaai.io/helm/api
 */

const DEV_API_URL = 'http://localhost:1234/helm/api';
const PROD_API_URL = 'https://helm.lanaai.io/helm/api';

function getBaseUrl(): string {
  if (process.env.HELM_API_URL) return process.env.HELM_API_URL;
  return app.isPackaged ? PROD_API_URL : DEV_API_URL;
}

export class HelmAPI {
  private baseUrl: string;

  constructor() {
    this.baseUrl = getBaseUrl();
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const error: any = new Error(body.message || `API error ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }

    return response.json();
  }

  private authHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  // --- Auth ---

  async login(email: string, password: string): Promise<{ token: string; user: any }> {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async register(email: string, password: string, name: string): Promise<{ token: string; user: any }> {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });
  }

  async refreshToken(token: string): Promise<{ token: string }> {
    return this.request('/auth/refresh', {
      method: 'POST',
      headers: this.authHeaders(token),
    });
  }

  async getMe(token: string): Promise<any> {
    return this.request('/auth/me', {
      headers: this.authHeaders(token),
    });
  }

  // --- License ---

  async validateLicense(token: string): Promise<{
    valid: boolean;
    tier: string;
    expiresAt: string;
    usage: { aiCalls: number; aiCallsLimit: number; resetDate: string };
  }> {
    return this.request('/license/validate', {
      method: 'POST',
      headers: this.authHeaders(token),
    });
  }

  async activateLicense(token: string, licenseKey: string): Promise<{
    valid: boolean;
    tier: string;
    expiresAt: string;
  }> {
    return this.request('/license/activate', {
      method: 'POST',
      headers: this.authHeaders(token),
      body: JSON.stringify({ licenseKey }),
    });
  }

  // --- Usage ---

  async recordUsage(token: string, type: string, model: string, tokensUsed?: number): Promise<any> {
    return this.request('/usage/record', {
      method: 'POST',
      headers: this.authHeaders(token),
      body: JSON.stringify({ type, model, tokensUsed }),
    });
  }

  async getUsageSummary(token: string): Promise<any> {
    return this.request('/usage/summary', {
      headers: this.authHeaders(token),
    });
  }

  // --- AI Proxy ---

  async aiAsk(token: string, question: string, context?: string): Promise<{ answer: string; usage?: any }> {
    return this.request('/ai/ask', {
      method: 'POST',
      headers: this.authHeaders(token),
      body: JSON.stringify({ question, context }),
    });
  }

  async aiExplain(token: string, command: string): Promise<any> {
    return this.request('/ai/explain', {
      method: 'POST',
      headers: this.authHeaders(token),
      body: JSON.stringify({ command }),
    });
  }

  async aiSuggest(token: string, intent: string, workingDir: string): Promise<any> {
    return this.request('/ai/suggest', {
      method: 'POST',
      headers: this.authHeaders(token),
      body: JSON.stringify({ intent, workingDir }),
    });
  }

  // --- Tier Configuration ---

  async getTierConfig(): Promise<Record<string, { aiCallsPerMonth: number; features: string[] }>> {
    return this.request('/config/tiers');
  }

  // --- Billing ---

  async createCheckout(token: string, tier: string): Promise<{ checkoutUrl: string }> {
    return this.request('/billing/create-checkout', {
      method: 'POST',
      headers: this.authHeaders(token),
      body: JSON.stringify({ tier }),
    });
  }

  async getBillingPortal(token: string): Promise<{ portalUrl: string }> {
    return this.request('/billing/portal', {
      method: 'POST',
      headers: this.authHeaders(token),
    });
  }

  /** Get the login URL for opening in the system browser */
  getLoginUrl(): string {
    const base = app.isPackaged ? 'https://helm.lanaai.io' : 'http://localhost:1234';
    return `${base}/helm/login?callback=helm://auth/callback`;
  }

  /** Get the registration URL */
  getRegisterUrl(): string {
    const base = app.isPackaged ? 'https://helm.lanaai.io' : 'http://localhost:1234';
    return `${base}/helm/register?callback=helm://auth/callback`;
  }

  /** Get the pricing URL for upgrades */
  getPricingUrl(): string {
    const base = app.isPackaged ? 'https://helm.lanaai.io' : 'http://localhost:1234';
    return `${base}/helm/pricing`;
  }
}
