import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveAgentCliBin, resolveWindowsCmdShim } from '../../server/generations/agent-cli/resolve-bin.js';

test('Windows npm command shims become shell-free Node script invocations', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-agent-cli-shim-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const script = path.join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  const shim = path.join(root, 'codex.cmd');
  await fs.mkdir(path.dirname(script), { recursive: true });
  await fs.writeFile(script, 'process.stdout.write("ok")', 'utf8');
  await fs.writeFile(
    shim,
    '@IF EXIST "%~dp0\\node.exe" (\r\n' +
      '  "%~dp0\\node.exe" "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n' +
      ') ELSE (\r\n' +
      '  node "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n' +
      ')\r\n',
    'utf8',
  );

  const resolved = await resolveWindowsCmdShim(shim);
  assert.equal(resolved.command, process.execPath);
  assert.deepEqual(resolved.argsPrefix, [script]);
  assert.equal(resolved.display, shim);
});

test('Windows PATH discovery skips npm POSIX launchers and unwraps its command shim', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-agent-cli-path-'));
  const original = process.env.PATH;
  t.after(async () => { process.env.PATH = original; await fs.rm(root, { recursive: true, force: true }); });
  const script = path.join(root, 'cli.mjs');
  await fs.writeFile(script, '// fixture');
  await fs.writeFile(path.join(root, 'minnow-test-cli'), '#!/bin/sh\n');
  await fs.writeFile(path.join(root, 'minnow-test-cli.cmd'), 'node "%~dp0\\cli.mjs" %*\r\n');
  process.env.PATH = `${root}${path.delimiter}${original}`;
  const resolved = await resolveAgentCliBin({ kind: 'codex', binPath: 'minnow-test-cli' });
  assert.equal(resolved.command, process.execPath);
  assert.deepEqual(resolved.argsPrefix, [script]);
});
