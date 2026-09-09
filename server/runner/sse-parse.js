import { StreamingContentAccumulator } from './message-content.js';
import {
  finalizeToolCalls,
  mergeStreamMeta,
  mergeToolCallDelta,
} from './stream-parse.js';

function normalizeSseText(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
function looksLikeHtmlErrorPage(text) {
  const head = text.trim().slice(0, 256).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.includes("<pre>internal server error</pre>");
}
function extractFirstJsonValue(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const start = trimmed[0];
  if (start !== "{" && start !== "[") return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth += 1;
      continue;
    }
    if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(0, i + 1);
      }
    }
  }
  return null;
}
function forEachJsonValueInText(text, onSlice) {
  let rest = text.trim();
  while (rest.length > 0) {
    const first = extractFirstJsonValue(rest);
    if (!first) break;
    onSlice(first);
    rest = rest.slice(first.length).trim();
  }
}
function parseOpenAiChunkPayload(payload, onChunk) {
  if (!payload || payload === "[DONE]") return;
  const trimmed = payload.trim();
  if (!trimmed) return;
  try {
    onChunk(JSON.parse(trimmed));
    return;
  } catch {
    let parsedAny = false;
    forEachJsonValueInText(trimmed, (jsonSlice) => {
      try {
        onChunk(JSON.parse(jsonSlice));
        parsedAny = true;
      } catch {
      }
    });
    if (!parsedAny) {
    }
  }
}
function parseSseEventBlock(block, onChunk) {
  const dataLines = [];
  for (const line of normalizeSseText(block).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(":")) {
      const keepalive = parseKeepaliveComment(trimmed);
      if (keepalive) {
        onChunk({
          prompt_progress: {
            processed: keepalive.processed,
            total: keepalive.total,
            cache: 0,
            time_ms: 0
          }
        });
      }
      continue;
    }
    if (trimmed.startsWith("data:")) {
      dataLines.push(trimmed.slice(5).trim());
    }
  }
  if (!dataLines.length) return;
  const payload = dataLines.join("\n");
  parseOpenAiChunkPayload(payload, onChunk);
}
function parseKeepaliveComment(line) {
  const match = /^:\s*keepalive\s+(\d+)\s*\/\s*(\d+)\s*$/i.exec(String(line).trim());
  if (!match) return null;
  const processed = Number(match[1]);
  const total = Number(match[2]);
  if (!(processed >= 0) || !(total > 0)) return null;
  return { processed, total };
}
function createSseEventBuffer() {
  return { buffer: "" };
}
function findSseEventBoundary(text) {
  const match = /\r\n\r\n|\r\n\n|\n\r\n|\n\n|\r\r/.exec(text);
  return match ? { index: match.index, length: match[0].length } : null;
}
function feedSseEventBuffer(state, text, onChunk) {
  state.buffer += text;
  let boundary = findSseEventBoundary(state.buffer);
  while (boundary) {
    const block = state.buffer.slice(0, boundary.index);
    state.buffer = state.buffer.slice(boundary.index + boundary.length);
    if (block.trim()) {
      parseSseEventBlock(block, onChunk);
    }
    boundary = findSseEventBoundary(state.buffer);
  }
}
function flushSseEventBuffer(state, onChunk) {
  if (!state.buffer.trim()) {
    state.buffer = "";
    return;
  }
  parseSseEventBlock(state.buffer, onChunk);
  state.buffer = "";
}
function completionChunkHasAssistantMessage(chunk) {
  const msg = chunk.choices?.[0]?.message;
  if (!msg) return false;
  return msg.content != null || msg.parsed != null || msg.reasoning != null || msg.reasoning_content != null || msg.refusal != null || Array.isArray(msg.tool_calls);
}
function aggregateStreamingCompletion(chunks) {
  const content = new StreamingContentAccumulator();
  let toolCalls = {};
  let meta = {};
  let reasoning = '';
  let reasoningContent = '';
  let reasoningSignature = '';
  let sawDelta = false;

  for (const chunk of chunks) {
    const choice = chunk?.choices?.[0];
    if (choice?.delta) {
      sawDelta = true;
      content.ingestChoice(choice);
      toolCalls = mergeToolCallDelta(toolCalls, chunk);
      if (typeof choice.delta.reasoning === 'string') {
        reasoning += choice.delta.reasoning;
      }
      if (typeof choice.delta.reasoning_content === 'string') {
        reasoningContent += choice.delta.reasoning_content;
      }
      if (typeof choice.delta.reasoning_signature === 'string') {
        reasoningSignature = choice.delta.reasoning_signature;
      }
    }
    meta = mergeStreamMeta(meta, chunk);
  }

  if (!sawDelta) return null;

  const last = chunks.at(-1) ?? {};
  const lastChoice = last.choices?.[0] ?? {};
  const message = {
    role: 'assistant',
    content: content.getText(),
  };
  const finalizedTools = finalizeToolCalls(toolCalls);
  if (finalizedTools.length > 0) message.tool_calls = finalizedTools;
  if (reasoning) message.reasoning = reasoning;
  if (reasoningContent) message.reasoning_content = reasoningContent;
  if (reasoningSignature) message.reasoning_signature = reasoningSignature;

  const result = {
    ...last,
    choices: [
      {
        ...lastChoice,
        delta: undefined,
        message,
        finish_reason: meta.finish_reason ?? lastChoice.finish_reason ?? null,
      },
    ],
  };
  if (meta.stats) result.stats = meta.stats;
  if (meta.usage) result.usage = meta.usage;
  if (meta.model_info) result.model_info = meta.model_info;
  if (meta.model) result.model = meta.model;
  if (meta.timings) result.timings = meta.timings;
  if (meta.prompt_progress) result.prompt_progress = meta.prompt_progress;
  if (meta.error) result.error = meta.error;
  return result;
}
function selectBestCompletionChunk(last, lastWithMessage, chunks) {
  if (lastWithMessage) return lastWithMessage;
  const aggregated = aggregateStreamingCompletion(chunks);
  if (aggregated) return aggregated;
  return last;
}
function parseCompletionResponseBody(text) {
  const normalized = normalizeSseText(text).trim();
  if (!normalized) {
    throw new Error("Empty completion response");
  }
  if (looksLikeHtmlErrorPage(normalized)) {
    throw new Error(
      "Provider returned an HTML error page instead of JSON (check LM Studio / provider is running and the model is loaded)"
    );
  }
  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    const tryParseChunk = (slice) => {
      try {
        const parsed = JSON.parse(slice);
        if (Array.isArray(parsed)) {
          return parsed[parsed.length - 1] ?? null;
        }
        return parsed;
      } catch {
        return null;
      }
    };
    const direct = tryParseChunk(normalized);
    if (direct) return direct;
    const gluedChunks = [];
    let lastGlued = null;
    let lastWithMessage2 = null;
    forEachJsonValueInText(normalized, (jsonSlice) => {
      const chunk = tryParseChunk(jsonSlice);
      if (!chunk) return;
      gluedChunks.push(chunk);
      lastGlued = chunk;
      if (completionChunkHasAssistantMessage(chunk)) {
        lastWithMessage2 = chunk;
      }
    });
    const glued = selectBestCompletionChunk(lastGlued, lastWithMessage2, gluedChunks);
    if (glued) return glued;
  }
  let last = null;
  let lastWithMessage = null;
  const chunks = [];
  const state = createSseEventBuffer();
  const trackCompletionChunk = (chunk) => {
    chunks.push(chunk);
    last = chunk;
    if (completionChunkHasAssistantMessage(chunk)) {
      lastWithMessage = chunk;
    }
  };
  feedSseEventBuffer(state, normalized, trackCompletionChunk);
  flushSseEventBuffer(state, trackCompletionChunk);
  const selected = selectBestCompletionChunk(last, lastWithMessage, chunks);
  if (selected) return selected;
  const preview = normalized.length > 200 ? `${normalized.slice(0, 200)}\u2026` : normalized;
  throw new Error(
    `Could not parse completion response (body preview: ${preview.replace(/\s+/g, " ").trim()})`
  );
}
function parseSsePayloads(text, onChunk) {
  const state = createSseEventBuffer();
  feedSseEventBuffer(state, `${normalizeSseText(text)}

`, onChunk);
  flushSseEventBuffer(state, onChunk);
}
export {
  createSseEventBuffer,
  extractFirstJsonValue,
  feedSseEventBuffer,
  flushSseEventBuffer,
  forEachJsonValueInText,
  looksLikeHtmlErrorPage,
  normalizeSseText,
  parseCompletionResponseBody,
  parseKeepaliveComment,
  parseSseEventBlock,
  parseSsePayloads
};
