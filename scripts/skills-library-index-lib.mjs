import {
  defaultSkillLabel,
  parseSkillFrontmatter,
} from '../server/skills/parse-frontmatter.js';

const SKILL_MD_SUFFIX = '/SKILL.md';

/**
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  const pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOB_DOUBLE_STAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOB_DOUBLE_STAR\}\}/g, '.*');
  return new RegExp(`^${pattern}$`);
}

/**
 * @param {string} repoPath
 * @param {string[]} globs
 * @returns {boolean}
 */
export function pathMatchesSkillsGlobs(repoPath, globs) {
  return globs.some((glob) => globToRegExp(glob).test(repoPath));
}

/**
 * @param {string} repoPath
 * @returns {boolean}
 */
export function isCanonicalSkillMdPath(repoPath) {
  return repoPath.endsWith(SKILL_MD_SUFFIX);
}

/**
 * @param {string} skillMdPath repo-relative SKILL.md path
 * @returns {string}
 */
export function skillSubpathFromSkillMd(skillMdPath) {
  return skillMdPath.slice(0, -SKILL_MD_SUFFIX.length);
}

/**
 * @param {string} skillMdPath
 * @returns {string}
 */
export function defaultSkillIdFromPath(skillMdPath) {
  const subpath = skillSubpathFromSkillMd(skillMdPath);
  const segments = subpath.split('/');
  return segments[segments.length - 1] ?? subpath;
}

/**
 * @param {Array<{ path: string }>} treeEntries
 * @param {string[]} skillsGlobs
 * @returns {string[]}
 */
export function findSkillMdPaths(treeEntries, skillsGlobs) {
  return treeEntries
    .map((entry) => entry.path)
    .filter((repoPath) => isCanonicalSkillMdPath(repoPath))
    .filter((repoPath) => pathMatchesSkillsGlobs(repoPath, skillsGlobs))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * @param {string} raw SKILL.md source
 * @param {string} skillMdPath
 * @param {{ skillId?: string }} [options]
 * @returns {{ skillId: string, label: string, description: string, subpath: string }}
 */
export function parseSkillIndexEntry(raw, skillMdPath, options = {}) {
  const { meta } = parseSkillFrontmatter(raw);
  const skillId = options.skillId?.trim() || meta.name.trim() || defaultSkillIdFromPath(skillMdPath);
  return {
    skillId,
    label: meta.label?.trim() || defaultSkillLabel(skillId),
    description: meta.description.trim(),
    subpath: skillSubpathFromSkillMd(skillMdPath),
  };
}

/**
 * @param {string} packId
 * @param {string} commit
 * @param {Array<{ skillMdPath: string, raw: string, skillId?: string }>} skillFiles
 * @returns {{ packId: string, commit: string, skills: Array<{ skillId: string, label: string, description: string, subpath: string }> }}
 */
export function buildPackIndex(packId, commit, skillFiles) {
  const skills = skillFiles.map(({ skillMdPath, raw, skillId }) =>
    parseSkillIndexEntry(raw, skillMdPath, { skillId }),
  );
  skills.sort((a, b) => a.label.localeCompare(b.label));
  return {
    packId,
    commit,
    skills,
  };
}

/**
 * @param {Record<string, string>} upstreamPathToInstallId keyed by skills/<category>/<upstreamId>
 * @param {string} subpath repo-relative skill folder path
 * @returns {string | undefined}
 */
export function resolveMattPocockInstallId(upstreamPathToInstallId, subpath) {
  return upstreamPathToInstallId[subpath];
}
