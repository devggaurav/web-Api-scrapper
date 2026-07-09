import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEvents, countByProvider } from '../src/analyticsEvents.js';

const W = 1700000000; // base wallTime

function rec(index, url, extra = {}) {
  return { index, url, resourceType: 'Fetch', wallTime: W + index, ...extra };
}

test('decodes a GA4 query-string event with ep/epn params', () => {
  const events = decodeEvents([
    rec(0, 'https://www.google-analytics.com/g/collect?v=2&tid=G-XYZ&en=add_to_cart&ep.currency=USD&epn.value=42&dl=https%3A%2F%2Fshop.com%2Fcart'),
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].provider, 'ga4');
  assert.equal(events[0].event, 'add_to_cart');
  assert.equal(events[0].params.currency, 'USD');
  assert.equal(events[0].params.value, 42);
});

test('decodes batched GA4 events from a POST body', () => {
  const events = decodeEvents([
    rec(0, 'https://region1.google-analytics.com/g/collect?v=2&tid=G-XYZ&en=page_view', {
      requestBody: 'en=scroll&epn.percent_scrolled=90\nen=purchase&ep.currency=USD&epn.value=99.5',
    }),
  ]);
  assert.deepEqual(events.map((e) => e.event), ['page_view', 'scroll', 'purchase']);
  assert.equal(events[2].params.value, 99.5);
});

test('decodes a Universal Analytics event hit', () => {
  const events = decodeEvents([
    rec(0, 'https://www.google-analytics.com/collect?v=1&tid=UA-1234-5&t=event&ec=video&ea=play&el=intro&ev=10'),
  ]);
  assert.equal(events[0].event, 'video:play');
  assert.equal(events[0].params.label, 'intro');
});

test('decodes Segment single and batch calls', () => {
  const events = decodeEvents([
    rec(0, 'https://api.segment.io/v1/t', {
      requestBody: JSON.stringify({ type: 'track', event: 'Order Completed', properties: { total: 42 } }),
    }),
    rec(1, 'https://api.segment.io/v1/batch', {
      requestBody: JSON.stringify({ batch: [
        { type: 'identify', traits: { plan: 'pro' } },
        { type: 'track', event: 'Checkout Started', properties: {} },
      ] }),
    }),
  ]);
  assert.deepEqual(events.map((e) => e.event), ['Order Completed', 'identify', 'Checkout Started']);
  assert.equal(events[0].provider, 'segment');
  assert.equal(events[0].params.total, 42);
  assert.equal(events[1].params.plan, 'pro');
});

test('decodes Mixpanel base64 data param', () => {
  const payload = Buffer.from(JSON.stringify([{ event: 'Signup', properties: { plan: 'free' } }])).toString('base64');
  const events = decodeEvents([
    rec(0, `https://api.mixpanel.com/track?data=${encodeURIComponent(payload)}`),
  ]);
  assert.equal(events[0].provider, 'mixpanel');
  assert.equal(events[0].event, 'Signup');
  assert.equal(events[0].params.plan, 'free');
});

test('decodes Amplitude events array', () => {
  const events = decodeEvents([
    rec(0, 'https://api2.amplitude.com/2/httpapi', {
      requestBody: JSON.stringify({ api_key: 'k', events: [
        { event_type: 'button_click', event_properties: { id: 'buy' } },
        { event_type: 'page_view', event_properties: {} },
      ] }),
    }),
  ]);
  assert.deepEqual(events.map((e) => e.event), ['button_click', 'page_view']);
  assert.equal(events[0].provider, 'amplitude');
});

test('decodes Facebook Pixel and PostHog', () => {
  const phData = Buffer.from(JSON.stringify({ event: '$pageview', properties: { path: '/' } })).toString('base64');
  const events = decodeEvents([
    rec(0, 'https://www.facebook.com/tr?id=123&ev=Purchase&cd[currency]=USD&cd[value]=30'),
    rec(1, `https://eu.i.posthog.com/e/?data=${encodeURIComponent(phData)}`),
  ]);
  assert.equal(events[0].provider, 'facebook');
  assert.equal(events[0].event, 'Purchase');
  assert.equal(events[0].params.currency, 'USD');
  assert.equal(events[1].provider, 'posthog');
  assert.equal(events[1].event, '$pageview');
});

test('unknown analytics hosts fall back to a generic decode', () => {
  const events = decodeEvents([
    rec(0, 'https://heapanalytics.com/api/track?a=1', { requestBody: JSON.stringify({ foo: 'bar' }) }),
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].provider, 'heapanalytics.com');
  assert.equal(events[0].event, '/api/track');
  assert.deepEqual(events[0].params.body, { foo: 'bar' });
});

test('non-analytics requests produce no events', () => {
  const events = decodeEvents([
    rec(0, 'https://api.myapp.com/v1/cart'),
    rec(1, 'https://myapp.com/app.css', { resourceType: 'Stylesheet' }),
  ]);
  assert.equal(events.length, 0);
});

test('events are chronological with timestamps and offsets', () => {
  const events = decodeEvents([
    rec(2, 'https://www.google-analytics.com/g/collect?v=2&en=late'),
    rec(0, 'https://api.myapp.com/v1/cart'), // sets t0, not an event
    rec(1, 'https://www.google-analytics.com/g/collect?v=2&en=early'),
  ]);
  assert.deepEqual(events.map((e) => e.event), ['early', 'late']);
  assert.equal(events[0].offsetMs, 1000);
  assert.equal(events[1].offsetMs, 2000);
  assert.equal(events[0].at, new Date((W + 1) * 1000).toISOString());
});

test('redacts sensitive params by default, keeps them with redact=false', () => {
  const records = [
    rec(0, 'https://api.segment.io/v1/t', {
      requestBody: JSON.stringify({ type: 'track', event: 'Login', properties: { token: 'secret-jwt', plan: 'pro' } }),
    }),
  ];
  const [redacted] = decodeEvents(records);
  assert.equal(redacted.params.token, '[redacted]');
  assert.equal(redacted.params.plan, 'pro');
  const [raw] = decodeEvents(records, { redact: false });
  assert.equal(raw.params.token, 'secret-jwt');
});

test('countByProvider aggregates', () => {
  const events = decodeEvents([
    rec(0, 'https://www.google-analytics.com/g/collect?v=2&en=a'),
    rec(1, 'https://www.google-analytics.com/g/collect?v=2&en=b'),
    rec(2, 'https://api.segment.io/v1/t', { requestBody: JSON.stringify({ type: 'track', event: 'c' }) }),
  ]);
  assert.deepEqual(countByProvider(events), { ga4: 2, segment: 1 });
});
