// Classifies captured requests so we can keep the meaningful API traffic and
// drop the noise (static assets, fonts, analytics/telemetry beacons).

const STATIC_EXT = /\.(css|scss|less|js|mjs|cjs|map|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|ogg|pdf)(\?|$)/i;

// Resource types (from CDP Network.ResourceType) that are almost never "the API".
const NOISE_TYPES = new Set([
  'Image', 'Font', 'Stylesheet', 'Media', 'Manifest', 'TextTrack',
  'CSPViolationReport', 'Ping', 'Prefetch',
]);

// Third-party analytics / telemetry / ad hosts. Substring match on hostname.
const ANALYTICS_HOSTS = [
  'google-analytics.com', 'googletagmanager.com', 'analytics.google.com',
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'facebook.com/tr', 'connect.facebook.net', 'segment.io', 'segment.com',
  'mixpanel.com', 'amplitude.com', 'hotjar.com', 'fullstory.com',
  'sentry.io', 'bugsnag.com', 'datadoghq.com', 'newrelic.com', 'nr-data.net',
  'intercom.io', 'clarity.ms', 'optimizely.com', 'launchdarkly.com',
  'cloudflareinsights.com', 'doubleverify.com', 'branch.io', 'appsflyer.com',
  'posthog.com', 'i.posthog.com', 'heapanalytics.com', 'mouseflow.com',
  'quantserve.com', 'scorecardresearch.com', 'snowplowanalytics.com',
  'stats.g.doubleclick.net', 'analytics.tiktok.com', 'bat.bing.com',
];

// Analytics/telemetry that hits a FIRST-PARTY host (so host matching misses it):
// e.g. Google Analytics' /g/collect, Cloudflare RUM's /cdn-cgi/rum. Matched on path.
// Deliberately conservative — an app's real API named /events must NOT vanish;
// anything dropped is still listed in `dropped` with its reason.
const ANALYTICS_PATH_RE = /\/cdn-cgi\/(rum|beacon)|\/g\/collect|\/j\/collect|\/mp\/collect|\/gtag\/|\/gtm\.js|\/piwik\.php|\/matomo\.php|\/b\/ss\/|\/csp-report(\/|\?|$)|\/api\/\d+\/envelope(\/|\?|$)|\/api\/(analytics|telemetry|rum)(\/|\?|$)|\/beacon(\/|\?|$)|\/intake\/v2\/rum(\/|\?|$)/i;

// Two-part public suffixes we're likely to meet; enough for a registrable-domain
// heuristic without pulling in the full public-suffix list.
const TWO_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au',
  'co.nz', 'co.in', 'co.jp', 'ne.jp', 'or.jp', 'com.br', 'com.mx',
  'com.sg', 'com.hk', 'co.za', 'com.ar', 'com.tr', 'co.kr', 'com.cn',
]);

// "app.foo.co.uk" -> "foo.co.uk", "api.foo.com" -> "foo.com".
// IP literals (and IPv6 like "[::1]") are returned whole — no subdomains there.
export function registrableDomain(host) {
  const h = String(host || '').toLowerCase();
  if (h.startsWith('[') || /^[\d.]+$/.test(h)) return h;
  const parts = h.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const take = TWO_PART_TLDS.has(parts.slice(-2).join('.')) ? 3 : 2;
  return parts.slice(-take).join('.');
}

// Google Analytics / Measurement Protocol requests carry a tid=G-/UA-/GT- id.
function looksLikeGoogleAnalytics(query) {
  const tid = query?.get?.('tid');
  return typeof tid === 'string' && /^(G-|UA-|GT-|AW-|DC-)/.test(tid);
}

/**
 * Decide whether a request is "API-relevant".
 * @param {object} req raw record ({ resourceType, url })
 * @param {object} ctx optional { sessionSites: Set<registrable domain> } — the
 *   sites the user actually visited; kept calls to other hosts are flagged
 *   firstParty: false so exporters can separate them.
 * Returns { keep: boolean, reason: string, category: string, firstParty?: boolean }.
 */
export function classify(req, ctx = {}) {
  const type = req.resourceType || '';
  const url = req.url || '';
  let host = '';
  let path = url;
  let query = null;
  try {
    const u = new URL(url);
    host = u.hostname;
    path = u.pathname + u.search;
    query = u.searchParams;
  } catch {
    // non-URL (data:, blob:) — always noise for our purposes
    return { keep: false, reason: 'non-http scheme', category: 'other' };
  }
  const firstParty = ctx.sessionSites?.size
    ? ctx.sessionSites.has(registrableDomain(host))
    : true;

  if (url.startsWith('data:') || url.startsWith('blob:')) {
    return { keep: false, reason: 'inline resource', category: 'other' };
  }
  if (ANALYTICS_HOSTS.some((h) => host.includes(h.split('/')[0]) && url.includes(h))) {
    return { keep: false, reason: 'analytics/telemetry host', category: 'analytics' };
  }
  if (ANALYTICS_PATH_RE.test(path)) {
    return { keep: false, reason: 'analytics/telemetry endpoint', category: 'analytics' };
  }
  if (looksLikeGoogleAnalytics(query)) {
    return { keep: false, reason: 'google analytics beacon', category: 'analytics' };
  }
  if (NOISE_TYPES.has(type)) {
    return { keep: false, reason: `resource type ${type}`, category: 'asset' };
  }
  if (STATIC_EXT.test(path) && type !== 'XHR' && type !== 'Fetch') {
    return { keep: false, reason: 'static asset extension', category: 'asset' };
  }

  // Keep XHR/Fetch (the classic API calls), WebSockets, EventSource, and the
  // top-level document navigation (useful context for where a flow starts).
  if (type === 'XHR' || type === 'Fetch') {
    return { keep: true, reason: 'xhr/fetch', category: 'api', firstParty };
  }
  if (type === 'WebSocket') return { keep: true, reason: 'websocket', category: 'websocket', firstParty };
  if (type === 'EventSource') return { keep: true, reason: 'server-sent events', category: 'sse', firstParty };
  if (type === 'Document') return { keep: true, reason: 'navigation', category: 'document', firstParty };

  // GraphQL / JSON endpoints sometimes come through as "Other".
  if (/graphql|\/api\/|\/v\d+\//i.test(path)) {
    return { keep: true, reason: 'looks like an api path', category: 'api', firstParty };
  }
  return { keep: false, reason: `type ${type || 'unknown'}`, category: 'other' };
}
