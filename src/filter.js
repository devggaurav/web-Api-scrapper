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
];

/**
 * Decide whether a request is "API-relevant".
 * Returns { keep: boolean, reason: string, category: string }.
 */
export function classify(req) {
  const type = req.resourceType || '';
  const url = req.url || '';
  let host = '';
  let path = url;
  try {
    const u = new URL(url);
    host = u.hostname;
    path = u.pathname + u.search;
  } catch {
    // non-URL (data:, blob:) — always noise for our purposes
    return { keep: false, reason: 'non-http scheme', category: 'other' };
  }

  if (url.startsWith('data:') || url.startsWith('blob:')) {
    return { keep: false, reason: 'inline resource', category: 'other' };
  }
  if (ANALYTICS_HOSTS.some((h) => host.includes(h.split('/')[0]) && url.includes(h))) {
    return { keep: false, reason: 'analytics/telemetry', category: 'analytics' };
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
    return { keep: true, reason: 'xhr/fetch', category: 'api' };
  }
  if (type === 'WebSocket') return { keep: true, reason: 'websocket', category: 'websocket' };
  if (type === 'EventSource') return { keep: true, reason: 'server-sent events', category: 'sse' };
  if (type === 'Document') return { keep: true, reason: 'navigation', category: 'document' };

  // GraphQL / JSON endpoints sometimes come through as "Other".
  if (/graphql|\/api\/|\/v\d+\//i.test(path)) {
    return { keep: true, reason: 'looks like an api path', category: 'api' };
  }
  return { keep: false, reason: `type ${type || 'unknown'}`, category: 'other' };
}
