# Gitmoji in source-control history

## Problem

History (sidebar git panel and Source Control Center) renders the raw git subject. Commits that store Unicode gitmoji (✨) show an emoji. Commits that store gitmoji.dev colon codes (`:sparkles:`) show the literal shortcode, so most recent agent commits look broken.

## Approach

- Expand known gitmoji shortcodes to Unicode when **displaying** commit subjects (existing history stays as committed).
- Expand the same codes when **writing** new commits through Minnow (`/api/git` commit, `git_commit` tool, AI commit-message sanitize) so GitHub and other clients also show the glyph.
- Tell generators and skills to emit Unicode, never `:code:` prefixes.

Do **not** rewrite existing git history.

## Todos

- [x] Shared `expandGitmojiShortcodes` map (official gitmoji.dev codes)
- [x] History graph, PR commit list, tool git-log rows, commit diff title, copy/capture
- [x] Normalize on commit write (git-ops + `git_commit` tool)
- [x] AI commit prompt + `/git-commit` / fix-ci skills
- [x] Tests + `documentation/context.md`
