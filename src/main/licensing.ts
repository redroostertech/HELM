import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HelmAPI } from './helm-api';

// BYOK ($2.99/mo): bring your own key, unlimited AI
// Basic ($9.99/mo): HELM key, 500 AI calls/month
// Pro ($12.99/mo): HELM key, 2000 AI calls/month

export type UserTier = 'free' | 'byok' | 'basic' | 'pro';

export interface License {
  tier: UserTier;
  email: string | null;
  licenseKey: string | null;
  expiresAt: string | null; // ISO date
  activatedAt: string | null;
  token: string | null; // JWT auth token
  userName: string | null;
  userId: string | null;
  lastSyncedAt: string | null; // ISO date of last backend sync
  usageThisMonth: {
    aiCalls: number;
    resetDate: string; // ISO date of next reset
  };
}

const LICENSE_PATH = path.join(os.homedir(), '.helm-license.json');

const TIER_CONFIG = {
  free:  { ai: true,  aiCallsPerMonth: 5,    usesOwnKey: false },
  byok:  { ai: true,  aiCallsPerMonth: -1,   usesOwnKey: true  }, // unlimited
  basic: { ai: true,  aiCallsPerMonth: 500,  usesOwnKey: false },
  pro:   { ai: true,  aiCallsPerMonth: 2000, usesOwnKey: false },
};

export class LicenseManager {
  private license: License;
  private api: HelmAPI;

  constructor() {
    this.api = new HelmAPI();
    this.license = this.load();
  }

  private load(): License {
    try {
      if (fs.existsSync(LICENSE_PATH)) {
        const data = JSON.parse(fs.readFileSync(LICENSE_PATH, 'utf-8'));

        // Check if usage needs reset (new month)
        const resetDate = new Date(data.usageThisMonth?.resetDate || '');
        if (resetDate < new Date()) {
          data.usageThisMonth = this.freshUsage();
        }

        return data;
      }
    } catch {}

    return {
      tier: 'free',
      email: null,
      licenseKey: null,
      expiresAt: null,
      activatedAt: null,
      token: null,
      userName: null,
      userId: null,
      lastSyncedAt: null,
      usageThisMonth: this.freshUsage(),
    };
  }

  private freshUsage() {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return {
      aiCalls: 0,
      resetDate: nextMonth.toISOString(),
    };
  }

  private save(): void {
    fs.writeFileSync(LICENSE_PATH, JSON.stringify(this.license, null, 2));
  }

  /** Get current license info */
  getLicense(): License {
    return { ...this.license };
  }

  /** Get current tier */
  getTier(): UserTier {
    // Check if pro/team license has expired
    if (this.license.tier !== 'free' && this.license.expiresAt) {
      if (new Date(this.license.expiresAt) < new Date()) {
        this.license.tier = 'free';
        this.license.licenseKey = null;
        this.save();
      }
    }
    return this.license.tier;
  }

  /** Check if user has AI access */
  canUseAI(): boolean {
    const tier = this.getTier();
    const config = TIER_CONFIG[tier];
    if (!config.ai) return false;
    // BYOK = unlimited
    if (config.aiCallsPerMonth === -1) return true;
    // Basic/Pro = check usage
    return this.license.usageThisMonth.aiCalls < config.aiCallsPerMonth;
  }

  /** Check if tier has AI feature at all */
  hasAIFeature(): boolean {
    return TIER_CONFIG[this.getTier()].ai;
  }

  /** Record an AI call */
  recordAICall(): void {
    this.license.usageThisMonth.aiCalls++;
    this.save();
  }

  /** Activate a license key (would validate against backend) */
  async activateLicense(email: string, licenseKey: string): Promise<{ success: boolean; error?: string }> {
    // TODO: Validate against RedRooster backend
    // POST to https://redroostertech.com/helm/api/activate
    // For now, validate format and accept
    try {
      const result = await this.validateWithBackend(email, licenseKey);
      if (result.valid) {
        this.license.tier = result.tier;
        this.license.email = email;
        this.license.licenseKey = licenseKey;
        this.license.expiresAt = result.expiresAt;
        this.license.activatedAt = new Date().toISOString();
        this.save();
        return { success: true };
      }
      return { success: false, error: result.error };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to validate license' };
    }
  }

  /** Deactivate / remove license */
  deactivateLicense(): void {
    this.license.tier = 'free';
    this.license.email = null;
    this.license.licenseKey = null;
    this.license.expiresAt = null;
    this.license.activatedAt = null;
    this.save();
  }

  /** Validate license key against backend */
  private async validateWithBackend(email: string, licenseKey: string): Promise<{
    valid: boolean;
    tier: UserTier;
    expiresAt: string;
    error?: string;
  }> {
    // Try backend validation first if we have a token
    if (this.license.token) {
      try {
        const result = await this.api.activateLicense(this.license.token, licenseKey);
        return {
          valid: result.valid,
          tier: result.tier as UserTier,
          expiresAt: result.expiresAt,
        };
      } catch (err: any) {
        // If 401, token expired — fall through to local validation
        if (err.status !== 401) {
          console.warn('Backend license validation failed, using local fallback:', err.message);
        }
      }
    }

    // Local fallback: accept keys by prefix
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    if (licenseKey.startsWith('HELM-BYOK-')) {
      return { valid: true, tier: 'byok', expiresAt: expiresAt.toISOString() };
    }
    if (licenseKey.startsWith('HELM-BASIC-')) {
      return { valid: true, tier: 'basic', expiresAt: expiresAt.toISOString() };
    }
    if (licenseKey.startsWith('HELM-PRO-')) {
      return { valid: true, tier: 'pro', expiresAt: expiresAt.toISOString() };
    }

    return { valid: false, tier: 'free', expiresAt: '', error: 'Invalid license key' };
  }

  // --- Auth Methods ---

  /** Check if user is authenticated */
  isAuthenticated(): boolean {
    return !!this.license.token;
  }

  /** Get auth state for the renderer */
  getAuthState(): {
    isAuthenticated: boolean;
    email: string | null;
    userName: string | null;
    userId: string | null;
    tier: UserTier;
  } {
    return {
      isAuthenticated: this.isAuthenticated(),
      email: this.license.email,
      userName: this.license.userName,
      userId: this.license.userId,
      tier: this.getTier(),
    };
  }

  /** Get the stored JWT token */
  getToken(): string | null {
    return this.license.token;
  }

  /** Login with email and password via the backend */
  async login(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.api.login(email, password);
      this.license.token = result.token;
      this.license.email = result.user.email;
      this.license.userName = result.user.name;
      this.license.userId = result.user.id;
      this.license.tier = result.user.tier || 'free';
      this.save();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Login failed' };
    }
  }

  /** Handle auth callback token from browser login */
  async handleAuthCallback(token: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Validate the token by fetching user profile
      const user = await this.api.getMe(token);
      this.license.token = token;
      this.license.email = user.email;
      this.license.userName = user.name;
      this.license.userId = user.id;
      this.license.tier = user.tier || 'free';
      this.license.lastSyncedAt = new Date().toISOString();
      if (user.subscription?.currentPeriodEnd) {
        this.license.expiresAt = user.subscription.currentPeriodEnd;
      }
      this.save();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Auth callback failed' };
    }
  }

  /** Logout — clear auth token but keep local settings */
  logout(): void {
    this.license.token = null;
    this.license.userName = null;
    this.license.userId = null;
    // Reset to free tier on logout
    this.license.tier = 'free';
    this.license.email = null;
    this.license.licenseKey = null;
    this.license.expiresAt = null;
    this.license.activatedAt = null;
    this.save();
  }

  /** Validate session with backend — syncs tier, usage, and timestamps */
  async validateSession(): Promise<boolean> {
    if (!this.license.token) return false;

    try {
      const result = await this.api.validateLicense(this.license.token);
      if (result.valid) {
        this.license.tier = result.tier as UserTier;
        this.license.expiresAt = result.expiresAt;
        this.license.lastSyncedAt = new Date().toISOString();
        if (result.usage) {
          this.license.usageThisMonth.aiCalls = result.usage.aiCalls;
        }

        // Also fetch detailed usage summary to keep local counts accurate
        try {
          const summary = await this.api.getUsageSummary(this.license.token);
          if (summary) {
            this.license.usageThisMonth.aiCalls = summary.aiCalls || 0;
            if (summary.resetDate) {
              this.license.usageThisMonth.resetDate = summary.resetDate;
            }
          }
        } catch {
          // Non-critical — usage summary fetch failed, keep license/validate data
        }

        this.save();
        return true;
      }
    } catch (err: any) {
      // If 401, token expired
      if (err.status === 401) {
        // Try token refresh
        try {
          const refreshed = await this.api.refreshToken(this.license.token);
          this.license.token = refreshed.token;
          this.save();
          return await this.validateSession(); // retry with new token
        } catch {
          // Refresh failed — clear auth
          this.logout();
        }
      }
    }
    return false;
  }

  /** Record AI usage to backend (fire-and-forget) */
  recordUsageToBackend(type: string, model: string): void {
    if (!this.license.token) return;
    this.api.recordUsage(this.license.token, type, model)
      .then((result) => {
        if (result?.usage) {
          // Sync local usage count with backend
          this.license.usageThisMonth.aiCalls = result.usage.aiCalls;
          this.save();
          console.log(`📊 Usage recorded: ${type} (${result.usage.aiCalls}/${result.usage.aiCallsLimit || '∞'})`);
        }
      })
      .catch((err) => {
        console.warn('📊 Usage recording failed:', err.message);
      });
  }

  /** Get login URL for opening in browser */
  getLoginUrl(): string {
    return this.api.getLoginUrl();
  }

  /** Get register URL for opening in browser */
  getRegisterUrl(): string {
    return this.api.getRegisterUrl();
  }

  /** Get pricing URL for upgrade */
  getPricingUrl(): string {
    return this.api.getPricingUrl();
  }

  /** Get usage summary for display */
  getUsageSummary(): {
    tier: UserTier;
    aiEnabled: boolean;
    aiCallsUsed: number;
    aiCallsLimit: number; // -1 = unlimited
    usesOwnKey: boolean;
    resetDate: string;
    isAuthenticated: boolean;
    lastSyncedAt: string | null;
  } {
    const tier = this.getTier();
    const config = TIER_CONFIG[tier];
    return {
      tier,
      aiEnabled: config.ai,
      aiCallsUsed: this.license.usageThisMonth.aiCalls,
      aiCallsLimit: config.aiCallsPerMonth,
      usesOwnKey: config.usesOwnKey,
      resetDate: this.license.usageThisMonth.resetDate,
      isAuthenticated: this.isAuthenticated(),
      lastSyncedAt: this.license.lastSyncedAt,
    };
  }
}
