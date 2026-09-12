import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';

import { DesktopNativeInit } from './desktop-native-init.js';

const browser = { protocolVersion: 1 as const, socket: '/tmp/browser/control.sock', secret: 'a'.repeat(64), epoch: 'b'.repeat(64) };
const update = { ...browser, socket: '/tmp/updater/control.sock', secret: 'c'.repeat(64) };
const frame = (value: unknown) => `GJC_DESKTOP_INIT ${JSON.stringify(value)}\n`;

function fixture() {
  const input = new PassThrough();
  const init = new DesktopNativeInit({ input, platform: 'darwin', env: { GJC_DESKTOP: '1', GJC_DESKTOP_PIPE: '1' } });
  return { input, init };
}

test('one stdin reader delivers separate native browser and updater bindings', () => {
  const { input, init } = fixture();
  const seen: unknown[] = [];
  init.subscribe((bindings) => seen.push(bindings?.browser));
  init.subscribe((bindings) => seen.push(bindings?.update));
  assert.equal(input.listenerCount('data'), 1);
  const line = frame({ protocolVersion: 2, browser, update });
  input.write(line.slice(0, 20));
  assert.equal(init.getBindings(), null);
  input.write(line.slice(20));
  assert.deepEqual(init.getBindings(), { browser, update });
  assert.deepEqual(seen.slice(-2), [browser, update]);
  init.retire();
});

test('browser initialization does not depend on updater being enabled', () => {
  const { input, init } = fixture();
  input.write(frame({ protocolVersion: 2, browser, update: null }));
  assert.deepEqual(init.getBindings(), { browser, update: null });
  init.retire();
});

test('legacy updater-only initialization never enables native browser capability', () => {
  const { input, init } = fixture();
  input.write(`GJC_DESKTOP_UPDATE_INIT ${JSON.stringify(update)}\n`);
  assert.deepEqual(init.getBindings(), { browser: null, update });
  init.retire();
});

test('malformed, oversized, duplicate and trailing input retires both channels', () => {
  for (const line of [
    frame({ protocolVersion: 2, browser, update, extra: true }),
    frame({ protocolVersion: 2, browser: { ...browser, socket: 'relative' }, update }),
    frame({ protocolVersion: 2, browser: { ...browser, secret: 'bad' }, update }),
    frame({ protocolVersion: 2, browser: null, update }),
    frame({ protocolVersion: 2, browser, update }) + '\n',
    'a'.repeat(4097),
  ]) {
    const { input, init } = fixture();
    input.write(line);
    assert.equal(init.isRetired(), true);
    assert.equal(init.getBindings(), null);
    assert.equal(input.listenerCount('data'), 0);
  }
  const { input, init } = fixture();
  input.write(frame({ protocolVersion: 2, browser, update }));
  input.write('second frame');
  assert.equal(init.isRetired(), true);
  assert.equal(init.getBindings(), null);
});

test('input failure invalidates existing subscribers and clears secrets', () => {
  const { input, init } = fixture();
  input.write(frame({ protocolVersion: 2, browser, update }));
  let cleared = false;
  init.subscribe((value) => { cleared = value === null; });
  input.emit('error', new Error('pipe closed'));
  assert.equal(cleared, true);
  assert.equal(init.getBindings(), null);
});

test('plain self-host has no native capability and never consumes stdin', () => {
  const input = new PassThrough();
  const init = new DesktopNativeInit({ input, platform: 'linux', env: {} });
  assert.equal(init.expected, false);
  assert.equal(init.getBindings(), null);
  assert.equal(input.listenerCount('data'), 0);
});
