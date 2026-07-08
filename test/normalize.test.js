import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/normalize.js';

const loginRecord = {
  index: 0,
  method: 'POST',
  url: 'https://api.x.com/login?next=%2Fhome',
  resourceType: 'Fetch',
  status: 200,
  requestHeaders: { Authorization: 'Bearer abc', 'Content-Type': 'application/json' },
  responseHeaders: { 'set-cookie': 'sid=1' },
  requestBody: JSON.stringify({ email: 'a@b.com', password: 'hunter2' }),
  responseBody: JSON.stringify({ ok: true, access_token: 'jwt-secret' }),
  wallTime: 1700000000.5,
  durationMs: 123.4,
  tab: 0,
};

test('redacts secrets in headers, bodies, and keeps structure', () => {
  const { flow } = normalize([loginRecord]);
  const e = flow[0];
  assert.equal(e.requestHeaders.Authorization, '[redacted]');
  assert.equal(e.responseHeaders['set-cookie'], '[redacted]');
  assert.equal(e.requestBody.password, '[redacted]');
  assert.equal(e.requestBody.email, 'a@b.com');
  assert.equal(e.responseBody.access_token, '[redacted]');
  assert.equal(e.responseBody.ok, true);
  assert.equal(e.requestBodyIsJson, true);
});

test('redact=false leaves everything intact', () => {
  const { flow } = normalize([loginRecord], { redact: false });
  const e = flow[0];
  assert.equal(e.requestHeaders.Authorization, 'Bearer abc');
  assert.equal(e.requestBody.password, 'hunter2');
  assert.equal(e.responseBody.access_token, 'jwt-secret');
});

test('carries per-request startedAt from wallTime and rounds duration', () => {
  const { flow } = normalize([loginRecord]);
  assert.equal(flow[0].startedAt, new Date(1700000000.5 * 1000).toISOString());
  assert.equal(flow[0].durationMs, 123);
});

test('filters noise into dropped, counts stats', () => {
  const records = [
    loginRecord,
    { index: 1, method: 'GET', url: 'https://x.com/logo.png', resourceType: 'Image' },
  ];
  const { flow, dropped, stats } = normalize(records);
  assert.equal(flow.length, 1);
  assert.equal(dropped.length, 1);
  assert.equal(stats.kept, 1);
  assert.equal(stats.byHost['api.x.com'], 1);
});

test('includeNoise keeps filtered entries with a reason', () => {
  const records = [{ index: 0, method: 'GET', url: 'https://x.com/logo.png', resourceType: 'Image' }];
  const { flow } = normalize(records, { includeNoise: true });
  assert.equal(flow.length, 1);
  assert.ok(flow[0].filteredReason);
});

test('auto-detects session sites from Document navigations and flags third-party calls', () => {
  const records = [
    { index: 0, method: 'GET', url: 'https://app.myapp.com/checkout', resourceType: 'Document' },
    { index: 1, method: 'POST', url: 'https://api.myapp.com/v1/cart', resourceType: 'Fetch', status: 200 },
    { index: 2, method: 'POST', url: 'https://widget.chatvendor.com/api/session', resourceType: 'Fetch', status: 200 },
  ];
  const { flow, stats } = normalize(records);
  assert.deepEqual(stats.sessionSites, ['myapp.com']);
  assert.equal(flow.find((e) => e.host === 'api.myapp.com').thirdParty, undefined);
  assert.equal(flow.find((e) => e.host === 'widget.chatvendor.com').thirdParty, true);
  assert.equal(stats.thirdParty, 1);
});

test('scopeHosts overrides auto-detection', () => {
  const records = [
    { index: 0, method: 'GET', url: 'https://app.myapp.com/home', resourceType: 'Document' },
    { index: 1, method: 'GET', url: 'https://api.otherco.io/v1/data', resourceType: 'Fetch', status: 200 },
  ];
  const { flow } = normalize(records, { scopeHosts: ['otherco.io'] });
  assert.equal(flow.find((e) => e.host === 'api.otherco.io').thirdParty, undefined);
});

test('tags repeated polling calls with repeatKey/repeatCount', () => {
  const poll = (i) => ({ index: i, method: 'GET', url: `https://api.x.com/v1/status?t=${i}`, resourceType: 'Fetch', status: 200 });
  const records = [poll(0), poll(1), poll(2), { index: 3, method: 'POST', url: 'https://api.x.com/v1/order', resourceType: 'Fetch', status: 201 }];
  const { flow } = normalize(records);
  const polls = flow.filter((e) => e.path === '/v1/status');
  assert.equal(polls.length, 3);
  for (const p of polls) assert.equal(p.repeatCount, 3);
  assert.equal(flow.find((e) => e.path === '/v1/order').repeatCount, undefined);
});
