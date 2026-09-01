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

test('descriptor normalization retains usable path inputs only', () => {
  const accepted = normalizeImageDescriptors([
    { path: ' .gajae-app/assets/a.png ', name: 'a.png', mimeType: 'image/png' },
    ' scripts/pic.jpg ',
    { name: 'missing.png' },
    42,
    null,
    '',
  ]);

  assert.deepEqual(accepted, [
    { path: '.gajae-app/assets/a.png', name: 'a.png', mimeType: 'image/png' },
    { path: 'scripts/pic.jpg' },
  ]);
  for (const invalidValue of [undefined, 'not-an-array']) {
    assert.deepEqual(normalizeImageDescriptors(invalidValue), []);
  }
});

test('tag creation preserves prompts and yields portable parsed references', () => {
  const prompt = 'Describe these screenshots.\n\nFocus on the header.';
  const tagged = appendImagesInputTag(prompt, [
    { path: '.gajae-app/assets/1-a.png' },
    { path: '.gajae-app\\assets\\2-b.jpg' },
  ]);

  assert.ok(tagged.startsWith(prompt));
  assert.match(tagged, /<images_input>[\s\S]*<\/images_input>/);
  assert.match(tagged, /The user attached 2 image\(s\)/);
  assert.deepEqual(parseImagesInputTag(tagged), {
    text: prompt,
    imagePaths: ['.gajae-app/assets/1-a.png', '.gajae-app/assets/2-b.jpg'],
    attachments: [
      { path: '.gajae-app/assets/1-a.png' },
      { path: '.gajae-app/assets/2-b.jpg' },
    ],
  });
});

test('tag parser carries sanitized original names and selects its final block', () => {
  const named = parseImagesInputTag(appendImagesInputTag('compare these', [
    { path: 'C:/Users/x/.gajae-app/assets/1-a.png', name: 'screenshot (final).png' },
    { path: 'C:/Users/x/.gajae-app/assets/2-b.jpg' },
  ]));

  assert.equal(named.text, 'compare these');
  assert.deepEqual(named.attachments, [
    { path: 'C:/Users/x/.gajae-app/assets/1-a.png', name: 'screenshot final.png' },
    { path: 'C:/Users/x/.gajae-app/assets/2-b.jpg' },
  ]);

  const prompt = 'What does <images_input> mean in this codebase?\n\n<images_input>\nfake user block\n</images_input>\n\nAlso check this.';
  const parsed = parseImagesInputTag(appendImagesInputTag(prompt, [{ path: 'C:/Users/x/.gajae-app/assets/real.png' }]));
  assert.match(parsed.text, /fake user block/);
  assert.match(parsed.text, /Also check this\./);
  assert.deepEqual(parsed.imagePaths, ['C:/Users/x/.gajae-app/assets/real.png']);
});

test('tag helpers leave no-attachment and non-tag input unchanged', () => {
  assert.equal(appendImagesInputTag('hello', []), 'hello');
  assert.equal(appendImagesInputTag('hello', undefined), 'hello');

  const ordinaryText = 'Just a normal prompt with [brackets] and JSON ["like"] content.';
  assert.deepEqual(parseImagesInputTag(ordinaryText), {
    text: ordinaryText,
    imagePaths: [],
    attachments: [],
  });
});

test('tag parsing tolerates flattened input and discards malformed carriers', () => {
  const flattened = appendImagesInputTag('now?', [{ path: 'C:/Users/x/.gajae-app/assets/a.jpg' }])
    .replace(/\s*\r?\n\s*/g, ' ')
    .trim();
  assert.equal(flattened.includes('\n'), false);
  assert.deepEqual(parseImagesInputTag(flattened).imagePaths, ['C:/Users/x/.gajae-app/assets/a.jpg']);
  assert.equal(parseImagesInputTag(flattened).text, 'now?');

  assert.deepEqual(parseImagesInputTag('prompt\n\n<images_input>\nnot json here\n</images_input>'), {
    text: 'prompt',
    imagePaths: [],
    attachments: [],
  });
});

test('attachment records, media types, and source roots are constrained', () => {
  assert.deepEqual(toImageAttachments(['a\\b\\c.png', 'd/e.jpg']), [
    { path: 'a/b/c.png' },
    { path: 'd/e.jpg' },
  ]);
  assert.equal(resolveImageMediaType({ path: 'x.bin', mimeType: 'image/webp' }), 'image/webp');
  assert.equal(resolveImageMediaType({ path: 'x.JPG' }), 'image/jpeg');
  assert.equal(resolveImageMediaType({ path: 'x.png' }), 'image/png');
  assert.equal(resolveImageMediaType({ path: 'x.unknown' }), null);

  const cwd = path.join(os.tmpdir(), 'some-project');
  const uploads = path.join(os.homedir(), '.gajae-app', 'assets');
  assert.equal(isAllowedImageSourcePath(path.join(uploads, 'shot.png'), cwd), true);
  assert.equal(isAllowedImageSourcePath(path.join(cwd, 'docs', 'diagram.png'), cwd), true);
  assert.equal(isAllowedImageSourcePath(path.join(os.homedir(), '.ssh', 'id_rsa'), cwd), false);
  assert.equal(isAllowedImageSourcePath(path.join(cwd, '..', 'other-project', 'x.png'), cwd), false);
  assert.equal(isAllowedImageSourcePath(cwd, cwd), false);
});
