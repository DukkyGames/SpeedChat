/**
 * Pure residency policy: models_max, byte-budget LRU, alias matching.
 * No I/O — hardcoded serve ids and timestamps.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  estimatePlanMemoryBytes,
  pickEvictions,
  resolveModelsMax,
  resolveResidencyLimits,
  serveHasInFlightGenerations,
  serveMatchesModelId,
} from '../../server/models/admit-serve.js';
import { GIB } from '../../src/models/memory-model.mjs';

const SERVE_OLD = '11111111-1111-4111-8111-111111111111';
const SERVE_MID = '22222222-2222-4222-8222-222222222222';
const SERVE_NEW = '33333333-3333-4333-8333-333333333333';
const SERVE_INCOMING = '44444444-4444-4444-8444-444444444444';

describe('resolveModelsMax', () => {
  test('user llama-cpp.json models_max wins on CPU and GPU', () => {
    assert.equal(resolveModelsMax({ userModelsMax: 3, budgetGb: 8, isCpu: true }), 3);
    assert.equal(resolveModelsMax({ userModelsMax: 2, budgetGb: 12, isCpu: false }), 2);
  });

  test('CPU defaults to 1 even on a large RAM budget', () => {
    assert.equal(resolveModelsMax({ budgetGb: 64, isCpu: true }), 1);
  });

  test('GPU cap is 1 under 16 GB, 2 at 16–32 GB, 3 above 32 GB', () => {
    assert.equal(resolveModelsMax({ budgetGb: 12, isCpu: false }), 1);
    assert.equal(resolveModelsMax({ budgetGb: 15.9, isCpu: false }), 1);
    assert.equal(resolveModelsMax({ budgetGb: 16, isCpu: false }), 2);
    assert.equal(resolveModelsMax({ budgetGb: 32, isCpu: false }), 2);
    assert.equal(resolveModelsMax({ budgetGb: 33, isCpu: false }), 3);
  });
});

describe('resolveResidencyLimits', () => {
  test('GPU uses card VRAM for models_max so a 16 GB card is cap 2', () => {
    const limits = resolveResidencyLimits({
      hardware: { gpuVramGb: 16, availableRamGb: 32, totalRamGb: 64 },
      variant: 'cuda-12.4',
    });
    assert.equal(limits.modelsMax, 2);
    assert.equal(limits.isCpu, false);
  });

  test('CPU default cap is 1 regardless of RAM', () => {
    const limits = resolveResidencyLimits({
      hardware: { gpuVramGb: 0, availableRamGb: 64, totalRamGb: 128 },
      variant: 'cpu',
    });
    assert.equal(limits.modelsMax, 1);
    assert.equal(limits.isCpu, true);
  });
});

describe('pickEvictions', () => {
  test('third model at cap 2 evicts LRU (older lastUsedAt)', () => {
    const evicted = pickEvictions({
      residents: [
        { id: SERVE_OLD, lastUsedAt: 1000, estimateBytes: 1 },
        { id: SERVE_NEW, lastUsedAt: 2000, estimateBytes: 1 },
      ],
      incomingEstimateBytes: 1,
      modelsMax: 2,
      budgetBytes: 100 * GIB,
    });
    assert.deepEqual(
      evicted.map((row) => row.id),
      [SERVE_OLD],
    );
  });

  test('missing lastUsedAt is treated as oldest', () => {
    const evicted = pickEvictions({
      residents: [
        { id: SERVE_MID, lastUsedAt: 5000, estimateBytes: 1 },
        { id: SERVE_OLD, estimateBytes: 1 },
      ],
      incomingEstimateBytes: 1,
      modelsMax: 1,
      budgetBytes: 100 * GIB,
    });
    assert.deepEqual(
      evicted.map((row) => row.id),
      [SERVE_OLD, SERVE_MID],
    );
  });

  test('over-budget evicts LRU even when under cap', () => {
    const evicted = pickEvictions({
      residents: [
        { id: SERVE_OLD, lastUsedAt: 1000, estimateBytes: 6 * GIB },
        { id: SERVE_NEW, lastUsedAt: 2000, estimateBytes: 6 * GIB },
      ],
      incomingEstimateBytes: 6 * GIB,
      modelsMax: 3,
      budgetBytes: 14 * GIB,
    });
    assert.deepEqual(
      evicted.map((row) => row.id),
      [SERVE_OLD],
    );
  });

  test('never evicts the serve we are about to start', () => {
    const evicted = pickEvictions({
      residents: [
        { id: SERVE_INCOMING, lastUsedAt: 1, estimateBytes: 1 },
        { id: SERVE_OLD, lastUsedAt: 2, estimateBytes: 1 },
      ],
      incomingId: SERVE_INCOMING,
      incomingEstimateBytes: 1,
      modelsMax: 1,
      budgetBytes: 100 * GIB,
    });
    assert.deepEqual(
      evicted.map((row) => row.id),
      [SERVE_OLD],
    );
    assert.equal(evicted.some((row) => row.id === SERVE_INCOMING), false);
  });

  test('under cap and under budget evicts nothing', () => {
    const evicted = pickEvictions({
      residents: [{ id: SERVE_OLD, lastUsedAt: 1000, estimateBytes: 1 }],
      incomingEstimateBytes: 1,
      modelsMax: 3,
      budgetBytes: 100 * GIB,
    });
    assert.deepEqual(evicted, []);
  });

  test('zero or missing budgetBytes is cap-only (does not evict on estimates)', () => {
    const residents = [
      { id: SERVE_OLD, lastUsedAt: 1000, estimateBytes: 6 * GIB },
      { id: SERVE_NEW, lastUsedAt: 2000, estimateBytes: 6 * GIB },
    ];
    assert.deepEqual(
      pickEvictions({
        residents,
        incomingEstimateBytes: 6 * GIB,
        modelsMax: 3,
        budgetBytes: 0,
      }).map((row) => row.id),
      [],
    );
    assert.deepEqual(
      pickEvictions({
        residents,
        incomingEstimateBytes: 6 * GIB,
        modelsMax: 3,
        budgetBytes: Number.NaN,
      }).map((row) => row.id),
      [],
    );
  });
});

describe('serveMatchesModelId', () => {
  test('matches libraryId, label, filename, and stem', () => {
    const row = {
      libraryId: 'lib-alpha',
      modelLabel: 'Alpha 8B',
      modelPath: 'C:\\models\\alpha-8b-Q4_K_M.gguf',
    };
    assert.equal(serveMatchesModelId(row, 'lib-alpha'), true);
    assert.equal(serveMatchesModelId(row, 'Alpha 8B'), true);
    assert.equal(serveMatchesModelId(row, 'alpha-8b-Q4_K_M.gguf'), true);
    assert.equal(serveMatchesModelId(row, 'alpha-8b-Q4_K_M'), true);
    assert.equal(serveMatchesModelId(row, 'lib-beta'), false);
  });
});

describe('serveHasInFlightGenerations', () => {
  const serve = { libraryId: 'gguf:qwen/qwen3:file.gguf', modelLabel: 'Qwen3-8B', modelPath: '/models/Qwen3-8B.gguf' };

  test('ignores parent router states and completed generations', () => {
    assert.equal(
      serveHasInFlightGenerations(serve, [
        { status: 'streaming', providerId: 'minnow-router', chosenProviderId: 'minnow-router' },
        { status: 'complete', providerId: 'llama-cpp-local', chosenProviderId: 'llama-cpp-local', chosenModelId: 'Qwen3-8B' },
      ]),
      false,
    );
  });

  test('matches a live llama.cpp child bound to this serve', () => {
    assert.equal(
      serveHasInFlightGenerations(serve, [
        {
          status: 'streaming',
          providerId: 'llama-cpp-local',
          chosenProviderId: 'llama-cpp-local',
          chosenModelId: 'Qwen3-8B',
          routerAttempt: true,
        },
      ]),
      true,
    );
  });
});

describe('estimatePlanMemoryBytes', () => {
  test('missing geometry with no estimateGb is 0 so cap-only fixtures still work', () => {
    assert.equal(estimatePlanMemoryBytes({ variant: 'cpu' }), 0);
    assert.equal(estimatePlanMemoryBytes(null), 0);
  });

  test('planner estimateGb counts when geometry is absent (stub GGUF launch plans)', () => {
    assert.equal(estimatePlanMemoryBytes({ variant: 'cpu', estimateGb: 1.5 }), 1.5 * GIB);
  });
});
