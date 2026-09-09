import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  collectAttemptFacts,
  formatAttemptFacts,
  humanizeAbandonReason,
  summaryScent,
  writeUpNeedsCollapse,
} from '../../src/orchestrator/attempt-scan.ts';

describe('summaryScent', () => {
  it('returns short prose unchanged', () => {
    assert.equal(summaryScent('Implemented the fix'), 'Implemented the fix');
  });

  it('keeps the first sentence when the rest is a wall', () => {
    const wall =
      'W3-B complete. Build: created live-events and then wrote a very long paragraph about middleware UNIQUE_BURIED_TOKEN after many files.';
    assert.equal(summaryScent(wall), 'W3-B complete.');
    assert.equal(writeUpNeedsCollapse(wall), true);
  });

  it('truncates a long sentence at a word boundary', () => {
    const words = Array.from({ length: 40 }, () => 'middleware').join(' ');
    const scent = summaryScent(words);
    assert.ok(scent.endsWith('…'));
    assert.ok(scent.length <= 141);
    assert.equal(scent.includes('  '), false);
  });
});

describe('humanizeAbandonReason', () => {
  it('uses a concrete line for known policy reasons', () => {
    assert.equal(humanizeAbandonReason('builder-no-report'), 'The builder did not file a report.');
    assert.equal(
      humanizeAbandonReason('user'),
      'Stopped by you. Review the attempts before restarting this task.',
    );
  });

  it('sentence-cases unknown kebab reasons', () => {
    assert.equal(humanizeAbandonReason('custom-policy-stop'), 'Custom policy stop.');
  });
});

describe('collectAttemptFacts', () => {
  it('reads files, blockers, needs, and test output from journal keys only', () => {
    const facts = collectAttemptFacts({
      blockers: ['psql refused'],
      needs: ['DATABASE_URL'],
      testOutput: 'connection refused',
      diff: { files: ['src/a.ts', 'src/b.ts'], patch: 'diff', originalLength: 51651 },
    });
    assert.deepEqual(facts.files, ['src/a.ts', 'src/b.ts']);
    assert.deepEqual(facts.blockers, ['psql refused']);
    assert.deepEqual(facts.needs, ['DATABASE_URL']);
    assert.equal(facts.hasTestOutput, true);
    assert.deepEqual(formatAttemptFacts(facts), ['2 files', '1 blocker', '1 requirement', 'Test output']);
  });

  it('does not invent facts from prose', () => {
    const facts = collectAttemptFacts({ note: 'created src/foo.ts and 15 tests passed' });
    assert.deepEqual(facts, { files: [], blockers: [], needs: [], hasTestOutput: false });
  });
});
