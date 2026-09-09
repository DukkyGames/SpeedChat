/**
 * Server-side My Models remap — V2 boards must not send `minnow-library`
 * into getProvider. Chat already remaps in the renderer; this is the
 * in-process twin (live serve, then auto-load, else the chat-style miss).
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  LIBRARY_MODEL_NOT_LOADED_MESSAGE,
  resolveLibraryAttemptBinding,
  setLibraryBindingDepsForTests,
} from '../../server/models/library-binding.js';
import {
  LLAMA_CPP_LOCAL_ID,
  MLX_LM_LOCAL_ID,
} from '../../src/models/runtime-ids.mjs';

const LIBRARY_PROVIDER = 'minnow-library';
const GGUF_LIBRARY_ID = 'gguf:qwen/Qwen3.5-9B:weights.Q4_K_M.gguf';
const MLX_LIBRARY_ID = 'mlx:mlx-community/Ornith-35B-4bit';
const MLX_SNAPSHOT = '/models/hub/mlx-community--Ornith-35B/snapshots/abc123';
const GGUF_PATH = '/models/hub/qwen--Qwen3.5-9B/weights.Q4_K_M.gguf';

const GGUF_CACHED = {
  repo_id: 'qwen/Qwen3.5-9B',
  path: '/models/hub/qwen--Qwen3.5-9B',
  is_local_dir: true,
  gguf_files: [
    {
      name: 'Qwen3.5-9B.Q4_K_M.gguf',
      rel_path: 'weights.Q4_K_M.gguf',
      size_bytes: 6_000,
      role: 'model',
      quant: 'Q4_K_M',
    },
  ],
};

const MLX_CACHED = {
  repo_id: 'mlx-community/Ornith-35B-4bit',
  path: '/models/hub/mlx-community--Ornith-35B',
  mlx_root: MLX_SNAPSHOT,
  mlx_quant: 'mlx-4bit',
};

function blockedStart() {
  return async () => {
    throw new Error('startServe should not be called');
  };
}

function baseDeps(overrides = {}) {
  return {
    findLiveLlamaCppServe: async () => null,
    findLiveMlxServe: async () => null,
    listServes: async () => [],
    listCachedModels: async () => ({ models: [] }),
    startServe: blockedStart(),
    getServe: async () => null,
    sleep: async () => {},
    now: () => 0,
    loadTimeoutMs: 10_000,
    ...overrides,
  };
}

beforeEach(() => {
  setLibraryBindingDepsForTests(baseDeps());
});

afterEach(() => {
  setLibraryBindingDepsForTests(null);
});

describe('resolveLibraryAttemptBinding', () => {
  test('cloud and direct ids pass through unchanged', async () => {
    const cloud = { providerId: 'openai', id: 'gpt-4o' };
    assert.deepEqual(await resolveLibraryAttemptBinding(cloud), cloud);

    const direct = { providerId: LLAMA_CPP_LOCAL_ID, id: 'Qwen3.5-9B' };
    assert.deepEqual(await resolveLibraryAttemptBinding(direct), direct);
  });

  test('remaps a running GGUF serve onto llama-cpp-local + modelLabel', async () => {
    setLibraryBindingDepsForTests(
      baseDeps({
        findLiveLlamaCppServe: async () => ({
          id: 'serve-gguf',
          runtime: 'llama-cpp',
          status: 'running',
          modelLabel: 'Qwen3.5-9B',
          modelPath: GGUF_PATH,
          libraryId: GGUF_LIBRARY_ID,
        }),
      }),
    );

    const bound = await resolveLibraryAttemptBinding({
      providerId: LIBRARY_PROVIDER,
      id: GGUF_LIBRARY_ID,
    });
    assert.deepEqual(bound, { providerId: LLAMA_CPP_LOCAL_ID, id: 'Qwen3.5-9B' });
  });

  test('remaps a running MLX serve onto mlx-lm-local + snapshot path', async () => {
    setLibraryBindingDepsForTests(
      baseDeps({
        findLiveMlxServe: async () => ({
          id: 'serve-mlx',
          runtime: 'mlx-lm',
          status: 'running',
          modelLabel: 'Ornith-35B-4bit',
          modelPath: MLX_SNAPSHOT,
          libraryId: MLX_LIBRARY_ID,
        }),
      }),
    );

    const bound = await resolveLibraryAttemptBinding({
      providerId: LIBRARY_PROVIDER,
      id: MLX_LIBRARY_ID,
    });
    assert.deepEqual(bound, { providerId: MLX_LM_LOCAL_ID, id: MLX_SNAPSHOT });
  });

  test('auto-loads a cached GGUF row when no serve is running', async () => {
    /** @type {object[]} */
    const startBodies = [];
    setLibraryBindingDepsForTests(
      baseDeps({
        listCachedModels: async () => ({ models: [GGUF_CACHED] }),
        startServe: async (body) => {
          startBodies.push(body);
          return {
            id: 'serve-started',
            runtime: 'llama-cpp',
            status: 'running',
            modelLabel: 'Qwen3.5-9B',
            modelPath: GGUF_PATH,
            libraryId: body.libraryId,
          };
        },
      }),
    );

    const bound = await resolveLibraryAttemptBinding({
      providerId: LIBRARY_PROVIDER,
      id: GGUF_LIBRARY_ID,
    });
    assert.equal(startBodies.length, 1);
    assert.equal(startBodies[0].runtime, 'llama-cpp');
    assert.equal(startBodies[0].libraryId, GGUF_LIBRARY_ID);
    assert.equal(
      startBodies[0].modelPath,
      path.join(GGUF_CACHED.path, 'weights.Q4_K_M.gguf'),
    );
    assert.deepEqual(bound, { providerId: LLAMA_CPP_LOCAL_ID, id: 'Qwen3.5-9B' });
  });

  test('auto-loads a cached MLX row when no serve is running', async () => {
    /** @type {object[]} */
    const startBodies = [];
    setLibraryBindingDepsForTests(
      baseDeps({
        listCachedModels: async () => ({ models: [MLX_CACHED] }),
        startServe: async (body) => {
          startBodies.push(body);
          return {
            id: 'serve-mlx-started',
            runtime: 'mlx-lm',
            status: 'running',
            modelLabel: MLX_SNAPSHOT,
            modelPath: MLX_SNAPSHOT,
            libraryId: body.libraryId,
          };
        },
      }),
    );

    const bound = await resolveLibraryAttemptBinding({
      providerId: LIBRARY_PROVIDER,
      id: MLX_LIBRARY_ID,
    });
    assert.equal(startBodies.length, 1);
    assert.equal(startBodies[0].runtime, 'mlx-lm');
    assert.equal(startBodies[0].libraryId, MLX_LIBRARY_ID);
    assert.equal(startBodies[0].modelPath, MLX_SNAPSHOT);
    assert.deepEqual(bound, { providerId: MLX_LM_LOCAL_ID, id: MLX_SNAPSHOT });
  });

  test('missing serve without a resolvable library row throws the not-loaded message', async () => {
    await assert.rejects(
      () =>
        resolveLibraryAttemptBinding({
          providerId: LIBRARY_PROVIDER,
          id: GGUF_LIBRARY_ID,
        }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, LIBRARY_MODEL_NOT_LOADED_MESSAGE);
        assert.equal(err.message.includes('ENOENT'), false);
        return true;
      },
    );
  });

  test('waits out a starting serve instead of spawning a second one', async () => {
    let startCalled = false;
    setLibraryBindingDepsForTests(
      baseDeps({
        findLiveLlamaCppServe: async () => ({
          id: 'serve-starting',
          runtime: 'llama-cpp',
          status: 'starting',
          modelLabel: 'Qwen3.5-9B',
        }),
        getServe: async () => ({
          id: 'serve-starting',
          runtime: 'llama-cpp',
          status: 'running',
          modelLabel: 'Qwen3.5-9B',
        }),
        startServe: async () => {
          startCalled = true;
          throw new Error('startServe should not be called');
        },
      }),
    );

    const bound = await resolveLibraryAttemptBinding({
      providerId: LIBRARY_PROVIDER,
      id: GGUF_LIBRARY_ID,
    });
    assert.equal(startCalled, false);
    assert.deepEqual(bound, { providerId: LLAMA_CPP_LOCAL_ID, id: 'Qwen3.5-9B' });
  });
});

describe('resolveLibraryIdForProviderModel', () => {
  test('maps a llama-cpp-local label onto a cached GGUF library id', async () => {
    const { resolveLibraryIdForProviderModel } = await import('../../server/models/library-binding.js');
    const id = await resolveLibraryIdForProviderModel(LLAMA_CPP_LOCAL_ID, 'Qwen3.5-9B.Q4_K_M', {
      listCachedModels: async () => ({ models: [GGUF_CACHED] }),
    });
    assert.equal(id, GGUF_LIBRARY_ID);
  });
});
