import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactHeaders, redactQuery, redactJson, redactBody } from '../src/redact.js';

test('redactHeaders hides auth headers, keeps the rest', () => {
  const out = redactHeaders({
    Authorization: 'Bearer abc123',
    Cookie: 'session=xyz',
    'Content-Type': 'application/json',
    'X-API-Key': 'k',
  });
  assert.equal(out.Authorization, '[redacted]');
  assert.equal(out.Cookie, '[redacted]');
  assert.equal(out['X-API-Key'], '[redacted]');
  assert.equal(out['Content-Type'], 'application/json');
});

test('redactHeaders passes through when redact=false', () => {
  const out = redactHeaders({ Authorization: 'Bearer abc' }, false);
  assert.equal(out.Authorization, 'Bearer abc');
});

test('redactQuery hides token-ish params, keeps normal ones', () => {
  const out = redactQuery({ token: 't', api_key: 'k', page: '2', q: 'shoes' });
  assert.equal(out.token, '[redacted]');
  assert.equal(out.api_key, '[redacted]');
  assert.equal(out.page, '2');
  assert.equal(out.q, 'shoes');
});

test('redactJson hides passwords and tokens deep in the body', () => {
  const out = redactJson({
    user: { email: 'a@b.com', password: 'hunter2' },
    data: [{ access_token: 'jwt', refreshToken: 'r' }],
    count: 3,
  });
  assert.equal(out.user.password, '[redacted]');
  assert.equal(out.user.email, 'a@b.com'); // emails stay: useful, not a secret
  assert.equal(out.data[0].access_token, '[redacted]');
  assert.equal(out.data[0].refreshToken, '[redacted]');
  assert.equal(out.count, 3);
});

test('redactBody handles form-encoded strings', () => {
  const out = redactBody('username=alice&password=hunter2&remember=1');
  assert.match(out, /username=alice/);
  assert.match(out, /password=%5Bredacted%5D/);
  assert.match(out, /remember=1/);
});

test('redactBody leaves non-secret strings untouched', () => {
  assert.equal(redactBody('plain text body'), 'plain text body');
  assert.equal(redactBody(null), null);
});

test('redactBody passes through when redact=false', () => {
  const body = { password: 'x' };
  assert.deepEqual(redactBody(body, false), { password: 'x' });
});
