#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILLS_LIBRARY_PACKS } from '../src/skills/library/registry.ts';
import {
  buildPackIndex,
  findSkillMdPaths,
  resolveMattPocockInstallId,
} from './skills-library-index-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const INDEX_DIR = path.join(PROJECT_ROOT, 'src/skills/library/index');
const MATT_POCOCK_CATALOG_FILE = path.join(
  __dirname,
  'matt-pocock-preserves/skill-catalog.json',
);
const GITHUB_USER_AGENT = 'minnow-skills-library-index';
const STRICT = process.env.SKILLS_LIBRARY_INDEX_STRICT === '1';

/**
 * @param {string} message
 */
function warn(message) {
  console.warn(`[skills-library:index] ${message}`);
}

/**
 * @param {string} message
 */
function fail(message) {
  if (STRICT) {
    console.error(`[skills-library:index] ${message}`);
    process.exit(1);
  }
  warn(`${message} (non-strict; set SKILLS_LIBRARY_INDEX_STRICT=1 to fail CI)`);
}

/**
 * @param {string} repo owner/repo
 * @param {string} commit
 * @returns {Promise<Array<{ path: string }>>}
 */
async function fetchRepoTree(repo, commit) {
  const url = `https://api.github.com/repos/${repo}/git/trees/${commit}?recursive=1`;
  const res = await fetch(url, { headers: { 'User-Agent': GITHUB_USER_AGENT } });
  if (!res.ok) {
    throw new Error(`GitHub tree failed for ${repo}@${commit.slice(0, 7)} (${res.status})`);
  }
  const data = await res.json();
  if (!Array.isArray(data.tree)) {
    throw new Error(`Unexpected tree payload for ${repo}`);
  }
  return data.tree;
}

/**
 * @param {string} repo
 * @param {string} commit
 * @param {string} skillMdPath
 * @returns {Promise<string>}
 */
async function fetchSkillMdRaw(repo, commit, skillMdPath) {
  const rawUrl = `https://raw.githubusercontent.com/${repo}/${commit}/${skillMdPath}`;
  const res = await fetch(rawUrl, { headers: { 'User-Agent': GITHUB_USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${skillMdPath} (${res.status})`);
  }
  return res.text();
}

/**
 * @returns {Record<string, string>}
 */
async function loadMattPocockInstallIds() {
  const catalog = JSON.parse(await fs.readFile(MATT_POCOCK_CATALOG_FILE, 'utf8'));
/** @type {Record<string, string>} */
  const map = {};
  for (const entry of catalog.skills) {
    map[`skills/${entry.category}/${entry.upstreamId}`] = entry.id;
  }
  return map;
}

/**
 * @param {import('../src/skills/library/registry.ts').SkillsLibraryPack} pack
 * @returns {Promise<{ packId: string, commit: string, skills: Array<{ skillId: string, label: string, description: string, subpath: string }> }>}
 */
async function generatePackIndex(pack) {
  const { repo, commit, skillsGlobs } = pack.source;
  const tree = await fetchRepoTree(repo, commit);
  const skillMdPaths = findSkillMdPaths(tree, skillsGlobs);

  if (skillMdPaths.length === 0) {
    throw new Error(`No SKILL.md files matched for pack ${pack.id}`);
  }

  const mattPocockIds =
    pack.postInstallPatch === 'matt-pocock' ? await loadMattPocockInstallIds() : null;

/** @type {Array<{ skillMdPath: string, raw: string, skillId?: string }>} */
  const skillFiles = [];
  for (const skillMdPath of skillMdPaths) {
    const raw = await fetchSkillMdRaw(repo, commit, skillMdPath);
    const subpath = skillMdPath.replace(/\/SKILL\.md$/, '');
    const installId = mattPocockIds
      ? resolveMattPocockInstallId(mattPocockIds, subpath)
      : undefined;
    skillFiles.push({
      skillMdPath,
      raw,
      skillId: installId,
    });
  }

  return buildPackIndex(pack.id, commit, skillFiles);
}

async function main() {
  await fs.mkdir(INDEX_DIR, { recursive: true });

  for (const pack of SKILLS_LIBRARY_PACKS) {
    const outFile = path.join(INDEX_DIR, `${pack.id}.json`);
    try {
      const index = await generatePackIndex(pack);
      await fs.writeFile(outFile, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
      console.log(
        `[skills-library:index] ${pack.id} → ${index.skills.length} skills @ ${pack.source.commit.slice(0, 7)}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (await fileExists(outFile)) {
        fail(`Skipped ${pack.id}: ${message}; keeping existing ${path.relative(PROJECT_ROOT, outFile)}`);
        continue;
      }
      fail(`Failed ${pack.id}: ${message}`);
    }
  }
}

/**
 * @param {string} filePath
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
