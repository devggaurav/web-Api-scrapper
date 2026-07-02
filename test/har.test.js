import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHar } from '../src/exporters/har.js';

const entryA = {
  method: 'GET',
  url: 'https://api.x.com/a',
  status: 200,
  startedAt: '2026-07-02T10:00:00.000Z',
  durationMs: 50,
  requestHeaders: { Accept: 'application/json' },
  responseHeaders: { 'content-type': 'application/json' },
  responseBody: { ok: true },
};
const entryB = {
  method: 'POST',
  url: 'https://api.x.com/b',
  status: 201,
  startedAt: '2026-07-02T10:00:05.000Z',
  durationMs: 80,
  requestBody: { name: 'x' },
};

test('uses per-request startedDateTime, not the session start', () => {
  const har = toHar([entryA, entryB], { startedAt: '2026-07-02T09:59:00.000Z' });
  assert.equal(har.log.entries[0].startedDateTime, '2026-07-02T10:00:00.000Z');
  assert.equal(har.log.entries[1].startedDateTime, '2026-07-02T10:00:05.000Z');
});

test('serializes bodies and skips websockets', () => {
  const har = toHar([entryA, entryB, { method: 'WS', url: 'wss://x.com/ws' }]);
  assert.equal(har.log.entries.length, 2);
  assert.equal(har.log.entries[0].response.content.text, '{"ok":true}');
  assert.equal(har.log.entries[1].request.postData.text, '{"name":"x"}');
});

test('is valid HAR 1.2 shape', () => {
  const har = toHar([entryA]);
  assert.equal(har.log.version, '1.2');
  assert.ok(har.log.creator.name);
  assert.ok(Array.isArray(har.log.entries));
});
