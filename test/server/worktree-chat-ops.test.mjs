/**
 * Per-chat worktree server ops (MIN-276).
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { after, before, describe, test } from 'node:test';
import { getChatWorktreePath } from '../../server/worktree/paths.js';
import {
  createChatWorktree,
  removeChatWorktree,
} from '../../server/worktree/worktree-ops.js';
import { setWorkspaceRoot } from '../../server/workspace/root.js';

const execFileAsync = promisify(execFile);
const CHAT_ID = 'chat-test-276-aaaa';

describe('chat worktree ops', () => {
  let repoDir;
  let minnowHome;

  before(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-chat-wt-'));
    repoDir = path.join(root, 'repo');
    minnowHome = path.join(root, 'minnow-home');
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(minnowHome, { recursive: true });
    process.env.MINNOW_HOME = minnowHome;
    await setWorkspaceRoot(repoDir);

    await execFileAsync('git', ['init'], { cwd: repoDir, windowsHide: true });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repoDir,
      windowsHide: true,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repoDir, windowsHide: true });
    await fs.writeFile(path.join(repoDir, 'README.md'), '# base\n', 'utf8');
    await execFileAsync('git', ['add', 'README.md'], { cwd: repoDir, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repoDir, windowsHide: true });
  });

  after(async () => {
    delete process.env.MINNOW_HOME;
  });

  test('createChatWorktree slugifies invalid branch names', async () => {
    const chatId = 'chat-min-659-slug';
    const created = await createChatWorktree({
      chatId,
      branch: 'Test Worktree',
    });
    assert.equal(created.ok, true);
    assert.equal(created.branch, 'test-worktree');
    const removed = await removeChatWorktree({ chatId });
    assert.equal(removed.ok, true);
  });

  test('createChatWorktree creates a managed slot under MINNOW_HOME', async () => {
    const branch = 'minnow/chat/test-branch';
    const created = await createChatWorktree({ chatId: CHAT_ID, branch });
    assert.equal(created.ok, true);
    assert.equal(created.created, true);
    assert.equal(created.path, getChatWorktreePath(CHAT_ID));
    await fs.access(created.path);
  });

  test('createChatWorktree starts a new branch from baseRef instead of HEAD', async () => {
    const chatId = 'chat-base-ref-aaaa';
    await execFileAsync('git', ['checkout', '-b', 'chat-base-src'], {
      cwd: repoDir,
      windowsHide: true,
    });
    await fs.writeFile(path.join(repoDir, 'chat-base-only.txt'), 'from-base\n', 'utf8');
    await execFileAsync('git', ['add', 'chat-base-only.txt'], { cwd: repoDir, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'chat base src'], {
      cwd: repoDir,
      windowsHide: true,
    });
    try {
      await execFileAsync('git', ['checkout', 'main'], { cwd: repoDir, windowsHide: true });
    } catch {
      await execFileAsync('git', ['checkout', 'master'], { cwd: repoDir, windowsHide: true });
    }

    const created = await createChatWorktree({
      chatId,
      branch: 'chat-from-base',
      baseRef: 'chat-base-src',
    });
    assert.equal(created.ok, true);
    assert.equal(created.created, true);
    const marker = await fs.readFile(path.join(created.path, 'chat-base-only.txt'), 'utf8');
    assert.match(marker, /from-base/);
    await assert.rejects(() => fs.access(path.join(repoDir, 'chat-base-only.txt')));

    const removed = await removeChatWorktree({ chatId });
    assert.equal(removed.ok, true);
  });

  test('createChatWorktree is idempotent for an existing slot', async () => {
    const again = await createChatWorktree({
      chatId: CHAT_ID,
      branch: 'minnow/chat/test-branch',
    });
    assert.equal(again.ok, true);
    assert.equal(again.created, false);
  });

  test('removeChatWorktree removes the managed slot', async () => {
    const removed = await removeChatWorktree({ chatId: CHAT_ID });
    assert.equal(removed.ok, true);
    assert.equal(removed.removed, true);
    await assert.rejects(() => fs.access(getChatWorktreePath(CHAT_ID)));
  });
});
