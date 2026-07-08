// Turns raw CDP records into a clean, ordered, API-focused flow.

import { classify, registrableDomain } from './filter.js';
import { redactHeaders, redactQuery, redactBody } from './redact.js';

function tryParseJson(body) {
  if (typeof body !== 'string') return undefined;
  const t = body.trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return undefined;
  try { return JSON.parse(t); } catch { return undefined; }
}

function splitUrl(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname, path: u.pathname, query: u.search ? Object.fromEntries(u.searchParams) : undefined };
  } catch {
    return { host: '', path: url, query: undefined };
  }
}

// The sites the recording is "about": either an explicit scope given by the
// user, or auto-detected from the pages actually navigated to (Document
// requests + tab URLs). Kept API calls outside these sites are flagged
// thirdParty so the doc can separate them from the core flow.
function sessionSites(records, scopeHosts) {
  const sites = new Set();
  if (scopeHosts?.length) {
    for (const h of scopeHosts) {
      const host = String(h).replace(/^https?:\/\//, '').split('/')[0];
      const site = registrableDomain(host);
      if (site) sites.add(site);
    }
    return sites;
  }
  for (const rec of records) {
    const urls = [rec.resourceType === 'Document' ? rec.url : undefined, rec.tabUrl];
    for (const u of urls) {
      if (!u) continue;
      try {
        const site = registrableDomain(new URL(u).hostname);
        if (site) sites.add(site);
      } catch { /* about:blank etc. */ }
    }
  }
  return sites;
}

/**
 * @param {Array} records raw records from CdpRecorder
 * @param {object} opts { includeNoise, redact, scopeHosts }
 * @returns { flow, dropped, stats }
 */
export function normalize(records, { includeNoise = false, redact = true, scopeHosts } = {}) {
  const flow = [];
  const dropped = [];
  const hostCounts = {};
  const statusCounts = {};
  const sites = sessionSites(records, scopeHosts);

  for (const rec of records) {
    if (!rec.url) continue;
    const c = classify(rec, { sessionSites: sites });
    const { host, path, query } = splitUrl(rec.url);
    const entry = {
      index: rec.index,
      category: c.category,
      thirdParty: c.firstParty === false ? true : undefined,
      method: rec.method || 'GET',
      url: rec.url,
      host,
      path,
      query: query ? redactQuery(query, redact) : undefined,
      resourceType: rec.resourceType,
      status: rec.status,
      statusText: rec.statusText,
      startedAt: rec.wallTime ? new Date(rec.wallTime * 1000).toISOString() : undefined,
      durationMs: rec.durationMs != null ? Math.round(rec.durationMs) : undefined,
      sizeBytes: rec.encodedDataLength,
      fromCache: rec.fromCache || undefined,
      failed: rec.failed || undefined,
      errorText: rec.errorText,
      initiator: rec.initiator?.type,
      redirects: rec.redirects,
      tab: rec.tab, // 0-based tab index; >0 means a popup / new tab in the flow
      tabUrl: rec.tab > 0 ? rec.tabUrl : undefined,
      requestHeaders: redactHeaders(rec.requestHeaders, redact),
      responseHeaders: redactHeaders(rec.responseHeaders, redact),
    };

    const reqJson = tryParseJson(rec.requestBody);
    entry.requestBody = redactBody(reqJson !== undefined ? reqJson : rec.requestBody, redact);
    entry.requestBodyIsJson = reqJson !== undefined;

    if (!rec.responseBodyBase64) {
      const resJson = tryParseJson(rec.responseBody);
      entry.responseBody = redactBody(resJson !== undefined ? resJson : rec.responseBody, redact);
      entry.responseBodyIsJson = resJson !== undefined;
      entry.responseBodyTruncated = rec.responseBodyTruncated || undefined;
    } else {
      entry.responseBody = '[binary]';
    }

    if (c.keep || includeNoise) {
      if (!c.keep) entry.filteredReason = c.reason;
      flow.push(entry);
    } else {
      dropped.push({ method: entry.method, url: rec.url, reason: c.reason });
    }

    if (c.keep) {
      hostCounts[host] = (hostCounts[host] || 0) + 1;
      if (rec.status) statusCounts[rec.status] = (statusCounts[rec.status] || 0) + 1;
    }
  }

  // Tag repeated calls to the same endpoint (polling) so exporters can
  // collapse them. Keyed on method + host + path — query values (timestamps,
  // cursors, cache-busters) are deliberately ignored.
  const repeatCounts = new Map();
  for (const e of flow) {
    if (e.category !== 'api' || e.filteredReason) continue;
    const key = `${e.method} ${e.host}${e.path}`;
    repeatCounts.set(key, (repeatCounts.get(key) || 0) + 1);
  }
  for (const e of flow) {
    if (e.category !== 'api' || e.filteredReason) continue;
    const key = `${e.method} ${e.host}${e.path}`;
    if (repeatCounts.get(key) > 1) {
      e.repeatKey = key;
      e.repeatCount = repeatCounts.get(key);
    }
  }

  const kept = flow.filter((e) => !e.filteredReason);
  return {
    flow,
    dropped,
    stats: {
      totalCaptured: records.length,
      kept: kept.length,
      thirdParty: kept.filter((e) => e.thirdParty).length,
      droppedCount: dropped.length,
      sessionSites: [...sites],
      byHost: hostCounts,
      byStatus: statusCounts,
    },
  };
}
