/**
 * Vision cost in the context budget: images are priced by pixel count, and a
 * per-turn screenshot loop does not re-send every prior frame forever.
 *
 * Regression: a flat 256-token-per-image estimate read a 2.9 MP Retina
 * screenshot as ~1/14th its real cost, so the context wheel showed a nearly
 * empty window while the transcript was actually full — and nothing ever
 * trimmed the screenshots a browsing agent piled up one per turn.
 */

import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { describe, test } from 'node:test';
import {
  estimateApiMessageTokens,
  estimateApiMessagesTokens,
} from '../../src/chat/context-budget.ts';
import {
  ESTIMATE_IMAGE_URL_TOKENS,
  estimateImageUrlTokens,
  imageDimensionsFromDataUrl,
  PIXELS_PER_IMAGE_TOKEN,
} from '../../src/chat/prompts/token-estimate-core.ts';
import {
  MAX_LIVE_TOOL_IMAGES,
  pruneSupersededToolImages,
  TOOL_IMAGE_FOLLOW_UP_TEXT,
} from '../../src/chat/tool-image-follow-up.ts';
import type { ApiMessage } from '../../src/types.ts';

/** A real PNG of the given size (header is what the estimator reads). */
function pngDataUrl(width: number, height: number): string {
  const chunk = (type: string, body: Buffer): Buffer => {
    const head = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(head));
    return Buffer.concat([len, head, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(height * (width + 1)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

let crcTable: number[] | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function screenshotTurn(id: string, url: string): ApiMessage[] {
  return [
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id, type: 'function', function: { name: 'screenshot', arguments: '{}' } },
      ],
    },
    { role: 'tool', tool_call_id: id, content: 'captured' },
    {
      role: 'user',
      toolImageFollowUp: true,
      content: [
        { type: 'text', text: TOOL_IMAGE_FOLLOW_UP_TEXT },
        { type: 'image_url', image_url: { url, detail: 'auto' } },
      ],
    } as ApiMessage,
  ];
}

describe('image token estimate', () => {
  test('reads intrinsic size out of a PNG data URL', () => {
    assert.deepEqual(imageDimensionsFromDataUrl(pngDataUrl(2048, 1410)), {
      width: 2048,
      height: 1410,
    });
  });

  test('a Retina screenshot costs thousands of tokens, not hundreds', () => {
    const tokens = estimateImageUrlTokens(pngDataUrl(2048, 1410));
    // MTPLX measured 3,685 vision rows for exactly this capture size.
    assert.ok(tokens > 3000, `expected > 3000, got ${tokens}`);
    assert.ok(Math.abs(tokens - 3685) / 3685 < 0.1, `expected within 10% of 3685, got ${tokens}`);
  });

  test('cost scales with area', () => {
    const small = estimateImageUrlTokens(pngDataUrl(512, 512));
    const big = estimateImageUrlTokens(pngDataUrl(1024, 1024));
    assert.equal(Math.round(512 * 512 / PIXELS_PER_IMAGE_TOKEN), small);
    assert.ok(big > small * 3.5, 'quadrupling pixels should roughly quadruple cost');
  });

  test('an unreadable image falls back to the flat estimate', () => {
    assert.equal(estimateImageUrlTokens('https://example.com/remote.png'), ESTIMATE_IMAGE_URL_TOKENS);
  });

  test('a message carrying an image is priced above the flat old constant', () => {
    const [, , followUp] = screenshotTurn('a', pngDataUrl(2048, 1410));
    assert.ok(estimateApiMessageTokens(followUp) > 3000);
  });
});

describe('superseded screenshot pruning', () => {
  test('keeps only the most recent screenshots', () => {
    const messages: ApiMessage[] = [];
    for (let i = 0; i < 9; i += 1) {
      messages.push(...screenshotTurn(`call-${i}`, pngDataUrl(2048, 1410)));
    }
    const before = estimateApiMessagesTokens(messages);
    const pruned = pruneSupersededToolImages(messages);

    assert.equal(pruned.droppedImages, 9 - MAX_LIVE_TOOL_IMAGES);
    assert.equal(pruned.messages.length, messages.length, 'rows stay put, only pixels drop');

    const survivors = pruned.messages.filter(
      (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'),
    );
    assert.equal(survivors.length, MAX_LIVE_TOOL_IMAGES);

    const after = estimateApiMessagesTokens(pruned.messages);
    assert.ok(after < before / 3, `expected a large drop, went ${before} -> ${after}`);
  });

  test('the surviving screenshots are the newest ones', () => {
    const urls = [pngDataUrl(100, 100), pngDataUrl(200, 200), pngDataUrl(300, 300)];
    const messages: ApiMessage[] = [];
    urls.forEach((url, i) => messages.push(...screenshotTurn(`c${i}`, url)));

    const kept = pruneSupersededToolImages(messages, 1).messages.filter(
      (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'),
    );
    assert.equal(kept.length, 1);
    const url = (kept[0].content as { type: string; image_url?: { url: string } }[]).find(
      (p) => p.type === 'image_url',
    )?.image_url?.url;
    assert.equal(url, urls[2], 'the last screenshot must survive');
  });

  test('tool call and tool result rows are left intact', () => {
    const messages: ApiMessage[] = [];
    for (let i = 0; i < 5; i += 1) {
      messages.push(...screenshotTurn(`c${i}`, pngDataUrl(800, 600)));
    }
    const pruned = pruneSupersededToolImages(messages).messages;
    const toolRows = pruned.filter((m) => m.role === 'tool');
    const callRows = pruned.filter((m) => m.role === 'assistant');
    assert.equal(toolRows.length, 5);
    assert.equal(callRows.length, 5);
    assert.ok(pruned.every((m) => m.role !== 'tool' || m.content === 'captured'));
  });

  test('a transcript under the cap is returned untouched', () => {
    const messages = screenshotTurn('only', pngDataUrl(800, 600));
    const pruned = pruneSupersededToolImages(messages);
    assert.equal(pruned.droppedImages, 0);
    assert.equal(pruned.messages, messages);
  });
});
