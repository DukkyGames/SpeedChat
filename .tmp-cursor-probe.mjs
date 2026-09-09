import fs from 'node:fs';

const text = fs.readFileSync(
  'C:/Users/dukky/AppData/Local/cursor-agent/versions/2026.09.08-6caf4ff/index.js',
  'utf8',
);

function dump(label, idx, before = 400, after = 800) {
  console.log(`\n======== ${label} @ ${idx} ========`);
  console.log(text.slice(Math.max(0, idx - before), Math.min(text.length, idx + after)));
}

dump('CURSOR_CONFIG_DIR', text.indexOf('CURSOR_CONFIG_DIR'), 200, 1200);
dump('auth.json win32', text.indexOf('AppData","Roaming"'), 600, 1500);
dump('build-prompt', text.indexOf('./src/commands/build-prompt.ts'), 0, 2500);
dump('list-models option', text.indexOf('--list-models'), 200, 400);
