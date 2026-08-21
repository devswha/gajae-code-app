#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const KNOWN_FLAGS = new Set(['--help', '--json', '--live', '--strict-local']);
const flags = new Set(process.argv.slice(2));
const unknownFlags = [...flags].filter((flag) => !KNOWN_FLAGS.has(flag));

if (unknownFlags.length > 0) {
  console.error(`Unknown flag(s): ${unknownFlags.join(', ')}`);
  process.exit(2);
}

if (flags.has('--help')) {
  console.log(`Usage: node scripts/check-opencodex-cua-poc.mjs [--live] [--strict-local] [--json]

Checks the isolated OpenCodex/CUA benchmark without changing its configuration.

  --live          Run Codex text and node_repl bridge probes (uses model quota).
  --strict-local  With --live, fail when the routed local model misses its tool call.
  --json          Emit machine-readable JSON.`);
  process.exit(0);
}

const wantsJson = flags.has('--json');
const wantsLive = flags.has('--live');
const strictLocal = flags.has('--strict-local');
const pocHome = process.env.OPENCODEX_HOME || path.join(homedir(), '.opencodex-gajae-poc');
const codexHome = process.env.CODEX_HOME || path.join(homedir(), '.codex');
const codexBin = process.env.CODEX_BIN || 'codex';
const ocxBin = process.env.OPENCODEX_BIN || 'ocx';
const ollamaBin = process.env.OLLAMA_BIN || 'ollama';
const configPath = path.join(pocHome, 'config.json');
const catalogPath = path.join(codexHome, 'opencodex-catalog.json');
const checks = [];
const benchmarks = [];

function check(name, ok, detail) {
  checks.push({ detail, name, ok });
}

function benchmark(name, outcome, detail) {
  benchmarks.push({ detail, name, outcome });
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180_000,
    ...options,
  });
}

function commandVersion(command) {
  const result = run(command, ['--version']);
  return result.status === 0 ? result.stdout.trim() : null;
}

function parseCodexEvents(output) {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function completedMcpResultContains(events, marker) {
  return events.some((event) => (
    event?.type === 'item.completed'
      && event.item?.type === 'mcp_tool_call'
      && event.item?.server === 'node_repl'
      && event.item?.tool === 'js'
      && event.item?.status === 'completed'
      && JSON.stringify(event.item.result).includes(marker)
  ));
}

function completedAgentMessage(events, expected) {
  return events.some((event) => (
    event?.type === 'item.completed'
      && event.item?.type === 'agent_message'
      && event.item?.text?.trim() === expected
  ));
}

function runCodexProbe(model, prompt) {
  const result = run(codexBin, [
    'exec',
    '--ephemeral',
    '--json',
    '--sandbox',
    'read-only',
    '-m',
    model,
    prompt,
  ]);
  return {
    events: parseCodexEvents(result.stdout || ''),
    exitCode: result.status,
    stderr: result.stderr || '',
  };
}

let config;
let localModel = process.env.OPENCODEX_POC_MODEL || '';

try {
  config = JSON.parse(await readFile(configPath, 'utf8'));
  check('isolated config', true, configPath);
} catch (error) {
  check('isolated config', false, error instanceof Error ? error.message : String(error));
}

const ollamaProvider = config?.providers?.ollama;
if (ollamaProvider) {
  localModel ||= ollamaProvider.defaultModel || '';
  const baseUrl = new URL(ollamaProvider.baseUrl);
  const loopback = baseUrl.hostname === 'localhost' || baseUrl.hostname === '127.0.0.1' || baseUrl.hostname === '::1';
  check('Ollama provider', loopback && ollamaProvider.adapter === 'openai-chat', `${ollamaProvider.adapter} ${baseUrl.origin}`);
  const configuredEfforts = ollamaProvider.modelReasoningEfforts?.[localModel];
  check('local reasoning override', Array.isArray(configuredEfforts) && configuredEfforts.length === 0, `${localModel || 'missing model'} => ${JSON.stringify(configuredEfforts)}`);
} else {
  check('Ollama provider', false, 'providers.ollama is missing');
}

const port = Number(config?.port || 10100);
for (const endpoint of ['healthz', 'readyz']) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/${endpoint}`, {
      signal: AbortSignal.timeout(3_000),
    });
    check(`proxy ${endpoint}`, response.ok, `HTTP ${response.status}`);
  } catch (error) {
    check(`proxy ${endpoint}`, false, error instanceof Error ? error.message : String(error));
  }
}

const ocxVersion = commandVersion(ocxBin);
check('OpenCodex CLI', Boolean(ocxVersion), ocxVersion || `${ocxBin} is not executable`);
const codexVersion = commandVersion(codexBin);
check('Codex CLI', Boolean(codexVersion), codexVersion || `${codexBin} is not executable`);

if (localModel) {
  const ollamaModel = run(ollamaBin, ['show', localModel]);
  check('local model', ollamaModel.status === 0, localModel);
} else {
  check('local model', false, 'No local model is configured');
}

try {
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const models = Array.isArray(catalog) ? catalog : catalog.models;
  const slug = `ollama/${localModel}`;
  const row = models?.find((model) => model.slug === slug);
  check('Codex routed catalog row', Boolean(row), slug);
  if (row) {
    check('code-mode tools', row.tool_mode === 'code_mode_only' && row.node_repl_disabled === false, `tool_mode=${row.tool_mode}, node_repl_disabled=${row.node_repl_disabled}`);
    check('catalog reasoning override', Array.isArray(row.supported_reasoning_levels) && row.supported_reasoning_levels.length === 0, JSON.stringify(row.supported_reasoning_levels));
  }
} catch (error) {
  check('Codex routed catalog row', false, error instanceof Error ? error.message : String(error));
}

const mcpList = run(codexBin, ['mcp', 'list']);
const nodeReplEnabled = mcpList.status === 0 && /^node_repl\s+.*\senabled\s/mu.test(mcpList.stdout);
check('Codex node_repl MCP', nodeReplEnabled, nodeReplEnabled ? 'enabled' : 'not enabled');

if (wantsLive && localModel && codexVersion) {
  const textProbe = runCodexProbe(localModel, 'Reply exactly POC_TEXT_OK and nothing else.');
  const textPassed = textProbe.exitCode === 0 && completedAgentMessage(textProbe.events, 'POC_TEXT_OK');
  benchmark('routed local text', textPassed ? 'pass' : 'fail', textPassed ? localModel : `exit=${textProbe.exitCode}`);

  const nativeModel = process.env.OPENCODEX_NATIVE_MODEL || 'gpt-5.6-sol';
  const nativeMarker = 'NATIVE_CUA_BRIDGE_OK';
  const nativeProbe = runCodexProbe(
    nativeModel,
    `Call mcp__node_repl__js exactly once with JavaScript nodeRepl.write("${nativeMarker}"), then reply exactly DONE. Do not use any other tool.`,
  );
  const nativePassed = nativeProbe.exitCode === 0 && completedMcpResultContains(nativeProbe.events, nativeMarker);
  benchmark('native Codex node_repl bridge', nativePassed ? 'pass' : 'fail', nativePassed ? nativeModel : `exit=${nativeProbe.exitCode}`);

  const localMarker = 'LOCAL_CUA_BRIDGE_OK';
  const localProbe = runCodexProbe(
    localModel,
    `Call mcp__node_repl__js exactly once with JavaScript nodeRepl.write("${localMarker}"), then reply exactly DONE. Do not use any other tool.`,
  );
  const localPassed = localProbe.exitCode === 0 && completedMcpResultContains(localProbe.events, localMarker);
  benchmark('routed local node_repl bridge', localPassed ? 'pass' : 'gap', localPassed ? localModel : 'model returned no completed node_repl tool call');
}

const staticPassed = checks.every((item) => item.ok);
const requiredBenchmarksPassed = benchmarks
  .filter((item) => item.outcome !== 'gap' || strictLocal)
  .every((item) => item.outcome === 'pass');
const result = {
  benchmarks,
  checks,
  paths: { catalog: catalogPath, config: configPath },
  passed: staticPassed && requiredBenchmarksPassed,
};

if (wantsJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  for (const item of checks) {
    console.log(`[${item.ok ? 'PASS' : 'FAIL'}] ${item.name}: ${item.detail}`);
  }
  for (const item of benchmarks) {
    console.log(`[${item.outcome.toUpperCase()}] ${item.name}: ${item.detail}`);
  }
  if (!wantsLive) {
    console.log('Static checks only. Add --live to compare native and routed tool calls.');
  }
}

process.exit(result.passed ? 0 : 1);
