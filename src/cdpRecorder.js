// Core capture engine. Connects to a Chromium browser over the Chrome
// DevTools Protocol and records the network flow of page targets in order,
// with request/response metadata and (bounded) bodies.
//
// Multi-tab aware, race-free: a single browser-level CDP connection uses
// Target.setAutoAttach with waitForDebuggerOnStart, so every new tab/popup
// (OAuth windows, payment redirects, "open in new tab") is PAUSED at creation
// until Network capture is enabled — no requests are missed, and the whole
// flow lands in one recording. Tabs are multiplexed over one socket via flat
// CDP sessions.

import CDP from 'chrome-remote-interface';

const DEFAULT_MAX_BODY = 512 * 1024; // 512 KB per body, to stay sane
const STOP_BODY_GRACE_MS = 1500; // max wait for in-flight body fetches on stop

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

function isRecordablePage(info) {
  const url = info.url || '';
  return info.type === 'page' && !url.startsWith('devtools://');
}

export class CdpRecorder {
  /**
   * @param {object} opts
   *   port, host      - CDP endpoint
   *   maxBodyBytes    - per-body capture cap
   *   targetFilter    - optional (target) => boolean to pick initial tab(s)
   *   attachAll       - record ALL page targets, incl. any new tab that
   *                     appears (launch mode: the whole window is ours).
   *                     When false (attach mode), only the filtered/first tab
   *                     plus popups OPENED BY a recorded tab are captured.
   */
  constructor({ port = 9222, host = 'localhost', maxBodyBytes = DEFAULT_MAX_BODY, targetFilter, attachAll = false } = {}) {
    this.port = port;
    this.host = host;
    this.maxBodyBytes = maxBodyBytes;
    this.targetFilter = targetFilter;
    this.attachAll = attachAll;
    this.client = null; // single browser-level connection
    this.sessions = new Map(); // sessionId -> tab {index, targetId, url}
    this.tabTargetIds = new Set(); // targetIds we record (for openerId checks)
    this.wantedTargetIds = new Set(); // initial tabs chosen at start()
    this.tabSeq = 0;
    this.seq = 0;
    this.startedAt = null;
    this.records = new Map(); // `${sessionId}:${requestId}` -> record
    this.order = [];
    this.pendingBodies = new Set(); // in-flight getResponseBody promises
    this.target = null; // main (first) target info, for the doc header
    this.mainSessionId = null;
    this.stopping = false;
    this.everAttached = false;
  }

  async start() {
    const targets = await waitForEndpoint(this.port, this.host);
    const pages = targets.filter((t) => isRecordablePage({ type: t.type, url: t.url }));
    let chosen = this.targetFilter ? pages.filter(this.targetFilter) : pages;
    if (!this.attachAll && !this.targetFilter) chosen = pages.slice(0, 1);
    if (!chosen.length) chosen = pages.slice(0, 1);
    if (!chosen.length) throw new Error('No suitable page target to attach to.');
    for (const t of chosen) this.wantedTargetIds.add(t.id);

    const version = await CDP.Version({ port: this.port, host: this.host });
    if (!version.webSocketDebuggerUrl) {
      throw new Error('Browser exposes no webSocketDebuggerUrl; a Chromium >= 63 is required.');
    }
    const client = await CDP({ target: version.webSocketDebuggerUrl });
    this.client = client;
    this.startedAt = new Date().toISOString();

    client.on('disconnect', () => {
      if (!this.stopping) this.onDisconnect?.();
    });

    // Route network events to the owning tab via the flat-session id.
    client.on('Network.requestWillBeSent', (p, sid) => this._onRequest(sid, p));
    client.on('Network.responseReceived', (p, sid) => this._onResponse(sid, p));
    client.on('Network.loadingFinished', (p, sid) => this._onFinished(sid, p));
    client.on('Network.loadingFailed', (p, sid) => this._onFailed(sid, p));
    client.on('Network.webSocketCreated', (p, sid) => this._onWebSocket(sid, p));

    client.on('Target.attachedToTarget', (p) => { this._onAttached(p).catch(() => {}); });
    client.on('Target.detachedFromTarget', ({ sessionId }) => this._onDetached(sessionId));

    // Pause every NEW target at creation until we've enabled Network on it.
    await client.Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

    // Existing tabs aren't covered by autoAttach — attach to the chosen ones.
    for (const t of chosen) {
      await client.Target.attachToTarget({ targetId: t.id, flatten: true });
    }

    // attachedToTarget events have been handled synchronously above.
    return { target: this.target, tabs: this.sessions.size };
  }

  async _onAttached({ sessionId, targetInfo, waitingForDebugger }) {
    const { targetId } = targetInfo;
    const wanted = this.wantedTargetIds.has(targetId);
    const openedByUs = targetInfo.openerId && this.tabTargetIds.has(targetInfo.openerId);
    const record =
      !this.stopping &&
      isRecordablePage(targetInfo) &&
      (wanted || this.attachAll || openedByUs);

    if (!record) {
      // Not ours: resume it (it may be paused) and let it go.
      try { await this.client.Runtime.runIfWaitingForDebugger(sessionId); } catch { /* ignore */ }
      try { await this.client.Target.detachFromTarget({ sessionId }); } catch { /* ignore */ }
      return;
    }

    const tab = { index: this.tabSeq++, targetId, url: targetInfo.url || '' };
    this.sessions.set(sessionId, tab);
    this.tabTargetIds.add(targetId);
    this.everAttached = true;
    if (this.mainSessionId == null) {
      this.mainSessionId = sessionId;
      this.target = { id: targetId, url: targetInfo.url, title: targetInfo.title };
    }

    try {
      await this.client.Network.enable(
        { maxTotalBufferSize: 100_000_000, maxResourceBufferSize: 20_000_000 },
        sessionId,
      );
      try { await this.client.Page.enable(sessionId); } catch { /* Page domain optional */ }
    } finally {
      // Only resume the page once capture is on — this is what makes new
      // tabs/popups lose zero requests.
      if (waitingForDebugger) {
        try { await this.client.Runtime.runIfWaitingForDebugger(sessionId); } catch { /* ignore */ }
      }
    }
  }

  // A recorded tab went away (closed or crashed). When the LAST one goes,
  // treat it like the user closing the browser: auto-finalize. (On macOS the
  // browser process can outlive its last window, so the browser-level
  // disconnect alone isn't enough.)
  _onDetached(sessionId) {
    const tab = this.sessions.get(sessionId);
    if (!tab) return;
    this.sessions.delete(sessionId);
    this.tabTargetIds.delete(tab.targetId);
    if (!this.stopping && this.everAttached && this.sessions.size === 0) {
      this.onDisconnect?.();
    }
  }

  // Navigate the main tab. Used by launch mode so the recorder is listening
  // before the page fires its first request (avoids missing early calls).
  async navigate(url) {
    if (!this.client || this.mainSessionId == null) throw new Error('Recorder not started.');
    await this.client.Page.navigate({ url }, this.mainSessionId);
  }

  _rec(sessionId, requestId) {
    const key = `${sessionId}:${requestId}`;
    let rec = this.records.get(key);
    if (!rec) {
      rec = { requestId, index: this.seq++ };
      this.records.set(key, rec);
      this.order.push(key);
    }
    return rec;
  }

  _onRequest(sessionId, p) {
    const tab = this.sessions.get(sessionId);
    if (!tab) return;
    const rec = this._rec(sessionId, p.requestId);
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
    rec.tab = tab.index;
    // A tab's first document request is its real URL (popups start blank).
    if (p.type === 'Document') tab.url = r.url;
    rec.tabUrl = tab.url;
  }

  _onResponse(sessionId, p) {
    if (!this.sessions.has(sessionId)) return;
    const rec = this._rec(sessionId, p.requestId);
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

  _onFinished(sessionId, p) {
    if (!this.sessions.has(sessionId)) return;
    const rec = this._rec(sessionId, p.requestId);
    rec.encodedDataLength = p.encodedDataLength;
    rec.finishedTs = p.timestamp;
    if (rec.timestamp != null && p.timestamp != null) {
      rec.durationMs = Math.max(0, (p.timestamp - rec.timestamp) * 1000);
    }
    // Track the fetch so stop() can wait for in-flight bodies instead of
    // closing the socket under them (which silently dropped tail-end bodies).
    const promise = this._captureBody(sessionId, rec).finally(() => {
      this.pendingBodies.delete(promise);
    });
    this.pendingBodies.add(promise);
  }

  _onFailed(sessionId, p) {
    if (!this.sessions.has(sessionId)) return;
    const rec = this._rec(sessionId, p.requestId);
    rec.failed = true;
    rec.errorText = p.errorText;
    rec.canceled = p.canceled;
    rec.finishedTs = p.timestamp;
    if (rec.timestamp != null && p.timestamp != null) {
      rec.durationMs = Math.max(0, (p.timestamp - rec.timestamp) * 1000);
    }
  }

  _onWebSocket(sessionId, p) {
    const tab = this.sessions.get(sessionId);
    if (!tab) return;
    const rec = this._rec(sessionId, p.requestId);
    rec.method = 'WS';
    rec.url = p.url;
    rec.resourceType = 'WebSocket';
    rec.tab = tab.index;
    rec.tabUrl = tab.url;
  }

  async _captureBody(sessionId, rec) {
    if (rec.responseBody !== undefined) return;
    try {
      const { body, base64Encoded } = await this.client.Network.getResponseBody(
        { requestId: rec.requestId },
        sessionId,
      );
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
      // Body may be unavailable (evicted, 204, websocket, closed tab) — fine.
    }
  }

  // Snapshot of everything captured so far, in emission order.
  getRecords() {
    return this.order.map((key) => this.records.get(key)).filter(Boolean);
  }

  async stop({ closeBrowser = false } = {}) {
    this.stopping = true; // suppress the disconnect->auto-finalize path
    // Let in-flight loadingFinished body fetches land (bounded wait).
    if (this.pendingBodies.size) {
      await Promise.race([
        Promise.allSettled([...this.pendingBodies]),
        new Promise((r) => setTimeout(r, STOP_BODY_GRACE_MS)),
      ]);
    }
    const records = this.getRecords();
    // Quit the browser via CDP while the socket is still open. Works even for
    // a reused persistent-profile window we didn't spawn.
    let browserClosed = false;
    if (closeBrowser && this.client) {
      try {
        await this.client.Browser.close();
        browserClosed = true;
      } catch { /* fall back to killing the child process, if any */ }
    }
    if (this.client) {
      try { await this.client.close(); } catch { /* ignore */ }
      this.client = null;
    }
    this.sessions.clear();
    return {
      startedAt: this.startedAt,
      stoppedAt: new Date().toISOString(),
      target: this.target,
      records,
      browserClosed,
    };
  }
}
