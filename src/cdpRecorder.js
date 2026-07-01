// Core capture engine. Attaches to a running Chromium browser over the
// Chrome DevTools Protocol and records the network flow of a page target in
// order, with request/response metadata and (bounded) bodies.

import CDP from 'chrome-remote-interface';

const DEFAULT_MAX_BODY = 512 * 1024; // 512 KB per body, to stay sane

// Wait until the CDP endpoint is reachable (a freshly launched browser needs
// a moment to open its debugging port).
async function waitForEndpoint(port, host, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const targets = await CDP.List({ port, host });
      if (targets.some((t) => t.type === 'page')) return targets;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `No CDP page target on ${host}:${port} within ${timeoutMs}ms.` +
      (lastErr ? ` Last error: ${lastErr.message}` : ''),
  );
}

export class CdpRecorder {
  constructor({ port = 9222, host = 'localhost', maxBodyBytes = DEFAULT_MAX_BODY, targetFilter } = {}) {
    this.port = port;
    this.host = host;
    this.maxBodyBytes = maxBodyBytes;
    this.targetFilter = targetFilter; // optional (target) => boolean to pick a tab
    this.client = null;
    this.seq = 0;
    this.startWall = null;
    this.startedAt = null;
    // requestId -> record
    this.records = new Map();
    // preserve emission order
    this.order = [];
    this.target = null;
  }

  async start() {
    const targets = await waitForEndpoint(this.port, this.host);
    const pages = targets.filter((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
    let chosen = pages;
    if (this.targetFilter) chosen = pages.filter(this.targetFilter);
    const target = chosen[0] || pages[0];
    if (!target) throw new Error('No suitable page target to attach to.');
    this.target = target;

    this.client = await CDP({ port: this.port, host: this.host, target });
    const { Network, Page } = this.client;

    await Network.enable({ maxTotalBufferSize: 100_000_000, maxResourceBufferSize: 20_000_000 });
    try { await Page.enable(); } catch { /* Page domain optional */ }

    this.startedAt = new Date().toISOString();

    Network.requestWillBeSent((p) => this._onRequest(p));
    Network.responseReceived((p) => this._onResponse(p));
    Network.loadingFinished((p) => this._onFinished(p));
    Network.loadingFailed((p) => this._onFailed(p));
    Network.webSocketCreated((p) => this._onWebSocket(p));

    // Fires when the browser/tab is closed by the user (the CDP socket drops).
    // Lets the session auto-finalize and write files on browser close.
    this.client.on('disconnect', () => {
      if (!this.stopping) this.onDisconnect?.();
    });

    return { target: { id: target.id, url: target.url, title: target.title } };
  }

  // Navigate the attached target. Used by launch mode so the recorder is
  // listening before the page fires its first request (avoids missing early calls).
  async navigate(url) {
    if (!this.client) throw new Error('Recorder not started.');
    await this.client.Page.navigate({ url });
  }

  _rec(requestId) {
    let rec = this.records.get(requestId);
    if (!rec) {
      rec = { requestId, index: this.seq++ };
      this.records.set(requestId, rec);
      this.order.push(requestId);
    }
    return rec;
  }

  _onRequest(p) {
    const rec = this._rec(p.requestId);
    const r = p.request;
    // A redirect reuses the requestId; keep the redirect chain instead of losing it.
    if (rec.method && p.redirectResponse) {
      rec.redirects = rec.redirects || [];
      rec.redirects.push({ url: rec.url, status: p.redirectResponse.status });
    }
    rec.method = r.method;
    rec.url = r.url;
    rec.resourceType = p.type;
    rec.requestHeaders = r.headers || {};
    rec.requestBody = r.postData;
    rec.hasPostData = r.hasPostData || Boolean(r.postData);
    rec.wallTime = p.wallTime;
    rec.timestamp = p.timestamp;
    rec.initiator = p.initiator ? { type: p.initiator.type } : undefined;
    if (this.startWall == null && p.wallTime) this.startWall = p.wallTime;
  }

  _onResponse(p) {
    const rec = this._rec(p.requestId);
    const res = p.response;
    rec.status = res.status;
    rec.statusText = res.statusText;
    rec.responseHeaders = res.headers || {};
    rec.mimeType = res.mimeType;
    rec.remoteAddress = res.remoteIPAddress ? `${res.remoteIPAddress}:${res.remotePort}` : undefined;
    rec.fromCache = res.fromDiskCache || res.fromServiceWorker || false;
    rec.protocol = res.protocol;
    if (res.timing) {
      rec.timing = res.timing;
      rec.responseTs = p.timestamp;
    }
  }

  async _onFinished(p) {
    const rec = this._rec(p.requestId);
    rec.encodedDataLength = p.encodedDataLength;
    rec.finishedTs = p.timestamp;
    if (rec.timestamp != null && p.timestamp != null) {
      rec.durationMs = Math.max(0, (p.timestamp - rec.timestamp) * 1000);
    }
    await this._captureBody(rec);
  }

  _onFailed(p) {
    const rec = this._rec(p.requestId);
    rec.failed = true;
    rec.errorText = p.errorText;
    rec.canceled = p.canceled;
    rec.finishedTs = p.timestamp;
    if (rec.timestamp != null && p.timestamp != null) {
      rec.durationMs = Math.max(0, (p.timestamp - rec.timestamp) * 1000);
    }
  }

  _onWebSocket(p) {
    const rec = this._rec(p.requestId);
    rec.method = 'WS';
    rec.url = p.url;
    rec.resourceType = 'WebSocket';
  }

  async _captureBody(rec) {
    if (rec.responseBody !== undefined) return;
    try {
      const { body, base64Encoded } = await this.client.Network.getResponseBody({
        requestId: rec.requestId,
      });
      if (base64Encoded) {
        rec.responseBodyBase64 = true;
        rec.responseBody = body.length > this.maxBodyBytes ? '[binary body omitted]' : body;
      } else if (body.length > this.maxBodyBytes) {
        rec.responseBody = body.slice(0, this.maxBodyBytes);
        rec.responseBodyTruncated = true;
      } else {
        rec.responseBody = body;
      }
    } catch {
      // Body may be unavailable (evicted, 204, websocket, etc.) — that's fine.
    }
  }

  // Snapshot of everything captured so far, in emission order.
  getRecords() {
    return this.order.map((id) => this.records.get(id)).filter(Boolean);
  }

  async stop() {
    this.stopping = true; // suppress the disconnect->auto-finalize path
    // Give any in-flight loadingFinished handlers a beat to grab bodies.
    await new Promise((r) => setTimeout(r, 200));
    const records = this.getRecords();
    if (this.client) {
      try { await this.client.close(); } catch { /* ignore */ }
      this.client = null;
    }
    return {
      startedAt: this.startedAt,
      stoppedAt: new Date().toISOString(),
      target: this.target ? { id: this.target.id, url: this.target.url, title: this.target.title } : null,
      records,
    };
  }
}
