/**
 * MIN-729: one `read()` of many SSE `\n\n` blocks must yield so the event loop
 * can run. Events are not dropped.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  SSE_BLOCKS_PER_YIELD,
  subscribeToGenerationRaw,
} from '../../src/api/generations.ts';

const originalFetch = globalThis.fetch;
const originalScheduler = (globalThis as { scheduler?: unknown }).scheduler;

afterEach(() => {
  globalThis.fetch = originalFetch;
  const g = globalThis as { scheduler?: unknown };
  if (originalScheduler === undefined) {
    delete g.scheduler;
  } else {
    g.scheduler = originalScheduler;
  }
});

function sseBlock(n: number): string {
  return `data: {"n":${n}}\n\n`;
}

function mockStreamFetch(chunks: Uint8Array[]): void {
  globalThis.fetch = (async () => {
    let index = 0;
    const reader = {
      read: async () => {
        if (index >= chunks.length) return { done: true as const, value: undefined };
        const value = chunks[index];
        index += 1;
        return { done: false as const, value };
      },
    };
    return {
      ok: true,
      status: 200,
      body: { getReader: () => reader },
    } as unknown as Response;
  }) as typeof fetch;
}

function mockStreamFetchConnections(connections: Uint8Array[][]): () => number {
  let connection = 0;
  globalThis.fetch = (async () => {
    const chunks = connections[Math.min(connection, connections.length - 1)] ?? [];
    connection += 1;
    let index = 0;
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (index >= chunks.length) return { done: true as const, value: undefined };
            const value = chunks[index];
            index += 1;
            return { done: false as const, value };
          },
        }),
      },
    } as unknown as Response;
  }) as typeof fetch;
  return () => connection;
}

async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 2000) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await Promise.resolve();
  }
}

describe('SSE subscribe yield (MIN-729)', () => {
  test('a single read of many blocks yields mid-burst then delivers every event', async () => {
    const total = SSE_BLOCKS_PER_YIELD * 2 + 3;
    const payload =
      Array.from({ length: total }, (_, i) => sseBlock(i)).join('') +
      'event: end\ndata: {"status":"complete"}\n\n';
    mockStreamFetch([new TextEncoder().encode(payload)]);

    const yieldWaiters: Array<() => void> = [];
    (globalThis as { scheduler?: { yield: () => Promise<void> } }).scheduler = {
      yield: () =>
        new Promise<void>((resolve) => {
          yieldWaiters.push(resolve);
        }),
    };

    const received: string[] = [];
    let ended = false;
    subscribeToGenerationRaw('gen-yield', {
      onChunk: (text) => {
        received.push(text);
      },
      onEnd: () => {
        ended = true;
      },
    });

    await waitUntil(() => yieldWaiters.length === 1, 'first SSE yield');
    assert.equal(received.length, SSE_BLOCKS_PER_YIELD);

    yieldWaiters.shift()?.();
    await waitUntil(() => yieldWaiters.length === 1, 'second SSE yield');
    assert.equal(received.length, SSE_BLOCKS_PER_YIELD * 2);

    yieldWaiters.shift()?.();
    await waitUntil(() => ended, 'stream end');
    assert.equal(received.length, total, 'every SSE block is delivered');
    assert.ok(received.every((block) => block.endsWith('\n\n')));
  });

  test('reconnects after premature EOF and skips replayed blocks', async () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    const connections = mockStreamFetchConnections([
      [encode(sseBlock(1) + sseBlock(2))],
      [
        encode(
          sseBlock(1) +
            sseBlock(2) +
            sseBlock(3) +
            'event: end\ndata: {"status":"complete"}\n\n',
        ),
      ],
    ]);
    const received: string[] = [];
    let ended = false;

    subscribeToGenerationRaw('gen-reconnect', {
      onChunk: (text) => received.push(text),
      onEnd: () => {
        ended = true;
      },
    });

    await waitUntil(() => ended, 'reconnected stream end');
    assert.equal(connections(), 2);
    assert.deepEqual(received, [sseBlock(1), sseBlock(2), sseBlock(3)]);
  });

  test('parses CRLF events split between reads', async () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    mockStreamFetch([
      encode('data: {"n":1}\r'),
      encode('\n\r\ndata: {"n":2}\r\n\r\nevent: end\r\ndata: {"status":"complete"}\r\n\r\n'),
    ]);
    const received: string[] = [];
    let ended = false;

    subscribeToGenerationRaw('gen-crlf', {
      onChunk: (text) => received.push(text),
      onEnd: () => {
        ended = true;
      },
    });

    await waitUntil(() => ended, 'CRLF stream end');
    assert.deepEqual(received, ['data: {"n":1}\n\n', 'data: {"n":2}\n\n']);
  });

  test('reports transport failure when both connections end without terminal event', async () => {
    mockStreamFetch([new TextEncoder().encode(sseBlock(1))]);
    let transportError: unknown;

    subscribeToGenerationRaw('gen-truncated', {
      onChunk: () => {},
      onTransportError: (err) => {
        transportError = err;
      },
    });

    await waitUntil(() => Boolean(transportError), 'truncated stream error');
    assert.match(String(transportError), /before the terminal event/i);
  });

  test('cancels and releases the reader after a terminal event before EOF', async () => {
    let cancelledReader = false;
    let releasedReader = false;
    let read = false;
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (read) return new Promise(() => {});
            read = true;
            return {
              done: false as const,
              value: new TextEncoder().encode(
                `${sseBlock(1)}event: end\ndata: {"status":"complete"}\n\n`,
              ),
            };
          },
          cancel: async () => {
            cancelledReader = true;
          },
          releaseLock: () => {
            releasedReader = true;
          },
        }),
      },
    })) as typeof fetch;
    let ended = false;

    subscribeToGenerationRaw('gen-reader-cleanup', {
      onChunk: () => {},
      onEnd: () => {
        ended = true;
      },
    });

    await waitUntil(
      () => ended && cancelledReader && releasedReader,
      'terminal reader cleanup',
    );
  });
});
