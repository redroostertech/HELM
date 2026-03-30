import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as tls from 'tls';
import { WebSocketServer, WebSocket } from 'ws';

// ── Types ────────────────────────────────────────────────────────────

export interface PairedDevice {
  id: string;
  name: string;
  pairedAt: string;
  lastSeen: string;
}

export interface MobileServerStatus {
  running: boolean;
  port: number;
  connectedDevices: number;
  pairedDevices: PairedDevice[];
  localIP: string | null;
  accessUrl: string | null;
}

interface MobileSettings {
  enabled: boolean;
  port: number;
  idleTimeoutMinutes: number;
  pairedDevices: PairedDevice[];
}

interface AuthenticatedClient {
  ws: WebSocket;
  deviceId: string;
  deviceName: string;
  subscribedTab: string | null;
  lastActivity: number;
}

type PTYWriteCallback = (tabId: string, data: string) => void;
type PTYResizeCallback = (tabId: string, cols: number, rows: number) => void;
type GetTabsCallback = () => Array<{ id: string; label: string; description: string }>;
type GetPTYDataListenerCallback = (tabId: string, callback: (data: string) => void) => void;

// ── Helpers ─────────────────────────────────────────────────────────

function getLocalIP(): string | null {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

// ── Constants ────────────────────────────────────────────────────────

const MOBILE_SETTINGS_PATH = path.join(os.homedir(), '.helm-mobile.json');
const CERT_DIR = path.join(os.homedir(), '.helm', 'certs');
const CERT_PATH = path.join(CERT_DIR, 'mobile-cert.pem');
const KEY_PATH = path.join(CERT_DIR, 'mobile-key.pem');

// ── Mobile Access Server ─────────────────────────────────────────────

export class MobileAccessServer {
  private server: https.Server | null = null;
  private wss: WebSocketServer | null = null;
  private settings: MobileSettings;
  private activePIN: string | null = null;
  private pinExpiresAt: number = 0;
  private clients: Map<string, AuthenticatedClient> = new Map();
  private idleTimer: ReturnType<typeof setInterval> | null = null;

  // Callbacks to interact with the main process PTY layer
  private ptyWrite: PTYWriteCallback | null = null;
  private ptyResize: PTYResizeCallback | null = null;
  private getTabs: GetTabsCallback | null = null;
  private dataListeners: Map<string, (data: string) => void> = new Map();

  // Rolling buffer of recent PTY output per tab (for catching up new subscribers)
  private tabBuffers: Map<string, string> = new Map();
  private static MAX_BUFFER_SIZE = 50000;

  constructor() {
    this.settings = this.loadSettings();
  }

  // ── Settings persistence ─────────────────────────────────────────

  private loadSettings(): MobileSettings {
    try {
      if (fs.existsSync(MOBILE_SETTINGS_PATH)) {
        return JSON.parse(fs.readFileSync(MOBILE_SETTINGS_PATH, 'utf-8'));
      }
    } catch { /* ignore */ }
    return {
      enabled: false,
      port: 8384,
      idleTimeoutMinutes: 15,
      pairedDevices: [],
    };
  }

  private saveSettings(): void {
    fs.writeFileSync(MOBILE_SETTINGS_PATH, JSON.stringify(this.settings, null, 2));
  }

  // ── Self-signed TLS certificate ──────────────────────────────────

  private ensureCerts(): { cert: string; key: string } {
    if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
      return {
        cert: fs.readFileSync(CERT_PATH, 'utf-8'),
        key: fs.readFileSync(KEY_PATH, 'utf-8'),
      };
    }

    if (!fs.existsSync(CERT_DIR)) {
      fs.mkdirSync(CERT_DIR, { recursive: true });
    }

    // Generate a self-signed certificate using Node's built-in crypto
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Create a minimal self-signed X.509 certificate
    // Use Node's createSign to sign a DER-encoded TBS certificate
    const cert = this.createSelfSignedCert(privateKey, publicKey);

    fs.writeFileSync(KEY_PATH, privateKey, { mode: 0o600 });
    fs.writeFileSync(CERT_PATH, cert, { mode: 0o644 });

    return { cert, key: privateKey };
  }

  /**
   * Create a minimal self-signed X.509 v3 certificate.
   * We build the ASN.1 DER structure manually to avoid external dependencies.
   */
  private createSelfSignedCert(privateKeyPem: string, publicKeyPem: string): string {
    // Helper to build DER-encoded ASN.1
    const asn1Len = (len: number): Buffer => {
      if (len < 0x80) return Buffer.from([len]);
      if (len < 0x100) return Buffer.from([0x81, len]);
      return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
    };

    const asn1Seq = (...parts: Buffer[]): Buffer => {
      const body = Buffer.concat(parts);
      return Buffer.concat([Buffer.from([0x30]), asn1Len(body.length), body]);
    };

    const asn1Set = (inner: Buffer): Buffer => {
      return Buffer.concat([Buffer.from([0x31]), asn1Len(inner.length), inner]);
    };

    const asn1OID = (oidBytes: number[]): Buffer => {
      const body = Buffer.from(oidBytes);
      return Buffer.concat([Buffer.from([0x06]), asn1Len(body.length), body]);
    };

    const asn1UTF8 = (str: string): Buffer => {
      const body = Buffer.from(str, 'utf-8');
      return Buffer.concat([Buffer.from([0x0c]), asn1Len(body.length), body]);
    };

    const asn1Int = (val: Buffer): Buffer => {
      // Ensure positive integer (prepend 0x00 if high bit set)
      let v = val;
      if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0x00]), v]);
      return Buffer.concat([Buffer.from([0x02]), asn1Len(v.length), v]);
    };

    const asn1BitString = (data: Buffer): Buffer => {
      // Bit string: 0 unused bits prefix
      const body = Buffer.concat([Buffer.from([0x00]), data]);
      return Buffer.concat([Buffer.from([0x03]), asn1Len(body.length), body]);
    };

    const asn1Explicit = (tag: number, inner: Buffer): Buffer => {
      return Buffer.concat([Buffer.from([0xa0 | tag]), asn1Len(inner.length), inner]);
    };

    const asn1GeneralizedTime = (date: Date): Buffer => {
      const s = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
      const body = Buffer.from(s, 'ascii');
      return Buffer.concat([Buffer.from([0x18]), asn1Len(body.length), body]);
    };

    // Serial number
    const serial = crypto.randomBytes(16);
    serial[0] &= 0x7f; // ensure positive

    // Validity: now to +10 years
    const notBefore = new Date();
    const notAfter = new Date();
    notAfter.setFullYear(notAfter.getFullYear() + 10);

    // Subject/Issuer: CN=HELM Mobile Access
    const cnOID = asn1OID([0x55, 0x04, 0x03]); // id-at-commonName
    const cnValue = asn1UTF8('HELM Mobile Access');
    const rdnSeq = asn1Seq(asn1Set(asn1Seq(cnOID, cnValue)));

    // SHA-256 with RSA OID
    const sha256WithRSA = asn1Seq(
      asn1OID([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]),
      Buffer.from([0x05, 0x00]) // NULL
    );

    // Extract the raw public key DER from PEM
    const pubDer = Buffer.from(
      publicKeyPem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''),
      'base64'
    );

    // TBSCertificate
    const tbs = asn1Seq(
      asn1Explicit(0, asn1Int(Buffer.from([0x02]))), // version v3
      asn1Int(serial),
      sha256WithRSA,
      rdnSeq, // issuer
      asn1Seq(asn1GeneralizedTime(notBefore), asn1GeneralizedTime(notAfter)),
      rdnSeq, // subject
      pubDer  // subjectPublicKeyInfo (already a SEQUENCE from spki encoding)
    );

    // Sign the TBS
    const signer = crypto.createSign('SHA256');
    signer.update(tbs);
    const signature = signer.sign(privateKeyPem);

    // Full certificate
    const cert = asn1Seq(tbs, sha256WithRSA, asn1BitString(signature));

    const b64 = cert.toString('base64');
    const lines = b64.match(/.{1,64}/g) || [];
    return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
  }

  // ── Callbacks for PTY integration ────────────────────────────────

  setPTYCallbacks(
    write: PTYWriteCallback,
    resize: PTYResizeCallback,
    getTabs: GetTabsCallback,
    addDataListener: GetPTYDataListenerCallback,
  ): void {
    this.ptyWrite = write;
    this.ptyResize = resize;
    this.getTabs = getTabs;

    // This callback lets us subscribe to PTY data for a given tab
    // We store the addDataListener function for use when clients subscribe
    this._addDataListener = addDataListener;
  }

  private _addDataListener: GetPTYDataListenerCallback | null = null;

  // ── PIN pairing ──────────────────────────────────────────────────

  generatePIN(): string {
    const pin = String(crypto.randomInt(100000, 999999));
    this.activePIN = pin;
    this.pinExpiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
    return pin;
  }

  private verifyPIN(pin: string): boolean {
    if (!this.activePIN) return false;
    if (Date.now() > this.pinExpiresAt) {
      this.activePIN = null;
      return false;
    }
    if (pin === this.activePIN) {
      this.activePIN = null; // one-time use
      return true;
    }
    return false;
  }

  // ── Device management ────────────────────────────────────────────

  getPairedDevices(): PairedDevice[] {
    return [...this.settings.pairedDevices];
  }

  revokeDevice(deviceId: string): void {
    this.settings.pairedDevices = this.settings.pairedDevices.filter(d => d.id !== deviceId);
    this.saveSettings();

    // Disconnect the client if connected
    const client = this.clients.get(deviceId);
    if (client) {
      client.ws.close(4001, 'Device revoked');
      this.clients.delete(deviceId);
    }
  }

  // ── Server lifecycle ─────────────────────────────────────────────

  getStatus(): MobileServerStatus {
    const ip = getLocalIP();
    return {
      running: this.server !== null,
      port: this.settings.port,
      connectedDevices: this.clients.size,
      pairedDevices: this.settings.pairedDevices,
      localIP: ip,
      accessUrl: ip && this.server ? `https://${ip}:${this.settings.port}` : null,
    };
  }

  getSettings(): MobileSettings {
    return { ...this.settings };
  }

  updateSettings(partial: Partial<MobileSettings>): void {
    if (partial.port !== undefined) this.settings.port = partial.port;
    if (partial.idleTimeoutMinutes !== undefined) this.settings.idleTimeoutMinutes = partial.idleTimeoutMinutes;
    if (partial.enabled !== undefined) this.settings.enabled = partial.enabled;
    this.saveSettings();
  }

  async start(): Promise<void> {
    if (this.server) return;

    const { cert, key } = this.ensureCerts();

    // Serve static PWA files over HTTPS, and upgrade to WebSocket
    this.server = https.createServer(
      {
        cert,
        key,
        // Allow self-signed
        rejectUnauthorized: false,
      } as tls.TlsOptions,
      (req, res) => this.handleHTTP(req, res)
    );

    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws, req) => this.handleWSConnection(ws, req));

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.settings.port, '0.0.0.0', () => {
        console.log(`📱 Mobile access server listening on port ${this.settings.port}`);
        resolve();
      });
      this.server!.on('error', reject);
    });

    // Idle timeout checker
    this.idleTimer = setInterval(() => this.checkIdleClients(), 60_000);
  }

  stop(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }

    // Close all clients
    for (const [id, client] of this.clients) {
      client.ws.close(1001, 'Server stopping');
    }
    this.clients.clear();

    // Remove data listeners
    this.dataListeners.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }

    console.log('📱 Mobile access server stopped');
  }

  // ── HTTP handler (serves PWA static files) ───────────────────────

  private handleHTTP(req: http.IncomingMessage, res: http.ServerResponse): void {
    let urlPath = req.url || '/';
    if (urlPath === '/') urlPath = '/index.html';

    // Only serve files from the mobile-pwa directory
    const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(__dirname, 'mobile-pwa', safePath);

    // Security: ensure the resolved path is within mobile-pwa
    const pwaDir = path.join(__dirname, 'mobile-pwa');
    if (!filePath.startsWith(pwaDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(filePath)) {
      // SPA fallback
      const indexPath = path.join(pwaDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        });
        res.end(fs.readFileSync(indexPath));
        return;
      }
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath);
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.webmanifest': 'application/manifest+json',
    };

    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(fs.readFileSync(filePath));
  }

  // ── WebSocket connection handler ─────────────────────────────────

  private handleWSConnection(ws: WebSocket, _req: http.IncomingMessage): void {
    let authenticated = false;
    let deviceId: string | null = null;

    // Timeout: must authenticate within 30 seconds
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        ws.close(4002, 'Authentication timeout');
      }
    }, 30_000);

    ws.on('message', (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (!authenticated) {
        // Only accept auth messages before authentication
        if (msg.type === 'auth') {
          this.handleAuth(ws, msg, authTimeout).then((result) => {
            if (result) {
              authenticated = true;
              deviceId = result;
            }
          });
        }
        return;
      }

      // Authenticated — handle commands
      const client = deviceId ? this.clients.get(deviceId) : null;
      if (client) {
        client.lastActivity = Date.now();
      }

      switch (msg.type) {
        case 'getTabs':
          this.handleGetTabs(ws);
          break;
        case 'subscribe':
          if (deviceId && msg.tabId) {
            this.handleSubscribe(deviceId, msg.tabId);
          }
          break;
        case 'input':
          if (msg.tabId && msg.data) {
            this.handleInput(msg.tabId, msg.data);
          }
          break;
        case 'resize':
          if (msg.tabId && msg.cols && msg.rows) {
            this.handleResize(msg.tabId, msg.cols, msg.rows);
          }
          break;
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (deviceId) {
        this.cleanupClient(deviceId);
      }
    });

    ws.on('error', () => {
      clearTimeout(authTimeout);
      if (deviceId) {
        this.cleanupClient(deviceId);
      }
    });
  }

  private async handleAuth(
    ws: WebSocket,
    msg: any,
    authTimeout: ReturnType<typeof setTimeout>
  ): Promise<string | null> {
    const { pin, deviceId: reqDeviceId, deviceName } = msg;

    // Check if this is a returning paired device
    if (reqDeviceId) {
      const paired = this.settings.pairedDevices.find(d => d.id === reqDeviceId);
      if (paired) {
        clearTimeout(authTimeout);
        paired.lastSeen = new Date().toISOString();
        this.saveSettings();

        const client: AuthenticatedClient = {
          ws,
          deviceId: paired.id,
          deviceName: paired.name,
          subscribedTab: null,
          lastActivity: Date.now(),
        };
        this.clients.set(paired.id, client);

        ws.send(JSON.stringify({
          type: 'authResult',
          success: true,
          deviceId: paired.id,
        }));

        return paired.id;
      }
    }

    // New device — verify PIN
    if (!pin || !this.verifyPIN(pin)) {
      ws.send(JSON.stringify({
        type: 'authResult',
        success: false,
        error: 'Invalid or expired PIN',
      }));
      return null;
    }

    clearTimeout(authTimeout);

    // Check if a device with the same name already exists — update instead of duplicating
    const existingByName = this.settings.pairedDevices.find(d => d.name === (deviceName || 'Mobile Device'));
    if (existingByName) {
      existingByName.lastSeen = new Date().toISOString();
      this.saveSettings();

      const client: AuthenticatedClient = {
        ws,
        deviceId: existingByName.id,
        deviceName: existingByName.name,
        subscribedTab: null,
        lastActivity: Date.now(),
      };
      this.clients.set(existingByName.id, client);

      ws.send(JSON.stringify({
        type: 'authResult',
        success: true,
        deviceId: existingByName.id,
      }));
      return existingByName.id;
    }

    // Register new paired device
    const newDeviceId = crypto.randomUUID();
    const device: PairedDevice = {
      id: newDeviceId,
      name: deviceName || 'Mobile Device',
      pairedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };

    this.settings.pairedDevices.push(device);
    this.saveSettings();

    const client: AuthenticatedClient = {
      ws,
      deviceId: newDeviceId,
      deviceName: device.name,
      subscribedTab: null,
      lastActivity: Date.now(),
    };
    this.clients.set(newDeviceId, client);

    ws.send(JSON.stringify({
      type: 'authResult',
      success: true,
      deviceId: newDeviceId,
    }));

    return newDeviceId;
  }

  // ── Command handlers ─────────────────────────────────────────────

  private handleGetTabs(ws: WebSocket): void {
    const tabs = this.getTabs ? this.getTabs() : [];
    ws.send(JSON.stringify({ type: 'tabs', tabs }));
  }

  private handleSubscribe(deviceId: string, tabId: string): void {
    const client = this.clients.get(deviceId);
    if (!client) return;

    // Unsubscribe from previous tab
    if (client.subscribedTab) {
      const key = `${deviceId}:${client.subscribedTab}`;
      this.dataListeners.delete(key);
    }

    client.subscribedTab = tabId;

    // Subscribe to PTY data for this tab
    if (this._addDataListener) {
      const key = `${deviceId}:${tabId}`;
      const listener = (data: string) => {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({ type: 'output', tabId, data }));
        }
      };
      this.dataListeners.set(key, listener);
      this._addDataListener(tabId, listener);
    }

    client.ws.send(JSON.stringify({ type: 'subscribed', tabId }));

    // Send buffered output so the client catches up with the current session
    const buffer = this.tabBuffers.get(tabId);
    if (buffer && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({ type: 'output', tabId, data: buffer }));
    }
  }

  private handleInput(tabId: string, data: string): void {
    console.log(`📱 Mobile input: tabId=${tabId}, data=${JSON.stringify(data)}, hasWrite=${!!this.ptyWrite}`);
    if (this.ptyWrite) {
      this.ptyWrite(tabId, data);
    } else {
      console.warn('📱 No ptyWrite callback set — input dropped');
    }
  }

  private handleResize(tabId: string, cols: number, rows: number): void {
    if (this.ptyResize) {
      this.ptyResize(tabId, cols, rows);
    }
  }

  // ── Idle management ──────────────────────────────────────────────

  private checkIdleClients(): void {
    const timeoutMs = this.settings.idleTimeoutMinutes * 60 * 1000;
    const now = Date.now();

    for (const [deviceId, client] of this.clients) {
      if (now - client.lastActivity > timeoutMs) {
        console.log(`📱 Disconnecting idle device: ${client.deviceName}`);
        client.ws.close(4003, 'Idle timeout');
        this.cleanupClient(deviceId);
      }
    }
  }

  private cleanupClient(deviceId: string): void {
    const client = this.clients.get(deviceId);
    if (client?.subscribedTab) {
      const key = `${deviceId}:${client.subscribedTab}`;
      this.dataListeners.delete(key);
    }
    this.clients.delete(deviceId);
  }

  // ── Public method to broadcast PTY data ──────────────────────────

  /**
   * Called from main process when PTY data is received.
   * Broadcasts to all clients subscribed to this tab.
   */
  broadcastPTYData(tabId: string, data: string): void {
    // Buffer the data so new subscribers can catch up
    const existing = this.tabBuffers.get(tabId) || '';
    const updated = existing + data;
    this.tabBuffers.set(tabId, updated.length > MobileAccessServer.MAX_BUFFER_SIZE
      ? updated.slice(-MobileAccessServer.MAX_BUFFER_SIZE)
      : updated
    );

    for (const [deviceId, client] of this.clients) {
      if (client.subscribedTab === tabId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: 'output', tabId, data }));
      }
    }
  }

  /**
   * Notify all connected clients that the tab list has changed.
   */
  broadcastTabsChanged(): void {
    const tabs = this.getTabs ? this.getTabs() : [];
    const msg = JSON.stringify({ type: 'tabs', tabs });
    for (const [_, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg);
      }
    }
  }

  /** Broadcast CLI conversation events (thinking, responses) to mobile clients */
  broadcastCLIEvent(tabId: string, event: { type: string; content: string }): void {
    const msg = JSON.stringify({ type: 'cliEvent', tabId, event });
    for (const [_, client] of this.clients) {
      if (client.subscribedTab === tabId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg);
      }
    }
  }

  /** Notify mobile clients that a CLI program started/stopped in a tab */
  broadcastCLIStatus(tabId: string, active: boolean, programName?: string): void {
    const msg = JSON.stringify({ type: 'cliStatus', tabId, active, programName });
    for (const [_, client] of this.clients) {
      if (client.subscribedTab === tabId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg);
      }
    }
  }
}
