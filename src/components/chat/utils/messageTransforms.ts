export interface DiffLine { type: 'added' | 'removed'; content: string; lineNum: number; }

export type DiffCalculator = (oldStr: string, newStr: string) => DiffLine[];

const lineSequence = (text: string) => text.split('\n');

const buildAlignment = (before: string[], after: string[]) => {
  const columns = after.length + 1;
  const scores = new Uint32Array((before.length + 1) * columns);
  const at = (beforeIndex: number, afterIndex: number) => beforeIndex * columns + afterIndex;

  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      scores[at(beforeIndex, afterIndex)] = before[beforeIndex] === after[afterIndex]
        ? scores[at(beforeIndex + 1, afterIndex + 1)] + 1
        : Math.max(scores[at(beforeIndex + 1, afterIndex)], scores[at(beforeIndex, afterIndex + 1)]);
    }
  }

  return { scores, columns };
};

export const calculateDiff = (oldStr: string, newStr: string): DiffLine[] => {
  const removed = lineSequence(oldStr);
  const added = lineSequence(newStr);
  const alignment = buildAlignment(removed, added);
  const scoreAt = (oldIndex: number, newIndex: number) =>
    alignment.scores[oldIndex * alignment.columns + newIndex];
  const changes: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < removed.length || newIndex < added.length) {
    if (oldIndex === removed.length) {
      changes.push({ type: 'added', content: added[newIndex], lineNum: newIndex + 1 });
      newIndex += 1;
    } else if (newIndex === added.length) {
      changes.push({ type: 'removed', content: removed[oldIndex], lineNum: oldIndex + 1 });
      oldIndex += 1;
    } else if (removed[oldIndex] === added[newIndex]) {
      oldIndex += 1;
      newIndex += 1;
    } else if (scoreAt(oldIndex + 1, newIndex) >= scoreAt(oldIndex, newIndex + 1)) {
      changes.push({ type: 'removed', content: removed[oldIndex], lineNum: oldIndex + 1 });
      oldIndex += 1;
    } else {
      changes.push({ type: 'added', content: added[newIndex], lineNum: newIndex + 1 });
      newIndex += 1;
    }
  }

  return changes;
};

export const createCachedDiffCalculator = (): DiffCalculator => {
  const results = new Map<string, DiffLine[]>();

  return (oldStr, newStr) => {
    const fingerprint = JSON.stringify([oldStr, newStr]);
    const existing = results.get(fingerprint);
    if (existing) return existing;

    const computed = calculateDiff(oldStr, newStr);
    results.set(fingerprint, computed);
    if (results.size > 100) {
      const oldest = results.keys().next().value;
      if (oldest) results.delete(oldest);
    }
    return computed;
  };
};
