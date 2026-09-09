/**
 * Run Impeccable CLI (detect) or bundled scripts (live) in the active workspace.
 * Harness commands (teach, audit, shape, …) return guidance — they are not npm CLI sub-commands.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  harnessCommandGuidanceWithReference,
  isCliCommand,
  isHarnessCommand,
  isScriptCommand,
  listAcceptedRunImpeccableCommands,
  SCRIPT_COMMANDS,
} from './command-routing.js';
import { buildImpeccableSpawnEnv } from './spawn-env.js';

const IMPECCABLE_TIMEOUT_MS = 60_000;
const MAX_STDOUT_CHARS = 32_000;

/**
 * @param {string} appRoot Minnow install root (bundled impeccable package)
 * @returns {string}
 */
export function resolveBundledImpeccableCliPath(appRoot) {
  return path.join(appRoot, 'node_modules', 'impeccable', 'cli', 'bin', 'cli.js');
}

/**
 * @param {object} args
 * @param {string} args.command
 * @param {string} [args.target]
 * @param {string} appRoot Minnow install root (bundled scripts)
 * @param {string} projectRoot Active workspace
 */
export function toolRunImpeccable(args, appRoot, projectRoot) {
  const command = typeof args?.command === 'string' ? args.command.trim().toLowerCase() : '';
  const accepted = listAcceptedRunImpeccableCommands();

  if (!command) {
    return Promise.resolve({
      result: `Error: run_impeccable command must be one of: ${accepted.join(', ')}`,
    });
  }

  if (isHarnessCommand(command) && !isScriptCommand(command)) {
    return Promise.resolve({
      result: harnessCommandGuidanceWithReference(appRoot, command),
    });
  }

  if (!accepted.includes(command)) {
    return Promise.resolve({
      result: `Error: run_impeccable command must be one of: ${accepted.join(', ')}. Harness commands (teach, audit, shape, craft, …) use /impeccable <cmd> in the composer.`,
    });
  }

  const targetExplicit = typeof args?.target === 'string' && args.target.trim() !== '';
  let target = targetExplicit ? args.target.trim() : '';
  if (!targetExplicit && command === 'detect') {
    target = '.';
  }

  if (isCliCommand(command)) {
    return runBundledImpeccableCli(command, target, appRoot, projectRoot);
  }

  if (isScriptCommand(command)) {
    return runBundledScript(command, target, appRoot, projectRoot);
  }

  return Promise.resolve({
    result: `Error: unsupported run_impeccable command: ${command}`,
  });
}

/**
 * @param {string} command
 * @param {string} target
 * @param {string} appRoot
 * @param {string} projectRoot
 */
function runBundledImpeccableCli(command, target, appRoot, projectRoot) {
  const cliPath = resolveBundledImpeccableCliPath(appRoot);
  if (!fs.existsSync(cliPath)) {
    return Promise.resolve({
      result: `Error: missing Impeccable CLI at ${cliPath}. Re-run npm install in the Minnow app directory.`,
    });
  }

  const cliArgs = [cliPath, command];
  if (target) cliArgs.push(target);

  return spawnWithCapture(
    process.execPath,
    cliArgs,
    {
      cwd: projectRoot,
      env: buildImpeccableSpawnEnv(projectRoot),
    },
    command,
    projectRoot,
    'impeccable cli',
  );
}

/**
 * @param {string} command
 * @param {string} target
 * @param {string} appRoot
 * @param {string} projectRoot
 */
function runBundledScript(command, target, appRoot, projectRoot) {
  const relScript = SCRIPT_COMMANDS.get(command);
  if (!relScript) {
    return Promise.resolve({
      result: `Error: no bundled script for command: ${command}`,
    });
  }

  const scriptPath = path.join(appRoot, 'src', 'skills', 'impeccable', relScript);
  if (!fs.existsSync(scriptPath)) {
    return Promise.resolve({
      result: `Error: missing Impeccable script at ${scriptPath}. Re-run npm install in the Minnow app directory.`,
    });
  }

  const nodeArgs = [scriptPath];
  if (target) nodeArgs.push(target);

  return spawnWithCapture(
    process.execPath,
    nodeArgs,
    {
      cwd: projectRoot,
      env: buildImpeccableSpawnEnv(projectRoot),
    },
    command,
    projectRoot,
    path.basename(scriptPath),
  );
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptions} options
 * @param {string} commandLabel
 * @param {string} projectRoot
 * @param {string} spawnLabel
 */
function spawnWithCapture(cmd, args, options, commandLabel, projectRoot, spawnLabel) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, IMPECCABLE_TIMEOUT_MS);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_STDOUT_CHARS) {
        stdout = `${stdout.slice(0, MAX_STDOUT_CHARS)}\n…[truncated]`;
      }
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const relRoot = path.basename(projectRoot) === 'Minnow' ? '.' : projectRoot;
      if (timedOut) {
        resolve({
          result: `Error: run_impeccable (${commandLabel} via ${spawnLabel}) timed out after ${IMPECCABLE_TIMEOUT_MS / 1000}s (cwd ${relRoot})`,
        });
        return;
      }
      const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      const prefix =
        code === 0 ? '' : `Error: impeccable ${commandLabel} exited ${code}\n`;
      resolve({
        result: prefix + (combined || `(no output; cwd ${relRoot})`),
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        result: `Error: failed to spawn ${spawnLabel}: ${err.message}`,
      });
    });
  });
}
