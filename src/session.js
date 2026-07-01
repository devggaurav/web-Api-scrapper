// Orchestrates a recording session: optionally launch a browser, attach the
// CDP recorder, then on stop normalize + write JSON / HAR / Markdown outputs.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CdpRecorder } from './cdpRecorder.js';
import { launchBrowser } from './browsers.js';
import { normalize } from './normalize.js';
import { toHar } from './exporters/har.js';
import { toMarkdown } from './exporters/markdown.js';

function stamp() {
  // Filesystem-safe timestamp without relying on locale.
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export class TrackingSession {
  constructor(opts = {}) {
    this.opts = opts;
    this.recorder = null;
    this.launched = null;
    this.active = false;
  }

  async start() {
    const { launch, browser, port = 9222, host = 'localhost', url, headless, urlMatch } = this.opts;

    if (launch) {
      // Launch to about:blank first so the recorder can attach and start
      // listening *before* the target page fires any requests.
      this.launched = launchBrowser({ id: browser, port, url: undefined, headless });
    }

    const targetFilter = urlMatch
      ? (t) => t.url && t.url.includes(urlMatch)
      : undefined;

    this.recorder = new CdpRecorder({ port, host, targetFilter });
    const info = await this.recorder.start();
    this.active = true;

    // Now that we're listening, drive the navigation ourselves.
    if (launch && url) {
      await this.recorder.navigate(url);
    }

    return { attachedTo: info.target, launched: Boolean(this.launched), port };
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

  async stop({ outDir, name, write = true, closeBrowser = false } = {}) {
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

    return { session, files };
  }
}
