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
