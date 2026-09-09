import { getWorkspacePath } from '../state/workspace';
import { decodeModelSelectKey, encodeModelSelectKey } from '../lib/model-select-key';

export const ROUTER_PROVIDER_ID = 'minnow-router';
export interface RouterEntry { id: string; providerId: string; modelId: string; enabled: boolean; concurrencyLimit: number }
export interface ModelRouter { id: string; name: string; enabled: boolean; policy: 'priority' | 'balance'; entries: RouterEntry[] }
export interface RouterConfig { routers: ModelRouter[]; defaultRouterId: string | null; revision: number; assignments?: RouterActivity['assignments'] }
export interface RouterActivity {
  assignments: { chatId: string; routerId: string; assignmentMode: 'router' | 'override'; assignedEntryId: string; overrideEntryId?: string }[];
  requests: { chatId: string; entryId: string; status: string; requestId: string }[];
  entries: { entryId: string; active: number; queued: number; telemetry: { completed: number; errors: number; latencyMs: number; tokens: number; promptTokens: number; completionTokens: number; usageSamples: number } | null }[];
  availability: Record<string, { available: boolean; reason: string }>;
  events: { chatId: string; entryId?: string; status: string; timestamp: string; error?: string }[];
}
const empty = (): RouterConfig => ({ routers: [], defaultRouterId: null, revision: 0 });
const cache = new Map<string, RouterConfig>();
const assignments = new Map<string, string>();
const workspaceKey = (root = getWorkspacePath()): string => {
  const normalized = root.replace(/\\/g, '/').replace(/\/$/, '');
  return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
};

export function getRouterConfigSync(root?: string): RouterConfig {
  const key = workspaceKey(root);
  if (cache.has(key)) return cache.get(key)!;
  try {
    const stored = JSON.parse(localStorage.getItem(`minnow.routers:${key}`) || 'null') as RouterConfig | null;
    if (stored && Array.isArray(stored.routers)) { cache.set(key, stored); return stored; }
  } catch {}
  return empty();
}
export function routerAssignmentLabel(chatId: string, routerId: string): string { return assignments.get(JSON.stringify([routerId, chatId])) || ''; }
export function routerChatModelLabel(chat: { providerId?: string; modelId?: string }): string {
  if (chat.providerId !== ROUTER_PROVIDER_ID) return chat.modelId || '';
  const router = getRouterConfigSync().routers.find((r) => r.id === chat.modelId);
  return router ? `${router.name} · Router` : 'Unavailable router';
}
export function noteRouterAssignment(chatId: string, providerId: string, modelId: string, routerId: string): void {
  assignments.set(JSON.stringify([routerId, chatId]), `${providerId} / ${modelId}`);
  window.dispatchEvent(new window.Event('minnow-router-assignment'));
}

export async function routerApi<T>(suffix = '', body?: unknown, method = 'GET'): Promise<T> {
  const response = await fetch(`/api/generations/routers${suffix}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Router request failed (${response.status})`);
  return value as T;
}
export async function loadRouterConfig(): Promise<RouterConfig> {
  const key = workspaceKey();
  const config = await routerApi<RouterConfig>();
  cache.set(key, config);
  for (const assignment of config.assignments || []) {
    const entry = config.routers.find((r) => r.id === assignment.routerId)?.entries.find((e) => e.id === assignment.assignedEntryId);
    if (entry) assignments.set(JSON.stringify([assignment.routerId, assignment.chatId]), `${entry.providerId} / ${entry.modelId}`);
  }
  try { localStorage.setItem(`minnow.routers:${key}`, JSON.stringify(config)); } catch {}
  return config;
}
export async function saveRouterConfig(config: RouterConfig): Promise<RouterConfig> {
  const key = workspaceKey();
  const saved = await routerApi<RouterConfig>('', config, 'PUT');
  cache.set(key, saved);
  try { localStorage.setItem(`minnow.routers:${key}`, JSON.stringify(saved)); } catch {}
  const select = document.getElementById('modelSelect') as HTMLSelectElement | null;
  if (select) {
    const previous = select.value;
    routerOptions(select, saved);
    let desired = saved.defaultRouterId ? encodeModelSelectKey(ROUTER_PROVIDER_ID, saved.defaultRouterId) : previous;
    if (!saved.defaultRouterId && decodeModelSelectKey(previous)?.providerId === ROUTER_PROVIDER_ID) {
      desired = [...select.options].find((o) => o.value && decodeModelSelectKey(o.value)?.providerId !== ROUTER_PROVIDER_ID)?.value || '';
    }
    select.value = desired;
    const { persistDefaultModelValue } = await import('../ui/default-model');
    persistDefaultModelValue(desired);
    const { syncModelSelectPicker } = await import('../ui/model-select-picker');
    syncModelSelectPicker();
    const { syncComposerModelTriggers } = await import('../ui/composer-model-trigger');
    syncComposerModelTriggers();
  }
  window.dispatchEvent(new window.Event('minnow-routers-changed'));
  return saved;
}
export function routerOptions(select: HTMLSelectElement, config: RouterConfig): void {
  select.querySelector('[data-router-group]')?.remove();
  const group = document.createElement('optgroup'); group.label = 'Routers'; group.dataset.routerGroup = 'true';
  for (const router of config.routers.filter((r) => r.enabled)) {
    const option = document.createElement('option');
    option.textContent = `${router.name} — Router`;
    option.value = encodeModelSelectKey(ROUTER_PROVIDER_ID, router.id);
    option.dataset.providerId = ROUTER_PROVIDER_ID;
    group.append(option);
  }
  if (group.children.length) select.append(group);
}
