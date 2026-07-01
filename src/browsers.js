// Browser detection + launch helpers for Chromium-family browsers on macOS,
// Linux and Windows. All of these speak the Chrome DevTools Protocol (CDP),
// which is what the recorder attaches to.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Per-platform candidate binary paths, keyed by a short browser id.
const BINARIES = {
  darwin: {
    brave: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
    chrome: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    ],
    // Arc ships a Chromium engine; the CDP endpoint works the same way.
    arc: ['/Applications/Arc.app/Contents/MacOS/Arc'],
    edge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    vivaldi: ['/Applications/Vivaldi.app/Contents/MacOS/Vivaldi'],
    opera: ['/Applications/Opera.app/Contents/MacOS/Opera'],
    chromium: ['/Applications/Chromium.app/Contents/MacOS/Chromium'],
  },
  linux: {
    brave: ['/usr/bin/brave-browser', '/usr/bin/brave'],
    chrome: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
    edge: ['/usr/bin/microsoft-edge'],
    vivaldi: ['/usr/bin/vivaldi'],
    opera: ['/usr/bin/opera'],
    chromium: ['/usr/bin/chromium', '/usr/bin/chromium-browser'],
  },
  win32: {
    brave: ['C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
    chrome: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ],
    edge: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
  },
};

// Browsers that are Chromium-based but not covered here (Safari/WebKit,
// Firefox/Gecko) do not expose CDP and need the proxy engine instead.
export const UNSUPPORTED_CDP = {
  safari: 'Safari uses WebKit and does not speak the Chrome DevTools Protocol. Use proxy mode (roadmap) or record in a Chromium browser.',
  firefox: 'Firefox uses a different remote protocol. Use proxy mode (roadmap) or record in a Chromium browser.',
};

export function resolveBrowser(id) {
  const platform = process.platform;
  const table = BINARIES[platform];
  if (!table) throw new Error(`Unsupported platform: ${platform}`);
  const candidates = table[id];
  if (!candidates) {
    if (UNSUPPORTED_CDP[id]) throw new Error(UNSUPPORTED_CDP[id]);
    throw new Error(`Unknown browser id "${id}". Known: ${Object.keys(table).join(', ')}`);
  }
  const bin = candidates.find((p) => existsSync(p));
  if (!bin) {
    throw new Error(
      `Could not find ${id} at any known path for ${platform}:\n  ${candidates.join('\n  ')}`,
    );
  }
  return bin;
}

// Which known browsers are actually installed on this machine.
export function detectInstalled() {
  const platform = process.platform;
  const table = BINARIES[platform] || {};
  const found = [];
  for (const [id, candidates] of Object.entries(table)) {
    const bin = candidates.find((p) => existsSync(p));
    if (bin) found.push({ id, bin });
  }
  return found;
}

/**
 * Launch a Chromium browser with remote debugging enabled and return the
 * child process. Uses a throwaway user-data-dir by default so it never
 * collides with the user's normal profile (which refuses --remote-debugging-port
 * if already running).
 */
export function launchBrowser({ id, port = 9222, url, userDataDir, headless = false } = {}) {
  const bin = resolveBrowser(id);
  const dataDir = userDataDir || mkdtempSync(join(tmpdir(), `bft-${id}-`));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
  ];
  if (headless) args.push('--headless=new');
  if (url) args.push(url);

  const child = spawn(bin, args, { stdio: 'ignore', detached: false });
  return { child, port, dataDir, bin };
}
