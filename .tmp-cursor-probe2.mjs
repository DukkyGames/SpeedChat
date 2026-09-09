import fs from 'node:fs';

const text = fs.readFileSync(
  'C:/Users/dukky/AppData/Local/cursor-agent/versions/2026.09.08-6caf4ff/5074.index.js',
  'utf8',
);

function dump(label, needle, before = 200, after = 1800) {
  const idx = text.indexOf(needle);
  console.log(`\n======== ${label} @ ${idx} ========`);
  if (idx < 0) return;
  console.log(text.slice(Math.max(0, idx - before), Math.min(text.length, idx + after)));
}

dump('build-prompt function', '"./src/commands/build-prompt.ts"', 0, 2200);
dump('stdin read', 'process.stdin.isTTY', 100, 400);
dump('auth file path', 'auth.json', 400, 600);
