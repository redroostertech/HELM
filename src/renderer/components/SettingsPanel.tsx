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

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsChange: (settings: Settings) => void;
  currentSettings: Settings;
}

export default function SettingsPanel({ isOpen, onClose, onSettingsChange, currentSettings }: SettingsPanelProps) {
  const [settings, setSettings] = useState<Settings>(currentSettings);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [usage, setUsage] = useState<any>(null);
  const [byoExpanded, setByoExpanded] = useState(false);

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
        <button className="settings-close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div className="settings-body">
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

        {/* Usage & Plan */}
        <section className="settings-section">
          <h3>Plan & Usage</h3>
          {usage && (
            <>
              <div className="setting-row">
                <label>Current Plan</label>
                <span className="plan-badge">{usage.tier.toUpperCase()}</span>
              </div>
              <div className="setting-row">
                <label>AI Requests</label>
                <span className="settings-info-text">
                  {hasOwnKey ? (
                    'Unlimited (using your own key)'
                  ) : (
                    `${usage.aiCallsUsed} / ${usage.aiCallsLimit} this month`
                  )}
                </span>
              </div>
              {!hasOwnKey && (
                <div className="usage-bar-container">
                  <div
                    className="usage-bar"
                    style={{ width: `${Math.min(100, (usage.aiCallsUsed / usage.aiCallsLimit) * 100)}%` }}
                  />
                </div>
              )}
              {usage.tier === 'free' && !hasOwnKey && (
                <p className="settings-hint">
                  Upgrade to Pro for 2,000 requests/month, or add your own API key for unlimited use.
                </p>
              )}
            </>
          )}
        </section>

        {/* Bring Your Own Key */}
        <section className="settings-section">
          <h3>Bring Your Own Key</h3>
          <p className="settings-hint" style={{ marginTop: 0, marginBottom: 12 }}>
            Add your own API key for unlimited requests — no HELM usage limits apply.
          </p>

          <div className="setting-row">
            <label>Provider</label>
            <div className="toggle-group">
              <button
                className={settings.aiProvider === 'openai' ? 'active' : ''}
                onClick={() => {
                  handleChange('aiProvider', 'openai');
                  setShowApiKey(false);
                  setByoExpanded(true);
                }}
              >
                OpenAI
              </button>
              <button
                className={settings.aiProvider === 'anthropic' ? 'active' : ''}
                onClick={() => {
                  handleChange('aiProvider', 'anthropic');
                  setShowApiKey(false);
                  setByoExpanded(true);
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
