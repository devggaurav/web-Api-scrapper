import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { uniqueBase } from '../src/session.js';

const STARTED = '2026-07-08T14:30:52.123Z';

test('custom names get the recording start timestamp appended', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bft-'));
  try {
    assert.equal(uniqueBase(dir, 'checkout', STARTED), 'checkout-20260708-143052');
    assert.equal(uniqueBase(dir, undefined, STARTED), 'flow-20260708-143052');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collisions get a -2/-3 suffix instead of overwriting', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bft-'));
  try {
    writeFileSync(join(dir, 'checkout-20260708-143052.flow.json'), '{}');
    assert.equal(uniqueBase(dir, 'checkout', STARTED), 'checkout-20260708-143052-2');
    writeFileSync(join(dir, 'checkout-20260708-143052-2.flow.json'), '{}');
    assert.equal(uniqueBase(dir, 'checkout', STARTED), 'checkout-20260708-143052-3');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
