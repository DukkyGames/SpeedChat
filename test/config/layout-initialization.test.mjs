import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, test } from 'node:test';
import {
  ensureMinnowLayout,
  ensureMinnowLayoutInitialized,
  resetMinnowHomeCache,
} from '../../server/config/home.js';
import { createConfigTestServer, httpRequest } from './test-helpers.js';

const savedHome = process.env.MINNOW_HOME;
let home;

afterEach(async () => {
  resetMinnowHomeCache();
  if (savedHome === undefined) delete process.env.MINNOW_HOME;
  else process.env.MINNOW_HOME = savedHome;
  if (home) await fs.rm(home, { recursive: true, force: true });
  home = undefined;
});

test('config ping reuses coalesced initialization without disabling repair calls', async () => {
  home = path.join(os.tmpdir(), `minnow-layout-initialization-${process.pid}`);
  process.env.MINNOW_HOME = home;
  resetMinnowHomeCache();

  const first = ensureMinnowLayoutInitialized();
  const concurrent = ensureMinnowLayoutInitialized();
  assert.equal(concurrent, first);
  await first;

  const marker = path.join(home, 'workspace', '.gitkeep');
  await fs.rm(marker);
  const server = createConfigTestServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const ping = await httpRequest(
    `http://127.0.0.1:${address.port}`,
    'GET',
    '/api/config/ping',
  );
  await new Promise((resolve) => server.close(resolve));
  assert.equal(ping.status, 200);
  await assert.rejects(fs.access(marker));

  await ensureMinnowLayout();
  await fs.access(marker);

  await fs.rm(marker);
  resetMinnowHomeCache();
  await ensureMinnowLayoutInitialized();
  await fs.access(marker);
});

test('failed startup layout initialization can be retried', async () => {
  home = path.join(os.tmpdir(), `minnow-layout-retry-${process.pid}`);
  await fs.rm(home, { recursive: true, force: true });
  await fs.writeFile(home, 'blocks directory creation', 'utf8');
  process.env.MINNOW_HOME = home;
  resetMinnowHomeCache();

  await assert.rejects(ensureMinnowLayoutInitialized());
  await fs.rm(home, { force: true });
  assert.equal(await ensureMinnowLayoutInitialized(), home);
});
