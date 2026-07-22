import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  appendImagesInputTag,
  isAllowedImageSourcePath,
  normalizeImageDescriptors,
  parseImagesInputTag,
  resolveImageMediaType,
  toImageAttachments,
} from '@/shared/image-attachments.js';

test('normalizeImageDescriptors accepts objects and bare paths, drops junk', () => {
  const descriptors = normalizeImageDescriptors([
    { path: '.gajae-app/assets/a.png', name: 'a.png', mimeType: 'image/png' },
    'scripts/pic.jpg',
    { name: 'no-path.png' },
    42,
    null,
    '',
  ]);

  assert.deepEqual(descriptors, [
    { path: '.gajae-app/assets/a.png', name: 'a.png', mimeType: 'image/png' },
    { path: 'scripts/pic.jpg' },
  ]);
  assert.deepEqual(normalizeImageDescriptors(undefined), []);
  assert.deepEqual(normalizeImageDescriptors('not-an-array'), []);
});

test('appendImagesInputTag and parseImagesInputTag round-trip', () => {
  const prompt = 'Describe these screenshots.\n\nFocus on the header.';
  const tagged = appendImagesInputTag(prompt, [
    { path: '.gajae-app/assets/1-a.png' },
    { path: '.gajae-app\\assets\\2-b.jpg' },
  ]);

  assert.ok(tagged.startsWith(prompt));
  assert.ok(tagged.includes('<images_input>'));
  assert.ok(tagged.includes('</images_input>'));
  assert.ok(tagged.includes('The user attached 2 image(s)'));

  const parsed = parseImagesInputTag(tagged);
  assert.equal(parsed.text, prompt);
  // Backslashes are normalized so references stay portable.
  assert.deepEqual(parsed.imagePaths, ['.gajae-app/assets/1-a.png', '.gajae-app/assets/2-b.jpg']);
});

test('original filenames round-trip through the tag', () => {
  const tagged = appendImagesInputTag('compare these', [
    { path: 'C:/Users/x/.gajae-app/assets/1-a.png', name: 'screenshot (final).png' },
    { path: 'C:/Users/x/.gajae-app/assets/2-b.jpg' },
  ]);

  const parsed = parseImagesInputTag(tagged);
  assert.equal(parsed.text, 'compare these');
  // Parentheses are dropped from names so the "(original name: ...)" suffix
  // stays parseable; the path-only entry carries no name.
  assert.deepEqual(parsed.attachments, [
    { path: 'C:/Users/x/.gajae-app/assets/1-a.png', name: 'screenshot final.png' },
    { path: 'C:/Users/x/.gajae-app/assets/2-b.jpg' },
  ]);
});

test('only the LAST images_input block is treated as the attachment carrier', () => {
  const userTypedTag = 'What does <images_input> mean in this codebase?';
  const tagged = appendImagesInputTag(
    `${userTypedTag}\n\n<images_input>\nfake user block\n</images_input>\n\nAlso check this.`,
    [{ path: 'C:/Users/x/.gajae-app/assets/real.png' }],
  );

  const parsed = parseImagesInputTag(tagged);
  assert.ok(parsed.text.includes('fake user block'));
  assert.ok(parsed.text.includes('Also check this.'));
  assert.deepEqual(parsed.imagePaths, ['C:/Users/x/.gajae-app/assets/real.png']);
});

test('appendImagesInputTag without images returns the prompt untouched', () => {
  assert.equal(appendImagesInputTag('hello', []), 'hello');
  assert.equal(appendImagesInputTag('hello', undefined), 'hello');
});

test('parseImagesInputTag handles prompts flattened to one line for cmd.exe shims', () => {
  // Windows spawn runtimes collapse newlines before passing the argument to
  // .cmd-shimmed CLIs; the persisted prompt is then a single line.
  const flattened = appendImagesInputTag('now?', [{ path: 'C:/Users/x/.gajae-app/assets/a.jpg' }])
    .replace(/\s*\r?\n\s*/g, ' ')
    .trim();

  assert.ok(!flattened.includes('\n'));
  const parsed = parseImagesInputTag(flattened);
  assert.equal(parsed.text, 'now?');
  assert.deepEqual(parsed.imagePaths, ['C:/Users/x/.gajae-app/assets/a.jpg']);
});

test('parseImagesInputTag leaves text without a tag untouched', () => {
  const text = 'Just a normal prompt with [brackets] and JSON ["like"] content.';
  const parsed = parseImagesInputTag(text);
  assert.equal(parsed.text, text);
  assert.deepEqual(parsed.imagePaths, []);
});

test('parseImagesInputTag strips a malformed tag body without attaching images', () => {
  const text = 'prompt\n\n<images_input>\nnot json here\n</images_input>';
  const parsed = parseImagesInputTag(text);
  assert.equal(parsed.text, 'prompt');
  assert.deepEqual(parsed.imagePaths, []);
});

test('toImageAttachments maps paths to posix attachment records', () => {
  assert.deepEqual(toImageAttachments(['a\\b\\c.png', 'd/e.jpg']), [
    { path: 'a/b/c.png' },
    { path: 'd/e.jpg' },
  ]);
});

test('resolveImageMediaType prefers the mime type and falls back to the extension', () => {
  assert.equal(resolveImageMediaType({ path: 'x.bin', mimeType: 'image/webp' }), 'image/webp');
  assert.equal(resolveImageMediaType({ path: 'x.JPG' }), 'image/jpeg');
  assert.equal(resolveImageMediaType({ path: 'x.png' }), 'image/png');
  assert.equal(resolveImageMediaType({ path: 'x.unknown' }), null);
});

test('isAllowedImageSourcePath only accepts the upload store and the run cwd', () => {
  const cwd = path.join(os.tmpdir(), 'some-project');
  const uploadStore = path.join(os.homedir(), '.gajae-app', 'assets');

  assert.equal(isAllowedImageSourcePath(path.join(uploadStore, 'shot.png'), cwd), true);
  assert.equal(isAllowedImageSourcePath(path.join(cwd, 'docs', 'diagram.png'), cwd), true);

  assert.equal(isAllowedImageSourcePath(path.join(os.homedir(), '.ssh', 'id_rsa'), cwd), false);
  assert.equal(isAllowedImageSourcePath(path.join(cwd, '..', 'other-project', 'x.png'), cwd), false);
  // The roots themselves are directories, not readable image files.
  assert.equal(isAllowedImageSourcePath(cwd, cwd), false);
});
