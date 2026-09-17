import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';

import english from '../../../i18n/locales/en/chat.json';
import { resetComposerFreezeForTests } from '../../../shared/composerFreeze';
import { useChatComposerState } from '../hooks/useChatComposerState';
import ChatComposer from '../view/ChatComposer';

/*
 * The "+" button attaches images. The desktop shell's open panel ignores the
 * `accept` filter (wry never sets allowed content types), so the composer is
 * routinely handed a Markdown or text file it cannot take. Discarding it with
 * no message is indistinguishable from a broken button, which is exactly how
 * it was reported. These tests drive the real button, the real picker element
 * and the real composer, because the refusal only exists as rendered output.
 */

type Args = Parameters<typeof useChatComposerState>[0];
const base: Args = {
  selectedProject: { projectId: 'attach-project', fullPath: '/fixture', displayName: 'Fixture', origin: 'explicit' },
  selectedSession: { id: 'a', __provider: 'gjc' }, currentSessionId: null,
  gjcModel: 'fixture/model', reasoningEffort: 'default', isLoading: false, canAbortSession: false, tokenBudget: null,
  sendMessage() {}, addMessage() {}, scrollToBottom() {}, setIsUserScrolledUp() {}, setPendingPermissionRequests() {},
};

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { chat: english } } });

// The provider wraps the hook, not just the view: the refusal text is built in
// the hook, so a fixture that translates only the view would test nothing.
const Composer = () => <I18nextProvider i18n={i18n}><ComposerBody /></I18nextProvider>;

function ComposerBody() {
  const c = useChatComposerState(base);
  return <>
    <div data-testid="attached">{c.attachedImages.map((file) => file.name).join(',')}</div>
    <ChatComposer
      {...c} pendingPermissionRequests={[]} handlePermissionDecision={c.handlePermissionDecision}
      isLoading={false} sessionState={null} onShowTokenUsage={() => {}} onAbortSession={c.handleAbortSession}
      onSubmit={c.handleSubmit} onSteer={c.handleSteer}
      onEditQueuedDraft={c.editQueuedDraft} onDeleteQueuedDraft={c.deleteQueuedDraft} onMoveQueuedDraft={c.moveQueuedDraft}
      onConfirmCommandGate={c.confirmCommandGate} onCancelCommandGate={c.cancelCommandGate}
      onRemoveImage={(index) => c.setAttachedImages((files) => files.filter((_, position) => position !== index))}
      onDismissAttachmentNotice={c.dismissAttachmentNotice}
      onSelectFile={c.selectFile} onCommandSelect={c.handleCommandSelect}
      onCloseCommandMenu={c.resetCommandMenuState} isCommandMenuOpen={c.showCommandMenu}
      onInputChange={c.handleInputChange} onTextareaClick={c.handleTextareaClick} onTextareaKeyDown={c.handleKeyDown}
      onTextareaPaste={c.handlePaste} onTextareaScrollSync={c.syncInputOverlayScroll} onTextareaInput={c.handleTextareaInput}
      placeholder="Attachment fixture" onRetryDraftPersistence={c.retryDraftPersistence}
    />
  </>;
}

const png = (name: string, bytes = 8) => new File([new Uint8Array(bytes)], name, { type: 'image/png' });

/** Drives the picker the "+" button really creates, the way a chosen file arrives. */
async function chooseFiles(files: File[]) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: english.input.attachImages })); });
  const picker = document.querySelector('input[data-composer-attachment-picker]') as HTMLInputElement | null;
  assert.ok(picker, 'the attach button must open a file picker');
  Object.defineProperty(picker, 'files', { configurable: true, value: files });
  await act(async () => { picker.dispatchEvent(new Event('change')); await Promise.resolve(); });
}

const attached = () => screen.getByTestId('attached').textContent;
const notice = () => screen.queryByRole('status')?.textContent ?? null;

const originalFetch = globalThis.fetch;
beforeEach(() => { resetComposerFreezeForTests(); localStorage.clear(); globalThis.fetch = async () => new Response('[]'); });
afterEach(() => {
  cleanup();
  document.querySelectorAll('[data-composer-attachment-picker]').forEach((input) => input.dispatchEvent(new Event('cancel')));
  resetComposerFreezeForTests(); localStorage.clear(); globalThis.fetch = originalFetch;
});

test('a chosen markdown file is refused out loud and never disappears in silence', async () => {
  render(<Composer />);
  await chooseFiles([new File(['# notes'], 'notes.md', { type: 'text/markdown' })]);

  await waitFor(() => assert.match(notice() ?? '', /notes\.md/));
  assert.match(notice() ?? '', /Only images can be attached/);
  assert.match(notice() ?? '', /@/, 'the refusal must point at the mention path that does work');
  assert.equal(attached(), '', 'a refused file must not be attached');
});

test('a file with no MIME type at all is still named rather than dropped', async () => {
  render(<Composer />);
  await chooseFiles([new File(['plan'], 'PLAN', { type: '' })]);

  await waitFor(() => assert.match(notice() ?? '', /PLAN/));
  assert.equal(attached(), '');
});

test('an accepted image attaches and clears a previous refusal', async () => {
  render(<Composer />);
  await chooseFiles([new File(['# notes'], 'notes.md', { type: 'text/markdown' })]);
  await waitFor(() => assert.match(notice() ?? '', /notes\.md/));

  await chooseFiles([png('shot.png')]);

  await waitFor(() => assert.equal(attached(), 'shot.png'));
  assert.equal(notice(), null, 'a successful attachment must not leave the old refusal on screen');
});

test('a mixed selection attaches the images and names only what was refused', async () => {
  render(<Composer />);
  await chooseFiles([png('kept.png'), new File(['x'], 'skipped.md', { type: 'text/markdown' })]);

  await waitFor(() => assert.equal(attached(), 'kept.png'));
  assert.match(notice() ?? '', /skipped\.md/);
  assert.doesNotMatch(notice() ?? '', /kept\.png/);
});

test('an oversized image and a sixth image are both reported instead of vanishing', async () => {
  render(<Composer />);
  await chooseFiles([png('huge.png', 5 * 1024 * 1024 + 1)]);
  await waitFor(() => assert.match(notice() ?? '', /huge\.png/));
  assert.match(notice() ?? '', /5 MB/);
  assert.equal(attached(), '');

  await chooseFiles([1, 2, 3, 4, 5, 6].map((index) => png(`shot-${index}.png`)));

  await waitFor(() => assert.equal(attached(), 'shot-1.png,shot-2.png,shot-3.png,shot-4.png,shot-5.png'));
  assert.match(notice() ?? '', /shot-6\.png/);
});

test('pasted text is never mistaken for a refused attachment, but a pasted file is refused', async () => {
  render(<Composer />);
  const textarea = screen.getByPlaceholderText('Attachment fixture');

  await act(async () => { fireEvent.paste(textarea, { clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }], files: [] } }); });
  assert.equal(notice(), null, 'pasting text must not claim an attachment was refused');

  const markdown = new File(['# notes'], 'pasted.md', { type: 'text/markdown' });
  await act(async () => { fireEvent.paste(textarea, { clipboardData: { items: [{ kind: 'file', type: markdown.type, getAsFile: () => markdown }], files: [] } }); });
  await waitFor(() => assert.match(notice() ?? '', /pasted\.md/));
  assert.equal(attached(), '');
});

test('the refusal can be dismissed', async () => {
  render(<Composer />);
  await chooseFiles([new File(['# notes'], 'notes.md', { type: 'text/markdown' })]);
  await waitFor(() => assert.match(notice() ?? '', /notes\.md/));

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: english.input.attachment.dismiss })); });

  assert.equal(notice(), null);
});
