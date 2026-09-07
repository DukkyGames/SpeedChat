import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  devicePrefixForVariant,
  joinDeviceList,
  parseDeviceList,
  parseLlamaListDevices,
  parseTensorSplit,
  resolveLaunchDevices,
  selectedGpuVramGb,
  synthesizeLlamaDevices,
  tensorSplitPercents,
  toggleDeviceSelection,
  vramProportionalSplit,
} from '../../src/models/llama-devices.mjs';

const LIST_STDOUT = `ggml_cuda_init: found 2 CUDA devices:
Available devices:
  CUDA0: NVIDIA GeForce RTX 4090 (24576 MiB, 23000 MiB free)
  CUDA1: NVIDIA GeForce RTX 3080 (10240 MiB, 9800 MiB free)
  CPU0:  AMD Ryzen (32000 MiB, 16000 MiB free)
`;

describe('parseLlamaListDevices', () => {
  test('parses CUDA rows and skips CPU', () => {
    const devices = parseLlamaListDevices(LIST_STDOUT);
    assert.equal(devices.length, 2);
    assert.equal(devices[0].id, 'CUDA0');
    assert.equal(devices[0].name, 'NVIDIA GeForce RTX 4090');
    assert.equal(devices[0].memoryMiB, 24576);
    assert.equal(devices[0].freeMiB, 23000);
    assert.equal(devices[1].id, 'CUDA1');
  });

  test('parses Vulkan ids', () => {
    const devices = parseLlamaListDevices(
      '  Vulkan0: AMD Radeon RX 7900 XTX (24576 MiB, 24000 MiB free)\n',
    );
    assert.equal(devices[0].id, 'Vulkan0');
    assert.equal(devicePrefixForVariant('vulkan'), 'Vulkan');
  });
});

describe('synthesizeLlamaDevices', () => {
  test('maps hardware.gpus onto CUDA ids', () => {
    const devices = synthesizeLlamaDevices(
      {
        backend: 'cuda',
        gpus: [
          { index: 0, name: 'RTX 4090', vramGb: 24 },
          { index: 1, name: 'RTX 3080', vramGb: 10 },
        ],
      },
      'cuda-12.4',
    );
    assert.deepEqual(
      devices.map((d) => d.id),
      ['CUDA0', 'CUDA1'],
    );
    assert.equal(devices[1].name, 'RTX 3080');
  });
});

describe('device selection and splits', () => {
  test('check order appends; last id cannot be cleared', () => {
    let selected = ['CUDA0'];
    selected = toggleDeviceSelection(selected, 'CUDA1', true);
    assert.deepEqual(selected, ['CUDA0', 'CUDA1']);
    selected = toggleDeviceSelection(selected, 'CUDA0', false);
    assert.deepEqual(selected, ['CUDA1']);
    selected = toggleDeviceSelection(selected, 'CUDA1', false);
    assert.deepEqual(selected, ['CUDA1']);
    assert.equal(joinDeviceList(selected), 'CUDA1');
  });

  test('parseDeviceList drops CPU and junk', () => {
    assert.deepEqual(parseDeviceList('CUDA1, CUDA0, cpu, nope'), ['CUDA1', 'CUDA0']);
  });

  test('pin-first when two GPUs and no user device', () => {
    const resolved = resolveLaunchDevices({
      inventory: [{ id: 'CUDA0' }, { id: 'CUDA1' }],
    });
    assert.equal(resolved.reason, 'pin-first');
    assert.deepEqual(resolved.ids, ['CUDA0']);
    assert.equal(resolved.emit, true);
  });

  test('5,5 and 1,1 are the same equal split in percents', () => {
    assert.deepEqual(tensorSplitPercents(parseTensorSplit('5,5')), [50, 50]);
    assert.deepEqual(tensorSplitPercents(parseTensorSplit('1,1')), [50, 50]);
  });

  test('VRAM-proportional weights follow memoryMiB', () => {
    const parts = vramProportionalSplit([
      { memoryMiB: 24576 },
      { memoryMiB: 10240 },
    ]);
    assert.deepEqual(parts, [24576, 10240]);
    assert.equal(selectedGpuVramGb(
      [
        { id: 'CUDA0', memoryMiB: 24576 },
        { id: 'CUDA1', memoryMiB: 10240 },
      ],
      ['CUDA0', 'CUDA1'],
    ), 10);
  });
});
