/**
 * Composer expand model binding — per-chat composer vs routing override.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { computeEffectivePromptExpanderBinding } from '../../src/settings/model-routing-effective.ts';
import { resolveExpandPromptBindingFromChat, resolveIssueExpandPromptBindingFromDefault } from '../../src/ui/composer-expand-binding.ts';

const CHAT = { providerId: 'composer-prov', modelId: 'composer-model' };

describe('computeEffectivePromptExpanderBinding', () => {
  test('empty routing uses composer chat model', () => {
    const out = computeEffectivePromptExpanderBinding(
      { providerId: '', modelId: '' },
      { providerId: 'chat-prov', modelId: 'chat-model' },
    );
    assert.equal(out.modelId, 'chat-model');
    assert.equal(out.providerId, 'chat-prov');
    assert.equal(out.usesChatDefault, true);
  });

  test('routing override wins over chat', () => {
    const out = computeEffectivePromptExpanderBinding(
      { providerId: 'route-prov', modelId: 'route-model' },
      { providerId: 'chat-prov', modelId: 'chat-model' },
    );
    assert.equal(out.modelId, 'route-model');
    assert.equal(out.usesChatDefault, false);
  });
});

describe('resolveExpandPromptBindingFromChat', () => {
  test('uses chat model when routing is unset', () => {
    const binding = resolveExpandPromptBindingFromChat(
      { providerId: '', modelId: '' },
      CHAT,
      'fallback-prov',
    );
    assert.equal(binding.modelId, 'composer-model');
    assert.equal(binding.providerId, 'composer-prov');
  });

  test('uses routing override when pinned', () => {
    const binding = resolveExpandPromptBindingFromChat(
      { providerId: 'pinned-prov', modelId: 'pinned-model' },
      CHAT,
      'fallback-prov',
    );
    assert.equal(binding.modelId, 'pinned-model');
    assert.equal(binding.providerId, 'pinned-prov');
  });

  test('falls back to default provider when chat has model but no provider', () => {
    const binding = resolveExpandPromptBindingFromChat(
      { providerId: '', modelId: '' },
      { modelId: 'solo-model' },
      'fallback-prov',
    );
    assert.equal(binding.modelId, 'solo-model');
    assert.equal(binding.providerId, 'fallback-prov');
  });
});

describe('resolveIssueExpandPromptBindingFromDefault', () => {
  const DEFAULT_BINDING = { providerId: 'default-prov', modelId: 'default-model' };

  test('uses routing override when pinned', () => {
    const binding = resolveIssueExpandPromptBindingFromDefault(
      { providerId: 'pinned-prov', modelId: 'pinned-model' },
      DEFAULT_BINDING,
      'fallback-prov',
    );
    assert.equal(binding.modelId, 'pinned-model');
    assert.equal(binding.providerId, 'pinned-prov');
  });

  test('uses the top-bar default model when routing is unset', () => {
    const binding = resolveIssueExpandPromptBindingFromDefault(
      { providerId: '', modelId: '' },
      DEFAULT_BINDING,
      'fallback-prov',
    );
    assert.equal(binding.modelId, 'default-model');
    assert.equal(binding.providerId, 'default-prov');
  });

  test('falls back to default provider when the default binding has a model but no provider', () => {
    const binding = resolveIssueExpandPromptBindingFromDefault(
      { providerId: '', modelId: '' },
      { modelId: 'solo-model' },
      'fallback-prov',
    );
    assert.equal(binding.modelId, 'solo-model');
    assert.equal(binding.providerId, 'fallback-prov');
  });
});
