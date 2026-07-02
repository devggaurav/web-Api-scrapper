// Turns raw CDP records into a clean, ordered, API-focused flow.

import { classify } from './filter.js';
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

/**
 * @param {Array} records raw records from CdpRecorder
 * @param {object} opts { includeNoise, redact }
 * @returns { flow, dropped, stats }
 */
export function normalize(records, { includeNoise = false, redact = true } = {}) {
  const flow = [];
  const dropped = [];
  const hostCounts = {};
  const statusCounts = {};

  for (const rec of records) {
    if (!rec.url) continue;
    const c = classify(rec);
    const { host, path, query } = splitUrl(rec.url);
    const entry = {
      index: rec.index,
      category: c.category,
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

  return {
    flow,
    dropped,
    stats: {
      totalCaptured: records.length,
      kept: flow.filter((e) => !e.filteredReason).length,
      droppedCount: dropped.length,
      byHost: hostCounts,
      byStatus: statusCounts,
    },
  };
}
