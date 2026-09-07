/**
 * Build an @ai-sdk/anthropic provider from Minnow provider runtime metadata.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { deriveMessagesPathFromChat } from '../../../src/lib/derive-messages-path.mjs';
import { isAnthropicGatewayBaseUrl } from '../../../src/lib/anthropic-thinking-style.mjs';
import { isOpenCodeProviderBaseUrl } from '../../providers/models-dev-context.js';
import {
  createAnthropicGatewayFetch,
  sanitizeAnthropicGatewayRequestBody,
  stripAnthropicGatewayBetasFromSet,
} from './gateway-fetch.js';
import { mergeOpenCodeIdentityHeaders } from '../../providers/opencode-identity.js';

/**
 * Derive the Anthropic SDK baseURL from provider origin + messages path directory.
 * E.g. `https://opencode.ai` + `/zen/v1/messages` → `https://opencode.ai/zen/v1`.
 *
 * @param {string} baseUrl
 * @param {string} messagesPath
 * @returns {string}
 */
export function deriveAnthropicBaseUrl(baseUrl, messagesPath) {
  const normalizedBase = String(baseUrl || '').replace(/\/+$/, '');
  const path = String(messagesPath || '/v1/messages');
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  const lastSlash = withSlash.lastIndexOf('/');
  const dir = lastSlash <= 0 ? '' : withSlash.slice(0, lastSlash);
  return `${normalizedBase}${dir}`;
}

/**
 * Resolve apiKey vs authToken for createAnthropic from profile authStyle.
 * OpenCode Zen Messages expects x-api-key even when the OpenAI chat path uses Bearer.
 *
 * @param {object} profile
 * @param {object} secrets
 * @returns {{ apiKey?: string, authToken?: string }}
 */
export function buildAuthOptions(profile, secrets) {
  const apiKey = typeof secrets?.apiKey === 'string' ? secrets.apiKey.trim() : '';
  const bearerToken =
    typeof secrets?.bearerToken === 'string' ? secrets.bearerToken.trim() : '';
  const authStyle = profile?.authStyle || 'bearer';

  if (isOpenCodeProviderBaseUrl(profile?.baseUrl)) {
    const key = apiKey || bearerToken;
    if (key) {
      return { apiKey: key };
    }
    return {};
  }

  if ((authStyle === 'x-api-key' || authStyle === 'api-key') && apiKey) {
    return { apiKey };
  }

  const token = bearerToken || apiKey;
  if (token) {
    return { authToken: token };
  }

  return {};
}

/**
 * Non-auth headers merged into the Anthropic SDK client (custom + overrides).
 * @param {object} profile
 * @param {object} secrets
 * @returns {Record<string, string>}
 */
function buildCustomHeaders(profile, secrets) {
  /** @type {Record<string, string>} */
  const headers = {};

  if (profile?.customHeaders && typeof profile.customHeaders === 'object') {
    for (const [key, value] of Object.entries(profile.customHeaders)) {
      if (typeof value === 'string') {
        headers[key] = value;
      }
    }
  }

  if (secrets?.headerOverrides && typeof secrets.headerOverrides === 'object') {
    for (const [key, value] of Object.entries(secrets.headerOverrides)) {
      if (typeof value === 'string') {
        headers[key] = value;
      }
    }
  }

  return headers;
}

/**
 * Gateways (OpenCode Zen) reject structured-output betas and strict tool mode that
 * the AI SDK enables by default for Opus 4.6+.
 *
 * @param {import('@ai-sdk/anthropic').AnthropicProvider} baseProvider
 * @returns {import('@ai-sdk/anthropic').AnthropicProvider}
 */
function wrapAnthropicGatewayProvider(baseProvider) {
  /** @param {string} modelId */
  const createGatewayModel = (modelId) => {
    const model = baseProvider(modelId);
    model.config.supportsNativeStructuredOutput = false;
    model.config.supportsStrictTools = false;

    const priorTransform = model.config.transformRequestBody;
    model.config.transformRequestBody = (args, betas) => {
      const body = priorTransform ? priorTransform(args, betas) : args;
      stripAnthropicGatewayBetasFromSet(betas);
      return sanitizeAnthropicGatewayRequestBody(body);
    };

    return model;
  };

  const provider = /** @type {import('@ai-sdk/anthropic').AnthropicProvider} */ (
    Object.assign(createGatewayModel, baseProvider)
  );
  provider.languageModel = createGatewayModel;
  provider.chat = createGatewayModel;
  provider.messages = createGatewayModel;
  return provider;
}

/**
 * @param {{ profile: object, paths: object, secrets: object, openCodeSessionId?: string }} runtime
 * @returns {import('@ai-sdk/anthropic').AnthropicProvider}
 */
export function buildAnthropicProvider(runtime) {
  const { profile, paths, secrets } = runtime;
  const messagesPath =
    paths?.messagesPath || deriveMessagesPathFromChat(paths?.chatCompletionsPath);
  const baseURL = deriveAnthropicBaseUrl(profile.baseUrl, messagesPath);
  const auth = buildAuthOptions(profile, secrets);
  const headers = mergeOpenCodeIdentityHeaders(buildCustomHeaders(profile, secrets), {
    baseUrl: profile.baseUrl,
    sessionId: runtime.openCodeSessionId,
  });
  const isGateway = isAnthropicGatewayBaseUrl(profile.baseUrl);

  const baseProvider = createAnthropic({
    baseURL,
    ...auth,
    fetch: createAnthropicGatewayFetch(profile.baseUrl, globalThis.fetch, {
      sessionId: runtime.openCodeSessionId,
    }),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  });

  return isGateway ? wrapAnthropicGatewayProvider(baseProvider) : baseProvider;
}
