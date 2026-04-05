/**
 * CLI installer — symlinks the bundled `helm` shim onto the user's PATH.
 *
 * Preference order:
 *   1. ~/.local/bin/helm (if ~/.local/bin is on PATH or can be created)
 *   2. ~/bin/helm       (if ~/bin is on PATH)
 *   3. /usr/local/bin/helm (if writable, with a confirm dialog)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app, dialog } from 'electron';

export interface InstallResult {
  ok: boolean;
  path?: string;
  error?: string;
  note?: string;
}

/** Path to the bundled helm shim inside the app. */
function resolveShimSource(): string {
  // In packaged app: <AppBundle>/Contents/Resources/cli/helm (extraResources)
  // In dev: src/main/cli/helm relative to project root
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'cli', 'helm');
  }
  // Dev: __dirname is dist/main, project root is two levels up
  return path.join(__dirname, '..', '..', 'src', 'main', 'cli', 'helm');
}

function isOnPath(dir: string): boolean {
  const PATH = process.env.PATH || '';
  const parts = PATH.split(':').map(p => p.replace(/\/+$/, ''));
  const normalized = dir.replace(/\/+$/, '');
  return parts.includes(normalized);
}

function canWrite(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) {
      // Try to create it (for ~/.local/bin etc.)
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function symlinkShim(sourcePath: string, targetPath: string): void {
  // Remove any existing symlink or file
  try {
    const st = fs.lstatSync(targetPath);
    if (st.isSymbolicLink() || st.isFile()) {
      fs.unlinkSync(targetPath);
    }
  } catch { /* doesn't exist */ }
  fs.symlinkSync(sourcePath, targetPath);
  try { fs.chmodSync(sourcePath, 0o755); } catch {}
}

export async function installCLI(): Promise<InstallResult> {
  const source = resolveShimSource();
  if (!fs.existsSync(source)) {
    return { ok: false, error: `CLI shim not found at ${source}` };
  }

  const home = os.homedir();
  const localBin = path.join(home, '.local', 'bin');
  const userBin = path.join(home, 'bin');
  const usrLocalBin = '/usr/local/bin';

  // 1. ~/.local/bin
  if (canWrite(localBin)) {
    try {
      const target = path.join(localBin, 'helm');
      symlinkShim(source, target);
      const note = isOnPath(localBin)
        ? undefined
        : `Note: ${localBin} is not on your PATH. Add this to your shell profile:\n  export PATH="$HOME/.local/bin:$PATH"`;
      return { ok: true, path: target, note };
    } catch (err: any) {
      // fall through
    }
  }

  // 2. ~/bin
  if (canWrite(userBin)) {
    try {
      const target = path.join(userBin, 'helm');
      symlinkShim(source, target);
      const note = isOnPath(userBin)
        ? undefined
        : `Note: ${userBin} is not on your PATH. Add this to your shell profile:\n  export PATH="$HOME/bin:$PATH"`;
      return { ok: true, path: target, note };
    } catch {
      // fall through
    }
  }

  // 3. /usr/local/bin (with confirmation)
  if (canWrite(usrLocalBin)) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Install to /usr/local/bin', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: 'Install the helm CLI command?',
      detail: `This will create a symlink at /usr/local/bin/helm pointing to the bundled shim. You can run "helm" from any terminal afterwards.`,
    });
    if (response !== 0) {
      return { ok: false, error: 'install cancelled' };
    }
    try {
      const target = path.join(usrLocalBin, 'helm');
      symlinkShim(source, target);
      return { ok: true, path: target };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  // Nothing writable — tell the user what to do
  return {
    ok: false,
    error: `No writable directory on your PATH. Run this in your terminal:\n  sudo ln -sf "${source}" /usr/local/bin/helm`,
  };
}
