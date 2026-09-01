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

const gajaeAssetRoot = path.join(os.homedir(), '.gajae-app', 'assets');

test('attachment descriptors retain trimmed paths and discard unusable inputs', () => {
  const suppliedAttachments = [
    { path: ' .gajae-app/assets/gajae-board.png ', name: 'gajae-board.png', mimeType: 'image/png' },
    ' workspaces/gajae/reference.jpg ',
    { name: 'pathless.png' },
    42,
    null,
    '',
  ];

  assert.deepEqual(normalizeImageDescriptors(suppliedAttachments), [
    { path: '.gajae-app/assets/gajae-board.png', name: 'gajae-board.png', mimeType: 'image/png' },
    { path: 'workspaces/gajae/reference.jpg' },
  ]);
  for (const malformedInput of [undefined, 'not-an-array']) {
    assert.deepEqual(normalizeImageDescriptors(malformedInput), []);
  }
});

test('image tags preserve the authored prompt and normalize portable attachment paths', () => {
  const prompt = 'Review the Gajae project dashboard.\n\nCall out the migration status.';
  const taggedPrompt = appendImagesInputTag(prompt, [
    { path: '.gajae-app/assets/dashboard.png' },
    { path: '.gajae-app\\assets\\release-notes.jpg' },
  ]);

  assert.ok(taggedPrompt.startsWith(prompt));
  assert.match(taggedPrompt, /<images_input>[\s\S]*<\/images_input>/);
  assert.match(taggedPrompt, /The user attached 2 image\(s\)/);
  assert.deepEqual(parseImagesInputTag(taggedPrompt), {
    text: prompt,
    imagePaths: ['.gajae-app/assets/dashboard.png', '.gajae-app/assets/release-notes.jpg'],
    attachments: [
      { path: '.gajae-app/assets/dashboard.png' },
      { path: '.gajae-app/assets/release-notes.jpg' },
    ],
  });
});

test('parsing keeps safe original names and consumes the application-generated final tag', () => {
  const namedAttachment = parseImagesInputTag(appendImagesInputTag('Compare the two releases', [
    { path: 'C:/Users/gajae/.gajae-app/assets/release-a.png', name: 'release (approved).png' },
    { path: 'C:/Users/gajae/.gajae-app/assets/release-b.jpg' },
  ]));
  assert.deepEqual(namedAttachment, {
    text: 'Compare the two releases',
    imagePaths: ['C:/Users/gajae/.gajae-app/assets/release-a.png', 'C:/Users/gajae/.gajae-app/assets/release-b.jpg'],
    attachments: [
      { path: 'C:/Users/gajae/.gajae-app/assets/release-a.png', name: 'release approved.png' },
      { path: 'C:/Users/gajae/.gajae-app/assets/release-b.jpg' },
    ],
  });

  const authoredTag = 'What does <images_input> mean here?\n\n<images_input>\nuser prose, not attachment data\n</images_input>\n\nCheck the implementation.';
  const parsed = parseImagesInputTag(appendImagesInputTag(authoredTag, [
    { path: 'C:/Users/gajae/.gajae-app/assets/actual.png' },
  ]));
  assert.match(parsed.text, /user prose, not attachment data/);
  assert.match(parsed.text, /Check the implementation\./);
  assert.deepEqual(parsed.imagePaths, ['C:/Users/gajae/.gajae-app/assets/actual.png']);
});

test('no attachment input leaves ordinary prompts untouched', () => {
  for (const attachments of [[], undefined]) {
    assert.equal(appendImagesInputTag('inspect the workspace', attachments), 'inspect the workspace');
  }

  const ordinaryPrompt = 'Plain project notes with [brackets] and JSON ["like this"].';
  assert.deepEqual(parseImagesInputTag(ordinaryPrompt), {
    text: ordinaryPrompt,
    imagePaths: [],
    attachments: [],
  });
});

test('the carrier survives flattened transport and ignores malformed attachment data', () => {
  const flattenedCarrier = appendImagesInputTag('Ready for review?', [
    { path: 'C:/Users/gajae/.gajae-app/assets/review.jpg' },
  ]).replace(/\s*\r?\n\s*/g, ' ').trim();

  assert.equal(flattenedCarrier.includes('\n'), false);
  const flattened = parseImagesInputTag(flattenedCarrier);
  assert.equal(flattened.text, 'Ready for review?');
  assert.deepEqual(flattened.imagePaths, ['C:/Users/gajae/.gajae-app/assets/review.jpg']);
  assert.deepEqual(parseImagesInputTag('prompt\n\n<images_input>\nnot json here\n</images_input>'), {
    text: 'prompt',
    imagePaths: [],
    attachments: [],
  });
});

test('attachment records infer supported media types and only expose approved source roots', () => {
  assert.deepEqual(toImageAttachments(['workspace\\gajae\\diagram.png', 'docs/release.jpg']), [
    { path: 'workspace/gajae/diagram.png' },
    { path: 'docs/release.jpg' },
  ]);

  const mediaTypes = [
    [{ path: 'preview.bin', mimeType: 'image/webp' }, 'image/webp'],
    [{ path: 'preview.JPG' }, 'image/jpeg'],
    [{ path: 'preview.png' }, 'image/png'],
    [{ path: 'preview.unknown' }, null],
  ] as const;
  for (const [descriptor, mediaType] of mediaTypes) {
    assert.equal(resolveImageMediaType(descriptor), mediaType);
  }

  const projectRoot = path.join(os.tmpdir(), 'gajae-image-review');
  const pathPolicy = [
    [path.join(gajaeAssetRoot, 'uploaded-preview.png'), true],
    [path.join(projectRoot, 'docs', 'architecture.png'), true],
    [path.join(os.homedir(), '.ssh', 'id_rsa'), false],
    [path.join(projectRoot, '..', 'other-workspace', 'outside.png'), false],
    [projectRoot, false],
  ] as const;
  for (const [candidate, permitted] of pathPolicy) {
    assert.equal(isAllowedImageSourcePath(candidate, projectRoot), permitted, candidate);
  }
});
