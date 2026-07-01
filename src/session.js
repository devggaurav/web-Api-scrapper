// Orchestrates a recording session: optionally launch a browser, attach the
// CDP recorder, then on stop normalize + write JSON / HAR / Markdown outputs.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import net from 'node:net';
import CDP from 'chrome-remote-interface';
import { CdpRecorder } from './cdpRecorder.js';
import { launchBrowser } from './browsers.js';
import { normalize } from './normalize.js';
import { toHar } from './exporters/har.js';
import { toMarkdown } from './exporters/markdown.js';

function stamp() {
  // Filesystem-safe timestamp without relying on locale.
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Grab an OS-assigned free TCP port. Fixes the #1 launch failure: colliding
// with something already sitting on the default 9222 debug port.
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Is a CDP endpoint already answering on this port? (i.e. our persistent
// profile's browser is still open from a previous recording).
async function isCdpAlive(port, host = 'localhost') {
  try {
    await CDP.List({ port, host });
    return true;
  } catch {
    return false;
  }
}

// A persistent, dedicated profile per browser. Separate from the user's normal
// profile (so it never conflicts with their running browser) and persistent
// (so a login done once carries over to the next recording).
function profileDir(id) {
  const dir = join(homedir(), '.browser-flow-tracker', 'profiles', id || 'default');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export class TrackingSession {
  constructor(opts = {}) {
    this.opts = opts;
    this.recorder = null;
    this.launched = null;
    this.active = false;
    this.finalized = null;      // set when files have been written
    this.closedByUser = false;  // true if finalized because the browser was closed
  }

  async start() {
    const { launch, browser, host = 'localhost', url, headless, urlMatch } = this.opts;
    // In attach mode, honor the given port (the user started their browser on it).
    let port = this.opts.port || 9222;
    this.reusedExisting = false;

    if (launch) {
      const dir = profileDir(browser);
      const portFile = join(dir, '.bft-port');

      // Reuse an already-open recording window (persistent profile still running)?
      if (existsSync(portFile)) {
        const prev = Number(readFileSync(portFile, 'utf8').trim());
        if (prev && (await isCdpAlive(prev, host))) {
          port = prev;
          this.reusedExisting = true;
        }
      }

      if (!this.reusedExisting) {
        // Fresh launch: a free port + a dedicated persistent profile means this
        // never collides with the user's normal browser or a busy 9222.
        port = await findFreePort();
        this.launched = launchBrowser({ id: browser, port, userDataDir: dir, headless });
        writeFileSync(portFile, String(port));
      }
    }

    const targetFilter = urlMatch
      ? (t) => t.url && t.url.includes(urlMatch)
      : undefined;

    this.recorder = new CdpRecorder({ port, host, targetFilter });
    // If the user closes the browser/tab, auto-finalize and write the files.
    this.recorder.onDisconnect = () => { this._onBrowserClosed(); };
    const info = await this.recorder.start();
    this.active = true;
    this.port = port;

    // Drive the initial navigation ourselves (after we're already listening, so
    // no early requests are missed). The user does the rest of the clicking.
    if (launch && url) {
      await this.recorder.navigate(url);
    }

    return {
      attachedTo: info.target,
      launched: Boolean(this.launched),
      reusedExisting: this.reusedExisting,
      port,
    };
  }

  // Live snapshot without stopping the session.
  snapshot() {
    if (!this.recorder) return { flow: [], stats: {} };
    const raw = this.recorder.getRecords();
    return normalize(raw, {
      includeNoise: this.opts.includeNoise,
      redact: this.opts.redact !== false,
    });
  }

  // Called when the CDP socket drops because the user closed the browser/tab.
  _onBrowserClosed() {
    if (!this.active || this.finalized) return; // already stopping/stopped
    this.closedByUser = true;
    // Fire-and-forget: write files with the session's default output settings.
    this.stop({
      outDir: this.opts.outDir,
      name: this.opts.name,
      closeBrowser: false,
    }).catch(() => { /* nothing we can do here */ });
  }

  async stop({ outDir, name, write = true, closeBrowser = false } = {}) {
    // Idempotent: if we already wrote files (e.g. the browser was closed), just
    // return that result instead of erroring on a later explicit stop.
    if (this.finalized) return this.finalized;
    if (!this.recorder) throw new Error('Session not started.');
    const raw = await this.recorder.stop();
    this.active = false;

    const norm = normalize(raw.records, {
      includeNoise: this.opts.includeNoise,
      redact: this.opts.redact !== false,
    });

    const session = {
      tool: 'browser-flow-tracker',
      version: '0.1.0',
      startedAt: raw.startedAt,
      stoppedAt: raw.stoppedAt,
      target: raw.target,
      stats: norm.stats,
      flow: norm.flow,
      dropped: norm.dropped,
    };

    let files = null;
    if (write) {
      const dir = outDir || join(process.cwd(), 'recordings');
      mkdirSync(dir, { recursive: true });
      const base = name || `flow-${stamp()}`;
      const jsonPath = join(dir, `${base}.flow.json`);
      const harPath = join(dir, `${base}.har`);
      const mdPath = join(dir, `${base}.md`);
      writeFileSync(jsonPath, JSON.stringify(session, null, 2));
      writeFileSync(harPath, JSON.stringify(toHar(session.flow, session), null, 2));
      writeFileSync(mdPath, toMarkdown({ ...session }, { title: this.opts.title }));
      files = { json: jsonPath, har: harPath, markdown: mdPath };
    }

    if (closeBrowser && this.launched?.child) {
      try { this.launched.child.kill(); } catch { /* ignore */ }
    }

    const result = { session, files, closedByUser: this.closedByUser };
    this.finalized = result;
    return result;
  }
}
