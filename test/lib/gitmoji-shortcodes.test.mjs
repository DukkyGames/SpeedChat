import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { expandGitmojiShortcodes } from '../../src/lib/gitmoji-shortcodes.mjs';

describe('expandGitmojiShortcodes', () => {
  test('turns :sparkles: into the sparkles glyph', () => {
    assert.equal(
      expandGitmojiShortcodes(':sparkles: Make skills generators'),
      '✨ Make skills generators',
    );
  });

  test('expands several official codes in one subject', () => {
    assert.equal(
      expandGitmojiShortcodes(':bug: fix(ci): flake\n\n:memo: note'),
      '🐛 fix(ci): flake\n\n📝 note',
    );
  });

  test('leaves unknown colon tokens unchanged', () => {
    assert.equal(expandGitmojiShortcodes('see :not_a_gitmoji: here'), 'see :not_a_gitmoji: here');
  });

  test('leaves Unicode gitmoji unchanged', () => {
    assert.equal(expandGitmojiShortcodes('✨ feat(ui): already a glyph'), '✨ feat(ui): already a glyph');
  });

  test('expands hyphenated official codes', () => {
    assert.equal(expandGitmojiShortcodes(':t-rex: keep old API'), '🦖 keep old API');
  });

  test('returns empty string for non-strings', () => {
    assert.equal(expandGitmojiShortcodes(/** @type {any} */ (null)), '');
  });
});
