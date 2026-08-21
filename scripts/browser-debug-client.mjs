#!/usr/bin/env node

const HELP = `Usage:
  npm run browser:debug -- [options] status
  npm run browser:debug -- [options] open [url]
  npm run browser:debug -- [options] command '<json>'
  npm run browser:debug -- [options] input '<json>'
  npm run browser:debug -- [options] close

Options:
  --base-url <url>  Gajae server URL (default: http://127.0.0.1:3001)
  --session <id>    Browser session ID (default: browser-debug)
  --cookie <value>  Desktop cookie value or full Cookie header
  --api-key <key>   Self-hosted x-api-key value

Environment alternatives:
  GAJAE_BROWSER_DEBUG_BASE_URL, GAJAE_BROWSER_DEBUG_SESSION,
  GAJAE_BROWSER_DEBUG_COOKIE, API_KEY
`;

function parseArguments(argv) {
  const options = {
    baseUrl: process.env.GAJAE_BROWSER_DEBUG_BASE_URL ?? 'http://127.0.0.1:3001',
    sessionId: process.env.GAJAE_BROWSER_DEBUG_SESSION ?? 'browser-debug',
    cookie: process.env.GAJAE_BROWSER_DEBUG_COOKIE,
    apiKey: process.env.API_KEY,
  };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--help' || value === '-h') return { ...options, command: 'help', values: [] };
    if (value === '--base-url' || value === '--session' || value === '--cookie' || value === '--api-key') {
      const next = argv[index + 1];
      if (!next) throw new Error(`${value} requires a value.`);
      if (value === '--base-url') options.baseUrl = next;
      if (value === '--session') options.sessionId = next;
      if (value === '--cookie') options.cookie = next;
      if (value === '--api-key') options.apiKey = next;
      index += 1;
      continue;
    }
    positionals.push(value);
  }
  return { ...options, command: positionals[0] ?? 'help', values: positionals.slice(1) };
}

function requestFor({ command, values, sessionId }) {
  const session = encodeURIComponent(sessionId);
  switch (command) {
    case 'status':
      return { path: '/api/automation/status', init: {} };
    case 'open':
      return {
        path: `/api/browser/${session}/open`,
        init: { method: 'POST', body: JSON.stringify({ ...(values[0] ? { url: values[0] } : {}) }) },
      };
    case 'command':
      return {
        path: `/api/browser/${session}/command`,
        init: { method: 'POST', body: JSON.stringify({ command: parseJson(values[0], 'command') }) },
      };
    case 'input':
      return {
        path: `/api/browser/${session}/input`,
        init: { method: 'POST', body: JSON.stringify({ input: parseJson(values[0], 'input') }) },
      };
    case 'close':
      return { path: `/api/browser/${session}`, init: { method: 'DELETE' } };
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function parseJson(value, label) {
  if (!value) throw new Error(`${label} requires one JSON object argument.`);
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed;
}

function cookieHeader(value) {
  if (!value) return undefined;
  return value.includes('=') ? value : `gajae_desktop_api_key=${value}`;
}

export async function runBrowserDebugClient(argv, output = console.log) {
  const options = parseArguments(argv);
  if (options.command === 'help') {
    output(HELP.trimEnd());
    return;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(options.sessionId)) {
    throw new Error('Session ID contains unsupported characters.');
  }
  const { path, init } = requestFor(options);
  const headers = { accept: 'application/json' };
  if (init.body) headers['content-type'] = 'application/json';
  if (options.apiKey) headers['x-api-key'] = options.apiKey;
  const cookie = cookieHeader(options.cookie);
  if (cookie) headers.cookie = cookie;
  const response = await fetch(new URL(path, options.baseUrl), { ...init, headers });
  const text = await response.text();
  let result;
  try {
    result = text ? JSON.parse(text) : null;
  } catch {
    result = { response: text };
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
  output(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runBrowserDebugClient(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
