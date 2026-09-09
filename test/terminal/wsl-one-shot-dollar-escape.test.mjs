/**
 * Windows WSL one-shot `$` escaping for bash -c scripts.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { resolveOneShotSpawn } from '../../server/terminal/one-shot-spawn.js';
import {
  buildWslOneShotSpawn,
  escapeDollarsForWindowsWslOneShot,
  listWslDistros,
} from '../../server/terminal/wsl.js';
import {
  ensureWslOneShotSpawn,
  extractWslInnerSpawn,
  recoverCommandFromWinSpawn,
} from '../../server/terminal/sandbox/wsl-landlock.js';

describe('escapeDollarsForWindowsWslOneShot', () => {
  it('escapes bare $ so host does not expand before bash -c', () => {
    assert.equal(escapeDollarsForWindowsWslOneShot('echo $FOO'), 'echo \\$FOO');
    assert.equal(
      escapeDollarsForWindowsWslOneShot('for i in 1; do echo $i; done'),
      'for i in 1; do echo \\$i; done',
    );
  });

  it('does not double-escape already escaped dollars', () => {
    assert.equal(escapeDollarsForWindowsWslOneShot('echo \\$FOO'), 'echo \\$FOO');
    assert.equal(escapeDollarsForWindowsWslOneShot('a\\$b$c'), 'a\\$b\\$c');
  });

  it('returns empty and non-string inputs unchanged', () => {
    assert.equal(escapeDollarsForWindowsWslOneShot(''), '');
    // @ts-expect-error runtime guard
    assert.equal(escapeDollarsForWindowsWslOneShot(null), null);
  });
});

describe('buildWslOneShotSpawn dollar escape (win32)', () => {
  it('embeds escaped script in bash -c on Windows', () => {
    if (process.platform !== 'win32') return;
    const spawn = buildWslOneShotSpawn({ command: 'echo $HOME' });
    const cIdx = spawn.args.indexOf('-c');
    assert.ok(cIdx >= 0);
    assert.equal(spawn.args[cIdx + 1], 'echo \\$HOME');
  });
});

describe('ensureWslOneShotSpawn preserves escaped scripts', () => {
  it('keeps an existing wsl.exe argv unchanged', () => {
    const existing = buildWslOneShotSpawn({ command: 'echo $VAR' });
    const ensured = ensureWslOneShotSpawn(existing, { distro: 'Ubuntu' });
    assert.deepEqual(ensured.args, existing.args);
  });

  it('recovers bash -c script from wsl including escapes', () => {
    const script = 'echo \\$HOME';
    const wsl = {
      command: 'wsl.exe',
      args: ['--', 'bash', '-l', '-c', script],
    };
    const recovered = recoverCommandFromWinSpawn(wsl);
    assert.equal(recovered.command, script);
    assert.deepEqual(recovered.args, []);

    const rebuilt = ensureWslOneShotSpawn(wsl, { distro: 'Ubuntu' });
    const inner = extractWslInnerSpawn(rebuilt);
    assert.deepEqual(inner?.args, ['-l', '-c', script]);
  });

  it('routes cmd.exe one-shots through WSL with escaped dollars on win32', () => {
    const resolved = resolveOneShotSpawn({
      command: 'echo $HOME',
      args: [],
      platform: 'win32',
    });
    const wsl = ensureWslOneShotSpawn(resolved, { distro: 'Ubuntu' });
    const inner = extractWslInnerSpawn(wsl);
    assert.ok(inner);
    const cIdx = inner.args.indexOf('-c');
    assert.ok(cIdx >= 0);
    if (process.platform === 'win32') {
      assert.equal(inner.args[cIdx + 1], 'echo \\$HOME');
    } else {
      assert.equal(inner.args[cIdx + 1], 'echo $HOME');
    }
  });
});

function wslLiveReady() {
  if (process.platform !== 'win32') return false;
  try {
    const probeList = spawnSync('wsl.exe', ['-l', '-q'], { timeout: 10_000, encoding: 'utf8' });
    if (probeList.status !== 0) return false;
    const probe = spawnSync('wsl.exe', ['--', 'bash', '-lc', 'test -n "$HOME"'], {
      timeout: 10_000,
    });
    return probe.status === 0;
  } catch {
    return false;
  }
}

describe('WSL live dollar expansion (win32)', () => {
  it('bash -c sees $HOME via escaped one-shot spawn', { skip: !wslLiveReady() }, () => {
    const { defaultDistro } = listWslDistros();
    const spawn = buildWslOneShotSpawn({
      command: 'echo $HOME',
      distro: defaultDistro ?? undefined,
    });
    const result = spawnSync(spawn.command, spawn.args, {
      encoding: 'utf8',
      timeout: 30_000,
      cwd: spawn.cwd,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = String(result.stdout).trim();
    assert.ok(line.startsWith('/'), `expected WSL home path, got: ${line}`);
  });
});
