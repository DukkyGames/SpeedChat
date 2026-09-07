/**
 * llama.cpp GPU device ids, --list-devices parsing, and tensor-split helpers.
 * Shared by the Models inspector (client) and llama-server argv (server).
 */

/** Split modes Minnow exposes. `row` is deprecated upstream; do not offer it. */
export const LLAMA_SPLIT_MODES = ['none', 'layer', 'tensor'];

/**
 * True when the token is a GPU backend id llama.cpp would accept on --device.
 * CPU rows from --list-devices are excluded so they never enter the picker.
 *
 * @param {unknown} id
 */
export function isGpuLlamaDeviceId(id) {
  if (typeof id !== 'string') return false;
  const token = id.trim();
  if (!token || /^cpu\d*$/i.test(token)) return false;
  return /^(CUDA|Vulkan|ROCm|HIP|Metal|SYCL|GPU)\d+$/i.test(token);
}

/**
 * GGML --device prefix for a llama.cpp variant or hardware backend id.
 *
 * @param {string | null | undefined} variant
 */
export function devicePrefixForVariant(variant) {
  const v = String(variant ?? '').toLowerCase();
  if (v.includes('vulkan')) return 'Vulkan';
  if (v.includes('metal')) return 'Metal';
  if (v.includes('sycl')) return 'SYCL';
  if (v.includes('rocm') || v.includes('hip')) return 'HIP';
  if (v.includes('cuda')) return 'CUDA';
  return 'CUDA';
}

/**
 * Parse `llama-server --list-devices` stdout (and stderr; some builds log there).
 * Lines look like: `CUDA0: NVIDIA GeForce RTX 4090 (24576 MiB, 23000 MiB free)`.
 *
 * @param {string} text
 * @returns {Array<{ id: string, name: string, memoryMiB: number, freeMiB: number | null }>}
 */
export function parseLlamaListDevices(text) {
  const devices = [];
  const re =
    /^\s*([A-Za-z][A-Za-z0-9]*\d+)\s*:\s*(.+?)\s*\(\s*([0-9.]+)\s*MiB(?:\s*,\s*([0-9.]+)\s*MiB\s*free)?\s*\)\s*$/;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = line.match(re);
    if (!match) continue;
    const id = match[1];
    if (!isGpuLlamaDeviceId(id)) continue;
    const memoryMiB = Number(match[3]);
    const freeRaw = match[4] != null ? Number(match[4]) : NaN;
    devices.push({
      id,
      name: match[2].trim(),
      memoryMiB: Number.isFinite(memoryMiB) ? memoryMiB : 0,
      freeMiB: Number.isFinite(freeRaw) ? freeRaw : null,
    });
  }
  return devices;
}

/**
 * Build CUDA0/Vulkan0/… rows from the hardware snapshot when --list-devices is unavailable.
 *
 * @param {Record<string, unknown> | null | undefined} hardware
 * @param {string | null | undefined} variant
 */
export function synthesizeLlamaDevices(hardware, variant) {
  const gpus = Array.isArray(hardware?.gpus) ? hardware.gpus : [];
  const prefix = devicePrefixForVariant(variant || hardware?.backend);
  /** @type {Array<{ id: string, name: string, memoryMiB: number, freeMiB: number | null }>} */
  const out = [];
  for (let i = 0; i < gpus.length; i += 1) {
    const gpu = gpus[i] && typeof gpus[i] === 'object' ? gpus[i] : {};
    const index = Number(gpu.index);
    const slot = Number.isFinite(index) ? index : i;
    const vramGb = Number(gpu.vramGb);
    out.push({
      id: `${prefix}${slot}`,
      name: typeof gpu.name === 'string' && gpu.name.trim() ? gpu.name.trim() : `${prefix}${slot}`,
      memoryMiB: Number.isFinite(vramGb) && vramGb > 0 ? Math.round(vramGb * 1024) : 0,
      freeMiB: null,
    });
  }
  return out;
}

/**
 * Prefer a live --list-devices inventory; fall back to synthesized hardware rows.
 *
 * @param {Array<{ id: string }> | null | undefined} listed
 * @param {Record<string, unknown> | null | undefined} hardware
 * @param {string | null | undefined} variant
 */
export function resolveLlamaDeviceInventory(listed, hardware, variant) {
  if (Array.isArray(listed) && listed.some((row) => isGpuLlamaDeviceId(row?.id))) {
    return listed.filter((row) => isGpuLlamaDeviceId(row?.id));
  }
  return synthesizeLlamaDevices(hardware, variant);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function parseDeviceList(value) {
  if (Array.isArray(value)) {
    return value.map((token) => String(token).trim()).filter((token) => isGpuLlamaDeviceId(token));
  }
  if (typeof value !== 'string' || !value.trim()) return [];
  return value
    .split(',')
    .map((token) => token.trim())
    .filter((token) => isGpuLlamaDeviceId(token));
}

/** @param {string[]} ids */
export function joinDeviceList(ids) {
  return ids.filter((id) => isGpuLlamaDeviceId(id)).join(',');
}

/**
 * @param {unknown} value
 * @returns {number[]}
 */
export function parseTensorSplit(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const parts = [];
  for (const token of value.split(',')) {
    const n = Number(token.trim());
    if (!Number.isFinite(n) || n < 0) return [];
    parts.push(n);
  }
  return parts;
}

/** @param {number[]} parts */
export function joinTensorSplit(parts) {
  return parts.map((n) => String(n)).join(',');
}

/**
 * Default ratio weights from device VRAM. Values are proportions, not percents
 * (5,5 and 1,1 are the same equal split).
 *
 * @param {Array<{ memoryMiB?: number }>} devices
 * @returns {number[]}
 */
export function vramProportionalSplit(devices) {
  return devices.map((device) => {
    const mib = Number(device?.memoryMiB);
    return Number.isFinite(mib) && mib > 0 ? Math.max(1, Math.round(mib)) : 1;
  });
}

/**
 * Display percents that sum to ~100 for the ratio hint.
 *
 * @param {number[]} parts
 * @returns {number[]}
 */
export function tensorSplitPercents(parts) {
  const sum = parts.reduce((acc, n) => acc + n, 0);
  if (!(sum > 0)) return parts.map(() => 0);
  return parts.map((n) => Math.round((n / sum) * 1000) / 10);
}

/**
 * Check order is --device order. Re-checking appends. The last remaining id cannot be removed.
 *
 * @param {string[]} selected
 * @param {string} id
 * @param {boolean} checked
 */
export function toggleDeviceSelection(selected, id, checked) {
  const current = selected.filter((token) => isGpuLlamaDeviceId(token));
  if (!isGpuLlamaDeviceId(id)) return current;
  if (checked) {
    if (current.includes(id)) return current;
    return [...current, id];
  }
  const next = current.filter((token) => token !== id);
  return next.length > 0 ? next : current;
}

/**
 * Decide which --device list to emit. llama.cpp uses every visible GPU when the
 * flag is omitted, so two or more inventory rows pin the first id until the user opts in.
 *
 * @param {object} opts
 * @param {unknown} [opts.requestedDevice]
 * @param {Array<{ id: string }>} [opts.inventory]
 * @param {boolean} [opts.extraHasDevice]
 */
export function resolveLaunchDevices(opts) {
  if (opts.extraHasDevice) {
    return { ids: [], emit: false, reason: 'extra' };
  }
  const requested = parseDeviceList(opts.requestedDevice);
  if (requested.length) {
    return { ids: requested, emit: true, reason: 'user' };
  }
  const inventory = Array.isArray(opts.inventory) ? opts.inventory : [];
  const gpus = inventory.filter((row) => isGpuLlamaDeviceId(row?.id));
  if (gpus.length >= 2) {
    return { ids: [gpus[0].id], emit: true, reason: 'pin-first' };
  }
  return { ids: [], emit: false, reason: 'omit' };
}

/**
 * GiB of the smallest selected card, used as the per-device --fit-target base.
 *
 * @param {Array<{ id: string, memoryMiB?: number }>} inventory
 * @param {string[]} selectedIds
 */
export function selectedGpuVramGb(inventory, selectedIds) {
  const byId = new Map((inventory || []).map((row) => [row.id, row]));
  let minMib = Infinity;
  for (const id of selectedIds) {
    const row = byId.get(id);
    const mib = Number(row?.memoryMiB);
    if (Number.isFinite(mib) && mib > 0 && mib < minMib) minMib = mib;
  }
  if (!Number.isFinite(minMib)) return 0;
  return Math.round((minMib / 1024) * 10) / 10;
}
