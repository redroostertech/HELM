import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type UserTier = 'free' | 'pro' | 'team';

export interface License {
  tier: UserTier;
  email: string | null;
  licenseKey: string | null;
  expiresAt: string | null; // ISO date
  activatedAt: string | null;
  usageThisMonth: {
    aiCalls: number;
    resetDate: string; // ISO date of next reset
  };
}

const LICENSE_PATH = path.join(os.homedir(), '.helm-license.json');

const FREE_LIMITS = {
  aiCallsPerMonth: 50,          // Free users: 50 calls/month
};

const PRO_LIMITS = {
  aiCallsPerMonth: 2000,        // Pro: 2000 calls/month
};

const TEAM_LIMITS = {
  aiCallsPerMonth: 10000,       // Team: 10000 calls/month
};

export class LicenseManager {
  private license: License;

  constructor() {
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

  /** Check if user can make an AI call */
  canMakeAICall(): boolean {
    const tier = this.getTier();
    const limits = tier === 'team' ? TEAM_LIMITS : tier === 'pro' ? PRO_LIMITS : FREE_LIMITS;
    return this.license.usageThisMonth.aiCalls < limits.aiCallsPerMonth;
  }

  /** Get remaining AI calls */
  getRemainingCalls(): number {
    const tier = this.getTier();
    const limits = tier === 'team' ? TEAM_LIMITS : tier === 'pro' ? PRO_LIMITS : FREE_LIMITS;
    return Math.max(0, limits.aiCallsPerMonth - this.license.usageThisMonth.aiCalls);
  }

  /** Record an AI call */
  recordAICall(): void {
    this.license.usageThisMonth.aiCalls++;
    this.save();
  }

  /** Check if user has their own API key (bypass HELM usage limits) */
  hasOwnKey(settings: any): boolean {
    return !!(settings?.openaiApiKey || settings?.anthropicApiKey);
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
    // TODO: Replace with actual API call when backend is ready
    // const response = await fetch('https://redroostertech.com/helm/api/activate', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ email, licenseKey }),
    // });

    // For now: accept any key starting with "HELM-PRO-" or "HELM-TEAM-"
    if (licenseKey.startsWith('HELM-PRO-')) {
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      return { valid: true, tier: 'pro', expiresAt: expiresAt.toISOString() };
    }
    if (licenseKey.startsWith('HELM-TEAM-')) {
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      return { valid: true, tier: 'team', expiresAt: expiresAt.toISOString() };
    }

    return { valid: false, tier: 'free', expiresAt: '', error: 'Invalid license key' };
  }

  /** Get usage summary for display */
  getUsageSummary(): {
    tier: UserTier;
    aiCallsUsed: number;
    aiCallsLimit: number;
    aiCallsRemaining: number;
    resetDate: string;
  } {
    const tier = this.getTier();
    const limits = tier === 'team' ? TEAM_LIMITS : tier === 'pro' ? PRO_LIMITS : FREE_LIMITS;
    return {
      tier,
      aiCallsUsed: this.license.usageThisMonth.aiCalls,
      aiCallsLimit: limits.aiCallsPerMonth,
      aiCallsRemaining: this.getRemainingCalls(),
      resetDate: this.license.usageThisMonth.resetDate,
    };
  }
}
