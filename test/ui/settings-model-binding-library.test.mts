/**
 * Capability matrix roster must list My Models (`minnow-library`) alongside registry providers.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import { Window } from 'happy-dom';

import { setStorageModeForTests } from '../../src/config/storage-mode.ts';
import { LIBRARY_MODEL_PROVIDER_ID } from '../../src/models/model-select-library.ts';
import type { LibraryModel } from '../../src/models/library.ts';

const sampleLibraryModel = (): LibraryModel => ({
  id: 'gguf:qwen/qwen3:file.gguf',
  name: 'Qwen3-8B',
  repoId: 'qwen/qwen3',
  publisher: 'qwen',
  producerSlug: 'qwen',
  producerName: 'Qwen',
  producerLogoId: 'Qwen3-8B',
  format: 'GGUF',
  quant: 'Q4',
  arch: 'qwen',
  domain: 'chat',
  paramsB: 8,
  contextLength: 32768,
  capabilities: [],
  sizeBytes: 1000,
  path: '/tmp/file.gguf',
  fileName: 'file.gguf',
  source: 'hf-cache',
  servable: true,
  incomplete: false,
  isMoe: false,
});

mock.module('../../src/providers/store.ts', {
  namedExports: {
    listProviders: async () => ({
      providers: [
        {
          id: 'openai',
          label: 'OpenAI',
          baseUrl: 'https://api.openai.com',
          apiKind: 'openai-v1',
          enabled: true,
          hasApiKey: true,
          hasBearer: false,
        },
      ],
    }),
  },
});

mock.module('../../src/providers/fetch-all-models.ts', {
  namedExports: {
    fetchModelsForAllProviders: async () => [
      {
        provider: {
          id: 'openai',
          label: 'OpenAI',
          baseUrl: 'https://api.openai.com',
          apiKind: 'openai-v1',
          enabled: true,
          hasApiKey: true,
          hasBearer: false,
        },
        models: [{ id: 'gpt-4o', type: 'llm', state: 'loaded' }],
      },
    ],
  },
});

mock.module('../../src/models/model-select-library.ts', {
  namedExports: {
    LIBRARY_MODEL_PROVIDER_ID: 'minnow-library',
    LIBRARY_MODEL_OPTGROUP_LABEL: 'My Models',
    omitLocalRuntimeCatalogModels: (results: unknown[]) => results,
    fetchLibraryModelSelectMerge: async () => ({
      optgroupHtml: '',
      cacheEntries: [],
      library: [sampleLibraryModel()],
      serves: [],
    }),
    libraryModelLoadState: () => 'not loaded' as const,
    isLibraryModelProviderId: (id: string) => id === 'minnow-library',
    isLibraryModelBinding: () => false,
    isLocalRuntimeCatalogProviderId: (id: string | undefined) =>
      id === 'llama-cpp-local' || id === 'mlx-lm-local',
    resolveUpstreamProviderId: (providerId: string) => providerId,
    encodeLibraryModelSelectKey: () => '',
    decodeLibraryModelSelectKey: () => null,
    loadableLibraryFromCached: async () => [],
    resolveServedBindingForLibraryId: () => null,
    libraryModelNeedsLoad: () => true,
    libraryBindingNeedsServeLoad: () => true,
    resolveLibrarySendBinding: () => null,
    resolveLibraryModelIdForChatBinding: () => null,
    loadLibraryModelFromPicker: async () => {},
    unloadLibraryModelFromPicker: async () => {},
  },
});

describe('settings-model-binding library roster', () => {
  let previousWindow: typeof globalThis.window | undefined;

  beforeEach(() => {
    previousWindow = globalThis.window;
    const win = new Window();
    globalThis.window = win as unknown as Window & typeof globalThis;
    globalThis.document = win.document;
    setStorageModeForTests('server');
  });

  afterEach(() => {
    if (previousWindow) {
      globalThis.window = previousWindow;
      globalThis.document = previousWindow.document;
    }
    setStorageModeForTests(null);
  });

  test('fillProviderSelect can include the synthetic My Models provider', async () => {
    const { fillProviderSelect } = await import('../../src/ui/settings-model-binding.ts');
    const select = document.createElement('select');
    await fillProviderSelect(select, LIBRARY_MODEL_PROVIDER_ID, {
      includeEmptyOption: false,
      includeLibraryProvider: true,
    });
    const ids = Array.from(select.options).map((opt) => opt.value);
    assert.ok(ids.includes('openai'));
    assert.ok(ids.includes(LIBRARY_MODEL_PROVIDER_ID));
    assert.equal(select.value, LIBRARY_MODEL_PROVIDER_ID);
  });

  test('fillProviderSelect can put My Models first and omit local runtimes', async () => {
    const { fillProviderSelect } = await import('../../src/ui/settings-model-binding.ts');
    const select = document.createElement('select');
    await fillProviderSelect(select, LIBRARY_MODEL_PROVIDER_ID, {
      includeEmptyOption: false,
      includeLibraryProvider: true,
      omitLocalRuntimeProviders: true,
      libraryProviderFirst: true,
    });
    const ids = Array.from(select.options).map((opt) => opt.value);
    assert.equal(ids[0], LIBRARY_MODEL_PROVIDER_ID);
    assert.equal(ids.includes('llama-cpp-local'), false);
    assert.ok(ids.includes('openai'));
  });

  test('fetchAllCatalogRosterTargets merges registry models with My Models rows', async () => {
    const { fetchAllCatalogRosterTargets } = await import('../../src/ui/settings-model-binding.ts');
    const targets = await fetchAllCatalogRosterTargets();
    assert.deepEqual(targets, [
      { providerId: 'openai', modelId: 'gpt-4o' },
      { providerId: LIBRARY_MODEL_PROVIDER_ID, modelId: 'gguf:qwen/qwen3:file.gguf' },
    ]);
  });
});
