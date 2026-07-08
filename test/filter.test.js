import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, registrableDomain } from '../src/filter.js';

test('keeps XHR/Fetch as api', () => {
  assert.equal(classify({ resourceType: 'Fetch', url: 'https://api.x.com/v1/items' }).keep, true);
  assert.equal(classify({ resourceType: 'XHR', url: 'https://x.com/data' }).category, 'api');
});

test('drops static assets and images', () => {
  assert.equal(classify({ resourceType: 'Image', url: 'https://x.com/a.png' }).keep, false);
  assert.equal(classify({ resourceType: 'Other', url: 'https://x.com/app.css?v=1' }).keep, false);
});

test('drops analytics hosts and first-party beacons', () => {
  assert.equal(classify({ resourceType: 'Fetch', url: 'https://www.google-analytics.com/g/collect?v=2' }).keep, false);
  assert.equal(classify({ resourceType: 'Fetch', url: 'https://myapp.com/cdn-cgi/rum?x=1' }).keep, false);
});

test('keeps documents, websockets, and api-looking Other requests', () => {
  assert.equal(classify({ resourceType: 'Document', url: 'https://x.com/' }).category, 'document');
  assert.equal(classify({ resourceType: 'WebSocket', url: 'wss://x.com/ws' }).category, 'websocket');
  assert.equal(classify({ resourceType: 'Other', url: 'https://x.com/graphql' }).keep, true);
});

test('drops data:/blob: urls', () => {
  assert.equal(classify({ resourceType: 'Fetch', url: 'data:text/plain,hi' }).keep, false);
});

test('registrableDomain collapses subdomains, keeps two-part TLDs', () => {
  assert.equal(registrableDomain('app.foo.com'), 'foo.com');
  assert.equal(registrableDomain('foo.com'), 'foo.com');
  assert.equal(registrableDomain('www.shop.foo.co.uk'), 'foo.co.uk');
});

test('flags calls outside the session scope as firstParty=false', () => {
  const sites = new Set(['myapp.com']);
  const own = classify({ resourceType: 'Fetch', url: 'https://api.myapp.com/v1/user' }, { sessionSites: sites });
  assert.equal(own.keep, true);
  assert.equal(own.firstParty, true);
  const widget = classify({ resourceType: 'Fetch', url: 'https://widget.chatvendor.com/api/session' }, { sessionSites: sites });
  assert.equal(widget.keep, true); // kept, but separated
  assert.equal(widget.firstParty, false);
});

test('without scope context everything counts as first-party', () => {
  assert.equal(classify({ resourceType: 'Fetch', url: 'https://x.com/data' }).firstParty, true);
});

test('drops first-party telemetry paths but keeps real event-ish APIs', () => {
  assert.equal(classify({ resourceType: 'Fetch', url: 'https://myapp.com/csp-report' }).keep, false);
  assert.equal(classify({ resourceType: 'Fetch', url: 'https://myapp.com/api/12345/envelope/?sentry_key=x' }).keep, false);
  assert.equal(classify({ resourceType: 'Fetch', url: 'https://myapp.com/api/telemetry?x=1' }).keep, false);
  assert.equal(classify({ resourceType: 'Fetch', url: 'https://myapp.com/beacon' }).keep, false);
  // Conservative: an app's real /api/events endpoint must survive.
  assert.equal(classify({ resourceType: 'Fetch', url: 'https://myapp.com/api/events?page=1' }).keep, true);
  assert.equal(classify({ resourceType: 'XHR', url: 'https://myapp.com/api/rums' }).keep, true);
});
