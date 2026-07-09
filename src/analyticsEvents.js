// Decodes captured analytics/telemetry beacons into a structured, chronological
// timeline of business events (GA4 add_to_cart, Segment track calls, …).
//
// This is a second lens over the SAME raw records the flow is built from: the
// requests classify() drops from the API flow as "analytics" are exactly the
// ones decoded here, so the two views can never disagree. Every provider
// decoder may emit multiple events per request — batching is the norm.

import { classify, registrableDomain } from './filter.js';
import { redactJson } from './redact.js';

const MAX_GENERIC_BODY = 2000; // cap raw payloads kept by the generic decoder

function queryToObject(params, { skip } = {}) {
  const out = {};
  for (const [k, v] of params.entries()) {
    if (skip && skip(k)) continue;
    out[k] = v;
  }
  return out;
}

function tryJson(text) {
  if (typeof text !== 'string') return undefined;
  const t = text.trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return undefined;
  try { return JSON.parse(t); } catch { return undefined; }
}

function tryBase64Json(s) {
  if (typeof s !== 'string' || !s) return undefined;
  try {
    return tryJson(Buffer.from(decodeURIComponent(s), 'base64').toString('utf8'))
      ?? tryJson(Buffer.from(s, 'base64').toString('utf8'));
  } catch {
    return undefined;
  }
}

// --- provider decoders -------------------------------------------------------
// Each takes { host, path, query, bodyText, bodyJson } and returns an array of
// { event, params } — or null when the request isn't theirs.

// GA4 events live in `en=` (query or newline-separated body lines); event
// params are prefixed ep.* (string) / epn.* (number). Universal Analytics uses
// t=event with ec/ea/el/ev.
function ga4Params(params) {
  const out = {};
  for (const [k, v] of params.entries()) {
    if (k.startsWith('ep.')) out[k.slice(3)] = v;
    else if (k.startsWith('epn.')) out[k.slice(4)] = Number(v);
  }
  return out;
}

function decodeGoogle({ host, path, query, bodyText }) {
  const isGa =
    /\/(g|j|mp)\/collect/.test(path) ||
    (host.includes('google-analytics.com') && path.includes('/collect'));
  if (!isGa) return null;
  const events = [];
  const page = query.get('dl') || undefined;

  if (query.get('en')) {
    events.push({ event: query.get('en'), params: { ...ga4Params(query), ...(page ? { page } : {}) } });
  } else if (query.get('t')) {
    // Universal Analytics hit
    const t = query.get('t');
    if (t === 'event') {
      events.push({
        event: `${query.get('ec') || 'event'}:${query.get('ea') || ''}`,
        params: { category: query.get('ec'), action: query.get('ea'), label: query.get('el') || undefined, value: query.get('ev') || undefined },
      });
    } else {
      events.push({ event: t === 'pageview' ? 'page_view' : t, params: { page: query.get('dp') || page } });
    }
  }

  // A POST body batches more events as newline-separated query strings.
  if (typeof bodyText === 'string' && bodyText.includes('en=')) {
    for (const line of bodyText.split('\n')) {
      if (!line.includes('en=')) continue;
      const p = new URLSearchParams(line.trim());
      if (p.get('en')) events.push({ event: p.get('en'), params: ga4Params(p) });
    }
  }
  if (!events.length) events.push({ event: 'beacon', params: page ? { page } : {} });
  return events;
}

function segmentEvent(msg) {
  const type = msg?.type || 'track';
  return {
    event: type === 'track' ? (msg.event || 'track') : type,
    params: msg.properties || msg.traits || {},
  };
}

function decodeSegment({ host, path, bodyJson }) {
  if (!/segment\.(io|com)$/.test(registrableDomain(host))) return null;
  if (!/\/v1\/(t|track|p|page|i|identify|s|screen|batch|b)$/.test(path.split('?')[0])) return null;
  if (!bodyJson) return null;
  const batch = Array.isArray(bodyJson.batch) ? bodyJson.batch : [bodyJson];
  return batch.map(segmentEvent);
}

function decodeMixpanel({ host, query, bodyText, bodyJson }) {
  if (!host.includes('mixpanel.com')) return null;
  let data = bodyJson;
  if (!data) {
    // data= lives in the query or a form-encoded body, base64-encoded JSON.
    let raw = query.get('data');
    if (!raw && typeof bodyText === 'string' && bodyText.includes('data=')) {
      raw = new URLSearchParams(bodyText).get('data');
    }
    data = tryBase64Json(raw) ?? tryJson(raw);
  }
  if (!data) return null;
  const items = Array.isArray(data) ? data : [data];
  return items
    .filter((it) => it && it.event)
    .map((it) => ({ event: it.event, params: it.properties || {} }));
}

function decodeAmplitude({ host, bodyJson }) {
  if (!host.includes('amplitude.com') || !bodyJson) return null;
  const items = Array.isArray(bodyJson.events) ? bodyJson.events : bodyJson.event_type ? [bodyJson] : [];
  return items.map((e) => ({ event: e.event_type || 'event', params: e.event_properties || {} }));
}

function decodeFacebook({ host, path, query }) {
  if (!host.includes('facebook.com') || !path.startsWith('/tr')) return null;
  const params = {};
  for (const [k, v] of query.entries()) {
    if (k.startsWith('cd[')) params[k.slice(3, -1)] = v;
  }
  return [{ event: query.get('ev') || 'PageView', params }];
}

function decodePosthog({ host, path, query, bodyText, bodyJson }) {
  if (!host.includes('posthog')) return null;
  if (!/^\/(e|capture|batch|i\/v0\/e)\/?/.test(path.split('?')[0])) return null;
  let data = bodyJson ?? tryBase64Json(query.get('data'));
  if (!data && typeof bodyText === 'string' && bodyText.startsWith('data=')) {
    data = tryBase64Json(new URLSearchParams(bodyText).get('data'));
  }
  if (!data) return null;
  const items = Array.isArray(data) ? data : Array.isArray(data.batch) ? data.batch : [data];
  return items
    .filter((it) => it && it.event)
    .map((it) => ({ event: it.event, params: it.properties || {} }));
}

function decodeTiktok({ host, bodyJson }) {
  if (!host.includes('analytics.tiktok.com') || !bodyJson) return null;
  const items = Array.isArray(bodyJson.batch) ? bodyJson.batch : [bodyJson];
  return items
    .filter((it) => it && (it.event || it.event_name))
    .map((it) => ({ event: it.event || it.event_name, params: it.properties || {} }));
}

// Anything else our filter classified as analytics: keep the payload so
// nothing silently disappears, without pretending we understand the schema.
function decodeGeneric({ host, path, query, bodyText, bodyJson }) {
  const params = queryToObject(query);
  if (bodyJson !== undefined) params.body = bodyJson;
  else if (typeof bodyText === 'string' && bodyText) {
    params.body = bodyText.length > MAX_GENERIC_BODY ? bodyText.slice(0, MAX_GENERIC_BODY) + '… [truncated]' : bodyText;
  }
  return [{ event: path.split('?')[0] || '/', params }];
}

const DECODERS = [
  ['ga4', decodeGoogle],
  ['segment', decodeSegment],
  ['mixpanel', decodeMixpanel],
  ['amplitude', decodeAmplitude],
  ['facebook', decodeFacebook],
  ['posthog', decodePosthog],
  ['tiktok', decodeTiktok],
];

/**
 * @param {Array} records raw records from CdpRecorder
 * @param {object} opts { redact }
 * @returns Array of { index, at, offsetMs, provider, event, params, url, host, tab }
 *          in capture (firing) order.
 */
export function decodeEvents(records, { redact = true } = {}) {
  let t0 = Infinity;
  for (const rec of records) {
    if (rec.wallTime != null && rec.wallTime < t0) t0 = rec.wallTime;
  }

  const events = [];
  for (const rec of records) {
    if (!rec.url) continue;
    if (classify(rec).category !== 'analytics') continue;

    let u;
    try { u = new URL(rec.url); } catch { continue; }
    const ctx = {
      host: u.hostname,
      path: u.pathname,
      query: u.searchParams,
      bodyText: typeof rec.requestBody === 'string' ? rec.requestBody : undefined,
      bodyJson: tryJson(rec.requestBody),
    };

    let provider = null;
    let decoded = null;
    for (const [name, fn] of DECODERS) {
      decoded = fn(ctx);
      if (decoded) { provider = name; break; }
    }
    if (!decoded || !decoded.length) {
      provider = registrableDomain(u.hostname);
      decoded = decodeGeneric(ctx);
    }

    for (const ev of decoded) {
      events.push({
        index: rec.index,
        at: rec.wallTime ? new Date(rec.wallTime * 1000).toISOString() : undefined,
        offsetMs: rec.wallTime != null && t0 !== Infinity ? Math.max(0, Math.round((rec.wallTime - t0) * 1000)) : undefined,
        provider,
        event: ev.event,
        params: redact ? redactJson(ev.params) : ev.params,
        url: rec.url,
        host: u.hostname,
        tab: rec.tab,
      });
    }
  }

  events.sort((a, b) => a.index - b.index);
  return events;
}

// { ga4: 9, segment: 5 } — used in stats and doc headers.
export function countByProvider(events) {
  const out = {};
  for (const e of events) out[e.provider] = (out[e.provider] || 0) + 1;
  return out;
}
