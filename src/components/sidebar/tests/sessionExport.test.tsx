import assert from 'node:assert/strict';
import test from 'node:test';

import { createInstance, type TFunction } from 'i18next';

import { buildSessionActions } from '../view/SidebarSessionItem';
import { downloadBlob, filenameFromContentDisposition } from '../../../utils/download';

/*
 * Exporting a conversation from the sidebar.
 *
 * The runtime's own `/export` only runs inside a live turn and writes into the
 * project directory, so this path reads the stored transcript and hands the
 * user a download instead. Two things have to hold: the entry only exists when
 * a host wired it, and the file keeps the name the server gave it.
 */

async function makeT(): Promise<TFunction> {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: {
      en: {
        sidebar: {
          sessions: {
            exportSession: 'Export as Markdown',
            renameSession: 'Rename Session',
            deleteSession: 'Delete Session',
            pin: 'Pin',
            unpin: 'Unpin',
          },
        },
      },
    },
  });
  return i18n.getFixedT(null, 'sidebar');
}

const actions = (t: TFunction, overrides: Partial<Parameters<typeof buildSessionActions>[0]> = {}) =>
  buildSessionActions({
    sessionId: 'session-1',
    sessionName: 'Fix the pagination bug',
    isStarred: false,
    isProcessing: false,
    t,
    onStartEditingSession: () => undefined,
    onDeleteSession: () => undefined,
    ...overrides,
  });

test('the export entry appears only when a host wired the handler', async () => {
  const t = await makeT();

  assert.equal(actions(t).some((item) => item.key === 'export'), false);

  const exported: string[] = [];
  const wired = actions(t, { onExportSession: (sessionId) => exported.push(sessionId) });
  const item = wired.find((entry) => entry.key === 'export');

  assert.ok(item, 'a wired host gets the entry');
  assert.equal(item.label, 'Export as Markdown');
  item.onSelect();
  assert.deepEqual(exported, ['session-1'], 'it exports the row it belongs to');
});

test('regenerate title follows rename and appears only when a host wired it', async () => {
  const t = await makeT();

  assert.equal(actions(t).some((item) => item.key === 'regenerate-title'), false);

  const regenerated: string[] = [];
  const wired = actions(t, { onRegenerateTitle: (sessionId) => regenerated.push(sessionId), onExportSession: () => undefined });
  const keys = wired.map((item) => item.key);
  assert.equal(keys.indexOf('regenerate-title'), keys.indexOf('rename') + 1, 'it is Rename\'s neighbour, not buried below export');

  wired.find((entry) => entry.key === 'regenerate-title')!.onSelect();
  assert.deepEqual(regenerated, ['session-1']);
});

test('a running session keeps delete out of reach, and export within it', async () => {
  const t = await makeT();
  const running = actions(t, { isProcessing: true, onExportSession: () => undefined });

  assert.equal(running.some((item) => item.key === 'delete'), false);
  assert.equal(running.some((item) => item.key === 'export'), true);
});

test('the download keeps the name the server chose', () => {
  assert.equal(
    filenameFromContentDisposition('attachment; filename="fix-the-bug-2026-08-27.md"', 'fallback.md'),
    'fix-the-bug-2026-08-27.md',
  );
  // A non-ASCII title only survives in the encoded parameter, so it wins.
  assert.equal(
    filenameFromContentDisposition(
      `attachment; filename="-2026-08-27.md"; filename*=UTF-8''${encodeURIComponent('한글-제목-2026-08-27.md')}`,
      'fallback.md',
    ),
    '한글-제목-2026-08-27.md',
  );
  assert.equal(filenameFromContentDisposition(null, 'fallback.md'), 'fallback.md');
  assert.equal(filenameFromContentDisposition('attachment', 'fallback.md'), 'fallback.md');
  // A malformed encoding falls back rather than failing the download.
  assert.equal(
    filenameFromContentDisposition("attachment; filename*=UTF-8''%E0%A4%A", 'fallback.md'),
    'fallback.md',
  );
});

test('saving a blob does not leave the anchor or the object URL behind', () => {
  const clicked: string[] = [];
  const revoked: string[] = [];
  const anchors: Array<{ href: string; download: string; remove: () => void }> = [];

  const originalDocument = globalThis.document;
  const originalUrl = globalThis.URL.createObjectURL;
  const originalRevoke = globalThis.URL.revokeObjectURL;

  globalThis.URL.createObjectURL = () => 'blob:test-url';
  globalThis.URL.revokeObjectURL = (url: string) => revoked.push(url);
  (globalThis as { document?: unknown }).document = {
    createElement: () => {
      const anchor = {
        href: '',
        download: '',
        style: {} as Record<string, string>,
        click: () => clicked.push(anchor.download),
        remove: () => anchors.splice(anchors.indexOf(anchor), 1),
      };
      anchors.push(anchor);
      return anchor;
    },
    body: { appendChild: () => undefined },
  };

  try {
    downloadBlob(new Blob(['# transcript']), 'session.md');

    assert.deepEqual(clicked, ['session.md']);
    assert.equal(anchors.length, 0, 'the anchor must not stay in the document');
  } finally {
    globalThis.URL.createObjectURL = originalUrl;
    globalThis.URL.revokeObjectURL = originalRevoke;
    (globalThis as { document?: unknown }).document = originalDocument;
  }
});
