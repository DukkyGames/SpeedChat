/**
 * Derive Anthropic Messages path from chat completions path.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deriveMessagesPathFromChat, deriveResponsesPathFromChat } from '../../src/lib/derive-messages-path.mjs';

describe('deriveMessagesPathFromChat', () => {
  test('maps standard OpenAI chat path to messages path', () => {
    assert.equal(
      deriveMessagesPathFromChat('/v1/chat/completions'),
      '/v1/messages',
    );
  });

  test('maps OpenCode Zen chat path to messages path', () => {
    assert.equal(
      deriveMessagesPathFromChat('/zen/v1/chat/completions'),
      '/zen/v1/messages',
    );
  });

  test('leaves messages paths unchanged', () => {
    assert.equal(deriveMessagesPathFromChat('/zen/v1/messages'), '/zen/v1/messages');
    assert.equal(deriveMessagesPathFromChat('/v1/messages'), '/v1/messages');
  });
});

describe('deriveResponsesPathFromChat', () => {
  test('maps standard OpenAI chat path to responses path', () => {
    assert.equal(
      deriveResponsesPathFromChat('/v1/chat/completions'),
      '/v1/responses',
    );
  });

  test('maps OpenCode Go chat path to responses path', () => {
    assert.equal(
      deriveResponsesPathFromChat('/zen/go/v1/chat/completions'),
      '/zen/go/v1/responses',
    );
  });

  test('leaves responses paths unchanged', () => {
    assert.equal(deriveResponsesPathFromChat('/zen/go/v1/responses'), '/zen/go/v1/responses');
    assert.equal(deriveResponsesPathFromChat('/v1/responses'), '/v1/responses');
  });
});
