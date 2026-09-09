/**
 * Resolve which upstream API a model should use within a provider entry.
 * Shared by server generations pump and client model catalog normalization.
 */

/** @typedef {'lm-studio-v0' | 'openai-v1' | 'anthropic-v1' | 'agent-cli-v1'} ApiKind */

const API_KINDS = new Set(['lm-studio-v0', 'openai-v1', 'anthropic-v1', 'agent-cli-v1']);

/**
 * @param {unknown} value
 * @returns {ApiKind | null}
 */
function coerceApiKind(value) {
  if (typeof value === 'string' && API_KINDS.has(value)) {
    return /** @type {ApiKind} */ (value);
  }
  return null;
}

/**
 * Heuristic + catalog signals for Anthropic Messages routing on mixed gateways.
 *
 * @param {string} modelId
 * @param {{ owned_by?: string, arch?: string, family?: string, api?: string } | null | undefined} modelMeta
 * @returns {boolean}
 */
export function modelLooksAnthropic(modelId, modelMeta) {
  if (modelMeta) {
    const tagged = coerceApiKind(modelMeta.api);
    if (tagged === 'anthropic-v1') return true;
    if (tagged === 'openai-v1') return false;

    const ownedBy = typeof modelMeta.owned_by === 'string' ? modelMeta.owned_by.trim().toLowerCase() : '';
    if (ownedBy === 'anthropic') return true;

    const arch = typeof modelMeta.arch === 'string' ? modelMeta.arch.trim().toLowerCase() : '';
    if (arch === 'anthropic') return true;

    const family = typeof modelMeta.family === 'string' ? modelMeta.family.trim().toLowerCase() : '';
    if (family === 'anthropic') return true;
  }

  const id = String(modelId || '').trim();
  if (!id) return false;
  if (id.startsWith('anthropic/')) return true;
  return /(^|[/:])claude|anthropic/i.test(id);
}

/**
 * @param {{ profile?: { apiKind?: string, autoApi?: boolean, modelApiOverrides?: Record<string, string> } } | { apiKind?: string, autoApi?: boolean, modelApiOverrides?: Record<string, string> }} runtimeOrProfile
 * @param {string} modelId
 * @param {{ owned_by?: string, arch?: string, family?: string, api?: string } | null | undefined} [modelMeta]
 * @returns {ApiKind}
 */
export function resolveModelApi(runtimeOrProfile, modelId, modelMeta) {
  const profile =
    runtimeOrProfile && typeof runtimeOrProfile === 'object' && runtimeOrProfile.profile
      ? runtimeOrProfile.profile
      : runtimeOrProfile;

  const overrides =
    profile && typeof profile === 'object' && profile.modelApiOverrides
      ? profile.modelApiOverrides
      : undefined;

  if (overrides && typeof overrides === 'object') {
    const override = coerceApiKind(overrides[modelId]);
    if (override) return override;
  }

  const baseKind = coerceApiKind(profile?.apiKind) ?? 'openai-v1';
  if (!profile?.autoApi || baseKind !== 'openai-v1') {
    return baseKind;
  }

  return modelLooksAnthropic(modelId, modelMeta) ? 'anthropic-v1' : 'openai-v1';
}
