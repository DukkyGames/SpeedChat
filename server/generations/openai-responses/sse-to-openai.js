/**
 * Translate OpenAI Responses SSE into OpenAI chat-completion SSE chunks.
 * The rest of Minnow (runTurn, SPA) only understands Chat Completions deltas.
 */

import {
  createOpenAiSseEncoder,
  encodeOpenAiSseDone,
  encodeUsageSseChunk,
} from '../anthropic/openai-sse-encoder.js';

/**
 * @param {string} block
 * @returns {{ event: string, data: string }}
 */
function parseSseBlock(block) {
  let event = '';
  const dataLines = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  return { event, data: dataLines.join('\n') };
}

/**
 * Incremental translator: feed Responses SSE text, emit OpenAI SSE strings.
 *
 * @returns {{
 *   push: (text: string) => string[],
 *   finish: () => string[],
 * }}
 */
export function createResponsesSseTranslator() {
  const encoder = createOpenAiSseEncoder();
  /** @type {Map<string, string>} item id → call_id */
  const callIdByItemId = new Map();
  let buffer = '';
  let sawToolCall = false;
  let emittedFinish = false;
  let closed = false;

  /**
   * @param {string} type
   * @param {Record<string, unknown>} data
   * @returns {string | null}
   */
  function handleEvent(type, data) {
    switch (type) {
      case 'response.output_text.delta': {
        const text = typeof data.delta === 'string' ? data.delta : '';
        if (!text) return null;
        return encoder.encodeStreamPart({ type: 'text-delta', text });
      }
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta': {
        const text = typeof data.delta === 'string' ? data.delta : '';
        if (!text) return null;
        return encoder.encodeStreamPart({ type: 'reasoning-delta', text });
      }
      case 'response.output_item.added': {
        const item = data.item && typeof data.item === 'object' ? data.item : null;
        if (!item || item.type !== 'function_call') return null;
        const itemId = typeof item.id === 'string' ? item.id : '';
        const callId =
          (typeof item.call_id === 'string' && item.call_id.trim()) ||
          itemId ||
          '';
        const name = typeof item.name === 'string' ? item.name : '';
        if (!callId || !name) return null;
        if (itemId) callIdByItemId.set(itemId, callId);
        sawToolCall = true;
        return encoder.encodeStreamPart({
          type: 'tool-input-start',
          id: callId,
          toolName: name,
        });
      }
      case 'response.function_call_arguments.delta': {
        const itemId = typeof data.item_id === 'string' ? data.item_id : '';
        const callId =
          callIdByItemId.get(itemId) ||
          (typeof data.call_id === 'string' ? data.call_id : '') ||
          itemId;
        const delta = typeof data.delta === 'string' ? data.delta : '';
        if (!callId || !delta) return null;
        if (!callIdByItemId.has(itemId) && itemId) {
          // Arguments can arrive before output_item.added on some gateways.
          callIdByItemId.set(itemId, callId);
          sawToolCall = true;
        }
        return encoder.encodeStreamPart({
          type: 'tool-input-delta',
          id: callId,
          delta,
        });
      }
      case 'response.completed': {
        if (emittedFinish) return null;
        emittedFinish = true;
        const response = data.response && typeof data.response === 'object' ? data.response : data;
        const usageRaw = response.usage && typeof response.usage === 'object' ? response.usage : undefined;
        const finishReason = sawToolCall ? 'tool-calls' : 'stop';
        const usage = usageRaw
          ? {
              inputTokens: usageRaw.input_tokens,
              outputTokens: usageRaw.output_tokens,
              totalTokens: usageRaw.total_tokens,
            }
          : undefined;
        return encodeUsageSseChunk(usage, finishReason);
      }
      case 'response.failed':
      case 'error': {
        const err = data.error && typeof data.error === 'object' ? data.error : data;
        const message =
          (typeof err.message === 'string' && err.message.trim()) ||
          (typeof data.message === 'string' && data.message.trim()) ||
          'Responses stream error';
        throw new Error(message);
      }
      default:
        return null;
    }
  }

  /**
   * @param {string} block
   * @returns {string | null}
   */
  function processBlock(block) {
    const trimmed = block.trim();
    if (!trimmed) return null;
    const { event, data } = parseSseBlock(trimmed);
    if (!data || data === '[DONE]') return null;
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const type =
      (typeof parsed.type === 'string' && parsed.type) ||
      event ||
      '';
    if (!type) return null;
    return handleEvent(type, parsed);
  }

  return {
    /**
     * @param {string} text
     * @returns {string[]}
     */
    push(text) {
      if (closed) return [];
      buffer += text;
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? '';
      /** @type {string[]} */
      const out = [];
      for (const block of parts) {
        const encoded = processBlock(block);
        if (encoded) out.push(encoded);
      }
      return out;
    },
    /**
     * Flush leftover SSE and always close with [DONE] so the runner settles.
     * @returns {string[]}
     */
    finish() {
      if (closed) return [];
      closed = true;
      /** @type {string[]} */
      const out = [];
      if (buffer.trim()) {
        const encoded = processBlock(buffer);
        if (encoded) out.push(encoded);
        buffer = '';
      }
      if (!emittedFinish) {
        emittedFinish = true;
        out.push(encodeUsageSseChunk(undefined, sawToolCall ? 'tool-calls' : 'stop'));
      }
      out.push(encodeOpenAiSseDone());
      return out;
    },
  };
}
