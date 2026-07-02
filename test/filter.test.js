import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/filter.js';

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
