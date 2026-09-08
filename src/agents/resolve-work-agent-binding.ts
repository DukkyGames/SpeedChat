import { listProviders } from '../providers/store';
import type { ProviderPublic } from '../providers/types';
import {
  isLibraryModelBinding,
  resolveUpstreamProviderId,
} from '../models/model-select-library';
import type { Chat } from '../types';
import type {
  WorkAgentBinding,
  WorkAgentDefinition,
  WorkAgentUserOverride,
} from './work-agent-types';
import { WorkAgentConfigError } from './work-agent-types';

export interface GlobalBindingDefaults {
  providerId: string;
  modelId: string;
}

export interface ResolveWorkAgentBindingOptions {
  userOverride?: WorkAgentUserOverride | null;
  providers?: ProviderPublic[];
}

export async function resolveWorkAgentBinding(
  agent: WorkAgentDefinition | null,
  chat: Chat,
  defaults: GlobalBindingDefaults,
  options?: ResolveWorkAgentBindingOptions,
): Promise<WorkAgentBinding> {
  const override = options?.userOverride;
  const agentId = agent?.id ?? 'default';

  let providerId =
    override?.providerId !== undefined
      ? override.providerId
      : agent?.providerId ?? null;
  let modelId =
    override?.modelId !== undefined ? override.modelId : agent?.modelId ?? null;

  if (providerId === null || providerId === '') {
    providerId = chat.providerId ?? defaults.providerId;
  }
  if (modelId === null || modelId === '') {
    modelId = chat.modelId || defaults.modelId;
  }

  if (!modelId) {
    throw new WorkAgentConfigError('No model selected for this chat');
  }

  if (providerId === 'minnow-router' || isLibraryModelBinding(providerId, modelId)) {
    return {
      agentId,
      providerId,
      modelId,
      baseUrl: '',
      headers: {},
    };
  }

  const providers =
    options?.providers ?? (await listProviders()).providers;
  const registryProviderId = resolveUpstreamProviderId(providerId, modelId);
  const provider = providers.find(
    (p) => p.id === registryProviderId && p.enabled !== false,
  );

  if (!provider) {
    throw new WorkAgentConfigError(`Unknown provider id: ${providerId}`);
  }

  const baseUrl = '';
  const headers: Record<string, string> = {};

  return {
    agentId,
    providerId,
    modelId,
    baseUrl,
    headers,
  };
}
