import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatIssueAge } from '../../src/issues/age.ts';

test('creation age uses compact singular/plural units and handles clock skew', () => {
  const now = Date.UTC(2026, 8, 9);
  const day = 86_400_000;
  for (const [elapsed, expected] of [
    [0, 'just now'], [60_000, '1min'], [3_600_000, '1hr'],
    [day, '1 day'], [3 * day, '3 days'], [7 * day, '1 week'],
    [14 * day, '2 weeks'], [30 * day, '1 month'], [60 * day, '2 months'],
    [365 * day, '1 year'],
  ] as const) assert.equal(formatIssueAge(now - elapsed, now), expected);
  assert.equal(formatIssueAge(now + day, now), 'just now');
  assert.equal(formatIssueAge(NaN, now), '');
});
