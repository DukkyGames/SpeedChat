import { listProviders } from '../providers/store.js';
import { proxyModels } from '../providers/proxy.js';
import { readCapabilities } from '../providers/capabilities-store.js';

const catalogs = new Map();

export function invalidateRouterProvider(providerId) { catalogs.delete(providerId); }

export async function routerAvailability(router, body = {}) {
  const { providers } = await listProviders();
  const results = new Map();
  await Promise.all([...new Set(router.entries.map((e) => e.providerId))].map(async (id) => {
    const provider = providers.find((p) => p.id === id && p.enabled !== false);
    if (!provider) { results.set(id, { error: 'Provider missing or disabled' }); return; }
    let cached = catalogs.get(id);
    if (!cached || cached.expires < Date.now()) {
      const promise = proxyModels(id).catch(() => ({ data: [], error: 'Provider unavailable or credentials rejected' }));
      cached = { expires: Date.now() + 10000, promise };
      catalogs.set(id, cached);
    }
    results.set(id, { ...(await cached.promise), capabilities: await readCapabilities(id) });
  }));
  const vision = (body.messages || []).some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'image_url'));
  return Object.fromEntries(router.entries.map((entry) => {
    const catalog = results.get(entry.providerId);
    const model = catalog?.data?.find((m) => m.id === entry.modelId);
    const capabilities = catalog?.capabilities?.models?.[entry.modelId];
    let reason = !router.enabled ? 'Router disabled' : !entry.enabled ? 'Entry disabled' : catalog?.error || (!model ? 'Model unavailable' : 'Available');
    if (model?.enabled === false || model?.type === 'embeddings' || model?.type === 'embedding') reason = 'Model unavailable for chat';
    if (model && vision && !(capabilities?.vision === true || model.catalogVision === true || model.type === 'vlm')) reason = 'Image input unsupported or unverified';
    if (model && vision && capabilities?.vision === false && capabilities.sources?.vision === 'probe') reason = 'Image input unsupported';
    if (model && body.tools?.length && capabilities?.tools === false) reason = 'Tool calling unsupported';
    if (model && body.stream !== false && capabilities?.streaming === false) reason = 'Streaming unsupported';
    return [entry.id, { available: reason === 'Available', reason }];
  }));
}
