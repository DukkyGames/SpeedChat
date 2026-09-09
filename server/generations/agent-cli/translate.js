function count(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0; }
function detail(value) { return typeof value === 'string' ? value : value?.message ?? JSON.stringify(value ?? 'Agent CLI failed.'); }

export function mapAgentCliUsage(raw, kind) {
  if (!raw || typeof raw !== 'object') return undefined;
  const cached = count(raw.cache_read_input_tokens ?? raw.cached_input_tokens);
  const prompt = count(raw.input_tokens) + (kind === 'claude' ? cached + count(raw.cache_creation_input_tokens) : 0);
  const completion = count(raw.output_tokens);
  return {
    prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion,
    ...(cached ? { prompt_tokens_details: { cached_tokens: cached } } : {}),
    ...(raw.reasoning_output_tokens != null ? { completion_tokens_details: { reasoning_tokens: count(raw.reasoning_output_tokens) } } : {}),
  };
}

/** Per-invocation state prevents SDK snapshots and terminal summaries from duplicating deltas. */
export function createAgentCliTranslator(kind, emit) {
  if (!['claude', 'codex', 'cursor'].includes(kind)) throw new Error('Unsupported agent CLI.');
  let sawText = false;
  let sawReasoning = false;
  let streamedMessageText = false;
  let streamedMessageReasoning = false;
  let terminal = null;
  let usage;
  let cost;
  const completed = new Set();
  let claudeUsage = {};
  function text(value) { if (typeof value === 'string' && value) { sawText = true; emit({ content: value }); } }
  function reasoning(value) { if (typeof value === 'string' && value) { sawReasoning = true; emit({ reasoning: value }); } }
  function finish(ok, error, finishReason = 'stop') { terminal = { ok, ...(error ? { error: detail(error) } : {}), finishReason }; }
  function consume(event) {
    if (terminal) return;
    if (kind === 'claude') {
      if (event.type === 'system' && event.subtype === 'api_retry' && [401, 403].includes(event.status ?? event.status_code)) finish(false, 'Authentication failed.');
      if (event.type === 'stream_event') {
        const part = event.event ?? {};
        if (part.type === 'message_start') {
          streamedMessageText = false;
          streamedMessageReasoning = false;
          claudeUsage = { ...part.message?.usage };
          usage = mapAgentCliUsage(claudeUsage, kind);
        }
        if (part.type === 'content_block_delta') {
          if (part.delta?.type === 'text_delta') { streamedMessageText = true; text(part.delta.text); }
          if (part.delta?.type === 'thinking_delta') { streamedMessageReasoning = true; reasoning(part.delta.thinking); }
        }
        if (part.type === 'message_delta') {
          claudeUsage = { ...claudeUsage, ...part.usage };
          usage = mapAgentCliUsage(claudeUsage, kind);
        }
      }
      if (event.type === 'assistant') {
        const key = event.message?.id ?? event.uuid;
        if (key && completed.has(key)) return;
        if (key) completed.add(key);
        for (const block of event.message?.content ?? []) {
          if (block.type === 'text' && !streamedMessageText) text(block.text);
          if (block.type === 'thinking' && !streamedMessageReasoning) reasoning(block.thinking);
          if (block.type === 'tool_use' && !String(block.name).startsWith('mcp__minnow__')) emit({ forbiddenTool: block.name });
        }
        if (event.message?.usage) usage = mapAgentCliUsage(event.message.usage, kind);
      }
      if (event.type === 'result') {
        const ok = event.is_error !== true && (!event.subtype || event.subtype === 'success');
        if (!ok) { finish(false, event.errors?.join('\n') || event.error || event.result || event.subtype); return; }
        if (!sawText) text(event.structured_output != null ? JSON.stringify(event.structured_output) : event.result);
        if (event.usage) usage = mapAgentCliUsage(event.usage, kind);
        if (typeof event.total_cost_usd === 'number') cost = event.total_cost_usd;
        finish(true);
      }
      if (event.type === 'error') finish(false, event.error ?? event.message);
    } else if (kind === 'codex') {
      const item = event.item;
      if (event.type === 'item.completed' && item) {
        if (item.id && completed.has(item.id)) return;
        if (item.id) completed.add(item.id);
        if (item.type === 'agent_message') text(item.text);
        if (item.type === 'reasoning') reasoning(item.text ?? item.summary?.map(row => row.text ?? '').join('\n'));
        if (item.type === 'mcp_tool_call' && item.status === 'failed') finish(false, item.error ?? 'Minnow tool handoff failed.');
        if (['command_execution', 'file_change', 'web_search'].includes(item.type)) emit({ forbiddenTool: item.type });
      }
      if (event.type === 'turn.completed') { usage = mapAgentCliUsage(event.usage, kind); finish(true); }
      if (event.type === 'turn.failed' || event.type === 'error') finish(false, event.error ?? event.message);
    } else {
      if (event.type === 'assistant' && event.timestamp_ms != null && !event.model_call_id) {
        for (const block of event.message?.content ?? []) if (block.type === 'text') text(block.text);
      }
      if (event.type === 'result') {
        if (event.is_error === true || (event.subtype && event.subtype !== 'success')) { finish(false, event.error ?? event.result ?? event.subtype); return; }
        if (!sawText) text(event.result);
        usage = mapAgentCliUsage(event.usage, kind);
        finish(true);
      }
      if (event.type === 'error') finish(false, event.error ?? event.message);
    }
  }
  return { consume, snapshot: () => ({ terminal, usage, cost, sawText, sawReasoning }) };
}
