/**
 * Router My Models bind waits for in-flight local generations before swapping.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  bindRouterLibraryEntry,
  setLibraryServeDepsForTests,
} from '../../server/model-routers/library-serve.js';
import { setLibraryBindingDepsForTests } from '../../server/models/library-binding.js';
import { LLAMA_CPP_LOCAL_ID } from '../../src/models/runtime-ids.mjs';

const LIBRARY_A = 'gguf:qwen/A:a.gguf';
const LIBRARY_B = 'gguf:qwen/B:b.gguf';

afterEach(() => {
  setLibraryServeDepsForTests(null);
  setLibraryBindingDepsForTests(null);
});

describe('bindRouterLibraryEntry', () => {
  test('remaps an already-running serve without starting another', async () => {
    let started = 0;
    setLibraryServeDepsForTests({
      resolveLibraryId: async () => LIBRARY_A,
      findLiveLlamaCppServe: async () => ({
        id: 'serve-a',
        runtime: 'llama-cpp',
        status: 'running',
        modelLabel: 'A',
        libraryId: LIBRARY_A,
      }),
      findLiveMlxServe: async () => null,
      listServes: async () => [],
      listGenerationStates: () => [],
      resolveBinding: async () => {
        started += 1;
        return { providerId: LLAMA_CPP_LOCAL_ID, id: 'A' };
      },
      sleep: async () => {},
      now: () => 1,
      loadTimeoutMs: 5_000,
    });
    const bound = await bindRouterLibraryEntry({
      providerId: 'minnow-library',
      modelId: LIBRARY_A,
    });
    assert.deepEqual(bound, { providerId: LLAMA_CPP_LOCAL_ID, id: 'A' });
    assert.equal(started, 1);
  });

  test('waits until another local generation finishes before loading a different model', async () => {
    let now = 0;
    let resolveBindingCalls = 0;
    const generations = [
      {
        status: 'streaming',
        providerId: LLAMA_CPP_LOCAL_ID,
        chosenProviderId: LLAMA_CPP_LOCAL_ID,
        chosenModelId: 'A',
        routerAttempt: true,
      },
    ];
    setLibraryServeDepsForTests({
      resolveLibraryId: async (_pid, mid) => mid,
      findLiveLlamaCppServe: async () => null,
      findLiveMlxServe: async () => null,
      listServes: async () => [
        {
          id: 'serve-a',
          runtime: 'llama-cpp',
          status: 'running',
          modelLabel: 'A',
          libraryId: LIBRARY_A,
        },
      ],
      listGenerationStates: () => generations,
      resolveBinding: async () => {
        resolveBindingCalls += 1;
        return { providerId: LLAMA_CPP_LOCAL_ID, id: 'B' };
      },
      sleep: async () => {
        now += 400;
        generations.length = 0;
      },
      now: () => now,
      loadTimeoutMs: 5_000,
    });
    const bound = await bindRouterLibraryEntry({
      providerId: 'minnow-library',
      modelId: LIBRARY_B,
    });
    assert.equal(resolveBindingCalls, 1);
    assert.deepEqual(bound, { providerId: LLAMA_CPP_LOCAL_ID, id: 'B' });
  });

  test('abort while waiting does not load', async () => {
    const controller = new AbortController();
    let resolveBindingCalls = 0;
    setLibraryServeDepsForTests({
      resolveLibraryId: async () => LIBRARY_B,
      findLiveLlamaCppServe: async () => null,
      findLiveMlxServe: async () => null,
      listServes: async () => [
        {
          id: 'serve-a',
          runtime: 'llama-cpp',
          status: 'running',
          modelLabel: 'A',
          libraryId: LIBRARY_A,
        },
      ],
      listGenerationStates: () => [
        {
          status: 'streaming',
          providerId: LLAMA_CPP_LOCAL_ID,
          chosenProviderId: LLAMA_CPP_LOCAL_ID,
          chosenModelId: 'A',
        },
      ],
      resolveBinding: async () => {
        resolveBindingCalls += 1;
        return { providerId: LLAMA_CPP_LOCAL_ID, id: 'B' };
      },
      sleep: async () => {
        controller.abort();
      },
      now: () => 0,
      loadTimeoutMs: 5_000,
    });
    await assert.rejects(
      () =>
        bindRouterLibraryEntry(
          { providerId: 'minnow-library', modelId: LIBRARY_B },
          { signal: controller.signal },
        ),
      { name: 'AbortError' },
    );
    assert.equal(resolveBindingCalls, 0);
  });
});
