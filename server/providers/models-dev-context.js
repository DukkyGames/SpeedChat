/**
 * OpenCode Zen / Go model lists omit both context_length and any vision signal on
 * /v1/models. OpenCode resolves those from models.dev — mirror that for Minnow
 * catalog rows, so a text-only model is never advertised as multimodal.
 */

const MODELS_DEV_URL = 'https://models.dev/api.json';
const MODELS_DEV_TIMEOUT_MS = 20_000;
/** Refresh catalog daily; limits change infrequently. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {{
 *   limit?: { context?: number },
 *   attachment?: boolean,
 *   modalities?: { input?: string[], output?: string[] },
 * }} ModelsDevEntry
 */

/** @type {{ fetchedAt: number, models: Record<string, ModelsDevEntry> | null }} */
const cache = { fetchedAt: 0, models: null };

/**
 * @param {string} baseUrl
 */
export function isOpenCodeProviderBaseUrl(baseUrl) {
  const raw = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === 'opencode.ai' || host.endsWith('.opencode.ai');
  } catch {
    return false;
  }
}

/**
 * OpenCode Go origin (`/zen/go`), not Zen (`/zen`).
 * Re-export of the shared helper so server callers stay on one import.
 *
 * @param {string | null | undefined} baseUrl
 * @returns {boolean}
 */
export { isOpenCodeGoBaseUrl } from '../../src/lib/openai-responses-route.mjs';

/**
 * @returns {Promise<Record<string, ModelsDevEntry>>}
 */
async function loadOpenCodeModelsDevCatalog() {
  const now = Date.now();
  if (cache.models && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.models;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODELS_DEV_TIMEOUT_MS);
  try {
    const res = await fetch(MODELS_DEV_URL, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`models.dev HTTP ${res.status}`);
    }
    const json = await res.json();
    const models =
      json?.opencode?.models && typeof json.opencode.models === 'object'
        ? /** @type {Record<string, ModelsDevEntry>} */ (json.opencode.models)
        : {};
    cache.fetchedAt = now;
    cache.models = models;
    return models;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Image-input support for one models.dev entry, or undefined when it says nothing.
 *
 * `modalities.input` is the precise field; `attachment` is the older flag and is
 * only read as a positive, since plenty of vision models predate it being set.
 *
 * @param {ModelsDevEntry | undefined} entry
 * @returns {boolean | undefined}
 */
export function modelsDevVisionFlag(entry) {
  const input = entry?.modalities?.input;
  if (Array.isArray(input) && input.length > 0) {
    return input.some((m) => typeof m === 'string' && /^images?$/i.test(m.trim()));
  }
  if (entry?.attachment === true) return true;
  return undefined;
}

/**
 * Attach max_context_length and vision support from models.dev when OpenCode
 * upstream omits them. Exact model id match only — authoritative for opencode.ai
 * providers, including the negative case: `modalities.input: ["text"]` is how a
 * text-only model stops being probed (and mis-reported) as multimodal.
 *
 * @param {{ data: Array<{ id: string, max_context_length?: number, catalogVision?: boolean, [key: string]: unknown }> }} normalized
 */
export async function enrichOpenCodeModelsFromModelsDev(normalized) {
  if (!normalized?.data?.length) {
    return normalized;
  }

  let catalog;
  try {
    catalog = await loadOpenCodeModelsDevCatalog();
  } catch (err) {
    console.warn('[providers] models.dev context enrichment failed:', err?.message || err);
    return normalized;
  }

  const data = normalized.data.map((row) => {
    const entry = catalog[row.id];
    if (!entry) return row;

    const next = { ...row };
    const devLimit = entry.limit?.context;
    if (typeof devLimit === 'number' && Number.isFinite(devLimit) && devLimit > 0) {
      next.max_context_length = devLimit;
    }
    const vision = modelsDevVisionFlag(entry);
    if (vision !== undefined) {
      next.catalogVision = vision;
    }
    return next;
  });

  return { data };
}

/** Test hook: reset in-memory models.dev cache. */
export function resetModelsDevContextCacheForTests() {
  cache.fetchedAt = 0;
  cache.models = null;
}
