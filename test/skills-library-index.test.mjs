/**
 * Skills Library index builder (MIN-474) — offline unit tests with fixture tree data.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPackIndex,
  defaultSkillIdFromPath,
  findSkillMdPaths,
  isCanonicalSkillMdPath,
  parseSkillIndexEntry,
  pathMatchesSkillsGlobs,
  resolveMattPocockInstallId,
} from '../scripts/skills-library-index-lib.mjs';

const FIXTURE_SKILL_MD = `---
name: grill-me
description: Practice explaining ideas out loud with focused follow-up questions.
---

# Grill Me
`;

describe('Skills Library index builder', () => {
  it('matches canonical SKILL.md paths only', () => {
    assert.equal(isCanonicalSkillMdPath('skills/browser/SKILL.md'), true);
    assert.equal(isCanonicalSkillMdPath('skills/autobrowse/references/example-skill.md'), false);
  });

  it('filters repo tree entries by skillsGlobs', () => {
    const tree = [
      { path: 'skills/productivity/grill-me/SKILL.md' },
      { path: 'skills/engineering/ask-matt/SKILL.md' },
      { path: 'skills/deprecated/qa/SKILL.md' },
      { path: 'README.md' },
    ];

    const matches = findSkillMdPaths(tree, [
      'skills/productivity/**',
      'skills/engineering/**',
    ]);

    assert.deepEqual(matches, [
      'skills/engineering/ask-matt/SKILL.md',
      'skills/productivity/grill-me/SKILL.md',
    ]);
  });

  it('pathMatchesSkillsGlobs supports ** segments', () => {
    assert.equal(pathMatchesSkillsGlobs('skills/foo/bar/SKILL.md', ['skills/**']), true);
    assert.equal(pathMatchesSkillsGlobs('docs/foo/SKILL.md', ['skills/**']), false);
  });

  it('parses SKILL.md front matter into an index row', () => {
    const skillMdPath = 'skills/productivity/grill-me/SKILL.md';
    const entry = parseSkillIndexEntry(FIXTURE_SKILL_MD, skillMdPath);

    assert.equal(entry.skillId, 'grill-me');
    assert.equal(entry.label, 'Grill Me');
    assert.equal(entry.description, 'Practice explaining ideas out loud with focused follow-up questions.');
    assert.equal(entry.subpath, 'skills/productivity/grill-me');
    assert.equal(defaultSkillIdFromPath(skillMdPath), 'grill-me');
  });

  it('buildPackIndex sorts skills by label', () => {
    const index = buildPackIndex('fixture', 'a'.repeat(40), [
      {
        skillMdPath: 'skills/zulu/SKILL.md',
        raw: `---\nname: zulu\ndescription: Z skill\n---\n`,
      },
      {
        skillMdPath: 'skills/alpha/SKILL.md',
        raw: `---\nname: alpha\ndescription: A skill\n---\n`,
      },
    ]);

    assert.equal(index.packId, 'fixture');
    assert.equal(index.commit, 'a'.repeat(40));
    assert.equal(index.skills.length, 2);
    assert.equal(index.skills[0].skillId, 'alpha');
    assert.equal(index.skills[1].skillId, 'zulu');
    // No generatedAt timestamp — rebuilds must be byte-identical (deterministic output).
    assert.equal(index.generatedAt, undefined);
  });

  it('resolveMattPocockInstallId maps upstream paths to Minnow ids', () => {
    const map = {
      'skills/engineering/ask-matt': 'ask-minnow',
      'skills/engineering/setup-matt-pocock-skills': 'setup-minnow-skills',
    };

    assert.equal(
      resolveMattPocockInstallId(map, 'skills/engineering/ask-matt'),
      'ask-minnow',
    );
    assert.equal(
      resolveMattPocockInstallId(map, 'skills/engineering/setup-matt-pocock-skills'),
      'setup-minnow-skills',
    );
    assert.equal(resolveMattPocockInstallId(map, 'skills/productivity/grill-me'), undefined);
  });
});
