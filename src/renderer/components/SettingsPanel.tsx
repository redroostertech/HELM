import { useState, useEffect } from 'react';
import './SettingsPanel.css';

interface Settings {
  theme: 'dark' | 'light';
  aiProvider: 'openai' | 'anthropic';
  openaiApiKey: string;
  anthropicApiKey: string;
  openaiModel: string;
  anthropicModel: string;
}

interface AuthState {
  isAuthenticated: boolean;
  email: string | null;
  userName: string | null;
  tier: string;
}

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsChange: (settings: Settings) => void;
  currentSettings: Settings;
  authState: AuthState;
  onAuthStateChange: (state: AuthState) => void;
}

function formatSyncTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function SettingsPanel({ isOpen, onClose, onSettingsChange, currentSettings, authState, onAuthStateChange }: SettingsPanelProps) {
  const [settings, setSettings] = useState<Settings>(currentSettings);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [usage, setUsage] = useState<any>(null);
  const [byoExpanded, setByoExpanded] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setSettings(currentSettings);
  }, [currentSettings]);

  useEffect(() => {
    if (isOpen) {
      window.electronAPI.licenseGetUsage().then(setUsage).catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleChange = (key: keyof Settings, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    onSettingsChange(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const hasOwnKey = !!(settings.openaiApiKey || settings.anthropicApiKey);

  return (
    <div className="settings-overlay">
      <div className="settings-header">
        <h2>Settings</h2>
        <div className="settings-header-actions">
          {authState.isAuthenticated && (
            <div className="settings-sync-group">
              {usage?.lastSyncedAt && (
                <span className="last-synced">Synced {formatSyncTime(usage.lastSyncedAt)}</span>
              )}
              <button
                className="sync-btn"
                disabled={syncing}
                onClick={async () => {
                  setSyncing(true);
                  try {
                    const result = await window.electronAPI.authSync();
                    if (result.usage) setUsage(result.usage);
                    if (result.authState) onAuthStateChange(result.authState);
                  } finally {
                    setSyncing(false);
                  }
                }}
                title="Refresh subscription status"
              >
                <svg
                  width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className={syncing ? 'spin' : ''}
                >
                  <polyline points="23 4 23 10 17 10"/>
                  <polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
                {syncing ? 'Syncing...' : 'Refresh'}
              </button>
            </div>
          )}
          <button className="settings-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="settings-body">
        {/* Account */}
        <section className="settings-section">
          <h3>Account</h3>
          {authState.isAuthenticated ? (
            <>
              <div className="setting-row">
                <label>Signed in as</label>
                <span className="settings-info-text">
                  {authState.userName || authState.email}
                </span>
              </div>
              {authState.email && authState.userName && (
                <div className="setting-row">
                  <label>Email</label>
                  <span className="settings-info-text">{authState.email}</span>
                </div>
              )}
              <div className="setting-row">
                <label></label>
                <button
                  className="danger-btn"
                  disabled={loggingOut}
                  onClick={async () => {
                    setLoggingOut(true);
                    try {
                      await window.electronAPI.authLogout();
                      const state = await window.electronAPI.authGetState();
                      onAuthStateChange(state);
                    } finally {
                      setLoggingOut(false);
                    }
                  }}
                >
                  {loggingOut ? 'Signing out...' : 'Sign Out'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="settings-hint" style={{ marginTop: 0, marginBottom: 16 }}>
                Sign in to unlock AI features including command explanations and chat.
              </p>
              <div className="auth-buttons">
                <button
                  className="auth-login-btn"
                  onClick={() => window.electronAPI.authOpenLogin()}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                    <polyline points="10 17 15 12 10 7"/>
                    <line x1="15" y1="12" x2="3" y2="12"/>
                  </svg>
                  Sign In
                </button>
                <button
                  className="auth-register-btn"
                  onClick={() => window.electronAPI.authOpenRegister()}
                >
                  Create Account
                </button>
              </div>
            </>
          )}
        </section>

        {/* Appearance */}
        <section className="settings-section">
          <h3>Appearance</h3>
          <div className="setting-row">
            <label>Theme</label>
            <div className="toggle-group">
              <button
                className={settings.theme === 'dark' ? 'active' : ''}
                onClick={() => handleChange('theme', 'dark')}
              >
                Dark
              </button>
              <button
                className={settings.theme === 'light' ? 'active' : ''}
                onClick={() => handleChange('theme', 'light')}
              >
                Light
              </button>
            </div>
          </div>
        </section>

        {/* Plan */}
        <section className="settings-section">
          <h3>Plan</h3>
          {usage && (
            <>
              <div className="setting-row">
                <label>Current Plan</label>
                <span className="plan-badge">{usage.tier === 'byok' ? 'BYOK' : usage.tier.toUpperCase()}</span>
              </div>
              {usage.aiEnabled ? (
                <>
                  <div className="setting-row">
                    <label>AI Features</label>
                    <span className="key-status key-status-active" style={{ margin: 0, padding: '4px 10px' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      Enabled
                    </span>
                  </div>
                  {usage.aiCallsLimit > 0 && (
                    <>
                      <div className="setting-row">
                        <label>Usage</label>
                        <span className="settings-info-text">
                          {usage.aiCallsUsed} / {usage.aiCallsLimit} requests this month
                        </span>
                      </div>
                      <div className="usage-bar-container">
                        <div
                          className="usage-bar"
                          style={{ width: `${Math.min(100, (usage.aiCallsUsed / usage.aiCallsLimit) * 100)}%` }}
                        />
                      </div>
                    </>
                  )}
                  {usage.usesOwnKey && (
                    <div className="setting-row">
                      <label>Requests</label>
                      <span className="settings-info-text">Unlimited (own key)</span>
                    </div>
                  )}
                </>
              ) : null}
              {authState.isAuthenticated && (
                <div className="setting-row" style={{ marginTop: 8 }}>
                  <label>Subscription</label>
                  <button
                    className="auth-register-btn"
                    onClick={() => window.electronAPI.authOpenPricing()}
                    style={{ padding: '6px 16px', fontSize: '12px' }}
                  >
                    Manage Subscription
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* Bring Your Own Key */}
        <section className="settings-section">
          <h3>Bring Your Own Key</h3>
          {usage?.tier === 'byok' ? (
            <>
              <p className="settings-hint" style={{ marginTop: 0, marginBottom: 12 }}>
                Configure your own OpenAI or Anthropic key for unlimited AI requests.
              </p>

              <div className="setting-row">
                <label>Provider</label>
                <div className="toggle-group">
                  <button
                    className={settings.aiProvider === 'openai' ? 'active' : ''}
                    onClick={() => {
                      handleChange('aiProvider', 'openai');
                      setShowApiKey(false);
                    }}
                  >
                    OpenAI
                  </button>
                  <button
                    className={settings.aiProvider === 'anthropic' ? 'active' : ''}
                    onClick={() => {
                      handleChange('aiProvider', 'anthropic');
                      setShowApiKey(false);
                    }}
                  >
                    Anthropic
                  </button>
                </div>
              </div>

              {/* OpenAI config */}
              {settings.aiProvider === 'openai' && (
                <>
                  <div className="setting-row">
                    <label>API Key</label>
                    <div className="key-input">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={settings.openaiApiKey}
                        onChange={e => handleChange('openaiApiKey', e.target.value)}
                        placeholder="sk-..."
                      />
                      <button
                        className="toggle-visibility"
                        onClick={() => setShowApiKey(!showApiKey)}
                      >
                        {showApiKey ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>
                  <div className="setting-row">
                    <label>Model</label>
                    <select
                      value={settings.openaiModel}
                      onChange={e => handleChange('openaiModel', e.target.value)}
                    >
                      <option value="gpt-4o">GPT-4o</option>
                      <option value="gpt-4o-mini">GPT-4o Mini</option>
                      <option value="gpt-4-turbo">GPT-4 Turbo</option>
                    </select>
                  </div>
                  {settings.openaiApiKey && (
                    <div className="key-status key-status-active">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      Key configured — unlimited requests
                    </div>
                  )}
                </>
              )}

              {/* Anthropic config */}
              {settings.aiProvider === 'anthropic' && (
                <>
                  <div className="setting-row">
                    <label>API Key</label>
                    <div className="key-input">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={settings.anthropicApiKey}
                        onChange={e => handleChange('anthropicApiKey', e.target.value)}
                        placeholder="sk-ant-..."
                      />
                      <button
                        className="toggle-visibility"
                        onClick={() => setShowApiKey(!showApiKey)}
                      >
                        {showApiKey ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>
                  <div className="setting-row">
                    <label>Model</label>
                    <select
                      value={settings.anthropicModel}
                      onChange={e => handleChange('anthropicModel', e.target.value)}
                    >
                      <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                      <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                      <option value="claude-opus-4-20250514">Claude Opus 4</option>
                    </select>
                  </div>
                  {settings.anthropicApiKey && (
                    <div className="key-status key-status-active">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      Key configured — unlimited requests
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="byok-promo">
              <p className="settings-hint" style={{ marginTop: 0, marginBottom: 12 }}>
                Use your own OpenAI or Anthropic API key for unlimited AI requests with no monthly cap.
              </p>
              <div className="byok-promo-features">
                <div className="byok-promo-feature">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  Unlimited AI requests
                </div>
                <div className="byok-promo-feature">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  Choose OpenAI or Anthropic
                </div>
                <div className="byok-promo-feature">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  Pick any model (GPT-4o, Claude, etc.)
                </div>
              </div>
              <button
                className="byok-upgrade-btn"
                onClick={() => window.electronAPI.authOpenPricing()}
              >
                Upgrade to BYOK — $2.99/mo
              </button>
            </div>
          )}
        </section>

        {/* Data */}
        <section className="settings-section">
          <h3>Data</h3>
          <div className="setting-row">
            <label>Command History</label>
            <button
              className="danger-btn"
              onClick={() => {
                const event = new CustomEvent('show-delete-history-modal');
                window.dispatchEvent(event);
              }}
            >
              Clear History
            </button>
          </div>
        </section>
      </div>

      <div className="settings-footer">
        <div className="settings-branding">
          <div className="settings-brand-row">
            <img src="/helm-logo-dark.png" alt="HELM" className="settings-brand-logo" />
            <span className="settings-brand-name">HELM</span>
          </div>
          <span className="settings-brand-sub">Powered by LANA AI</span>
          <span className="settings-brand-copy">&copy; 2026 RedRooster Technologies Inc.</span>
        </div>
        <div className="settings-footer-actions">
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button className="save-btn" onClick={handleSave}>
            {saved ? 'Saved!' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
