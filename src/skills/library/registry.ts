/**
 * Curated Skills Library pack registry (MIN-474).
 * Packs are commit-pinned for reproducible browse/install.
 */

/** Trust tier shown in Settings → Skills Library. */
export type SkillsLibraryTrust = 'official' | 'community';

/** Remote pack source pinned to a specific commit. */
export interface SkillsLibraryPackSource {
  /** GitHub owner/repo slug (e.g. mattpocock/skills). */
  repo: string;
  /** Full 40-char commit SHA — never a floating branch ref. */
  commit: string;
  /** Glob patterns for locating SKILL.md files within the repo tree. */
  skillsGlobs: string[];
}

/** One curated third-party skill pack in the Skills Library. */
export interface SkillsLibraryPack {
  id: string;
  label: string;
  description: string;
  publisher: string;
  trust: SkillsLibraryTrust;
  source: SkillsLibraryPackSource;
  /** Optional user-facing note about runtime prerequisites. */
  runtimeNote?: string;
  /** Post-install patch hook id (e.g. Minnow adaptations for Matt Pocock). */
  postInstallPatch?: string;
}

/** Offline browse row for a skill inside a pack index. */
export interface SkillsLibraryIndexSkill {
  skillId: string;
  label: string;
  description: string;
  /** Repo-relative path to the skill folder (parent of SKILL.md). */
  subpath: string;
}

/** Prebuilt, commit-pinned index shipped with the app for offline browse. */
export interface SkillsLibraryPackIndex {
  packId: string;
  commit: string;
  skills: SkillsLibraryIndexSkill[];
}

export {
  SKILLS_LIBRARY_PACKS,
  SKILLS_LIBRARY_PACK_IDS,
  getSkillsLibraryPack,
  listSkillsLibraryPacks,
} from './registry.mjs';
