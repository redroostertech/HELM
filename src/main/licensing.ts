import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
  usageThisMonth: {
    aiCalls: number;
    resetDate: string; // ISO date of next reset
  };
}

const LICENSE_PATH = path.join(os.homedir(), '.helm-license.json');

const TIER_CONFIG = {
  free:  { ai: false, aiCallsPerMonth: 0,    usesOwnKey: false },
  byok:  { ai: true,  aiCallsPerMonth: -1,   usesOwnKey: true  }, // unlimited
  basic: { ai: true,  aiCallsPerMonth: 500,  usesOwnKey: false },
  pro:   { ai: true,  aiCallsPerMonth: 2000, usesOwnKey: false },
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
    // TODO: Replace with actual API call when backend is ready
    // const response = await fetch('https://redroostertech.com/helm/api/activate', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ email, licenseKey }),
    // });

    // For now: accept keys by prefix. Backend will validate for real.
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

  /** Get usage summary for display */
  getUsageSummary(): {
    tier: UserTier;
    aiEnabled: boolean;
    aiCallsUsed: number;
    aiCallsLimit: number; // -1 = unlimited
    usesOwnKey: boolean;
    resetDate: string;
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
    };
  }
}
