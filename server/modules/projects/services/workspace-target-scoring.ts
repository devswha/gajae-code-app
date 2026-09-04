export type WorkspaceCandidateReason = 'mention' | 'partial' | 'recent';

export type WorkspaceCandidate = {
  path: string;
  name: string;
  score: number;
  reason: WorkspaceCandidateReason;
};

export type WorkspaceScoringChild = {
  path: string;
  name: string;
  packageName: string | null;
  mtimeMs: number;
};

const TOKEN_CHARACTER = /[a-z0-9._-]/;

function candidateNames(child: WorkspaceScoringChild): string[] {
  const names = [child.name.toLowerCase(), child.packageName?.toLowerCase() ?? null].filter(
    (name): name is string => Boolean(name),
  );
  return Array.from(new Set(names));
}

// `name` occurs in the text with nothing token-like on either side, so a repo named
// `gajae-code` is not "mentioned" by a message about `gajae-code-app`. This is how a
// name made of characters outside the token class (a Korean directory) gets found.
function mentionedWhole(name: string, lowerText: string): boolean {
  let from = 0;
  for (;;) {
    const at = lowerText.indexOf(name, from);
    if (at === -1) return false;
    const before = at === 0 ? '' : lowerText[at - 1];
    const after = lowerText[at + name.length] ?? '';
    if (!TOKEN_CHARACTER.test(before) && !TOKEN_CHARACTER.test(after)) return true;
    from = at + 1;
  }
}

function scoreAgainstName(name: string, lowerText: string, tokens: string[]): { score: number; reason: WorkspaceCandidateReason } {
  if (tokens.includes(name)) return { score: 100, reason: 'mention' };
  if (name.length >= 4 && mentionedWhole(name, lowerText)) return { score: 80, reason: 'mention' };
  if (tokens.some((token) => token.length >= 3 && name.startsWith(token))) return { score: 40, reason: 'partial' };
  return { score: 0, reason: 'recent' };
}

/**
 * Ranks every child repository of a workspace against free-form task text. Each child
 * scores by its best match across the directory name and the (scope-stripped)
 * package.json name; ties, and all children when the text is empty, fall back to
 * directory recency. The whole list comes back so a picker can show every repo, with
 * the likely target first.
 */
export function scoreWorkspaceCandidates(text: string, children: WorkspaceScoringChild[]): WorkspaceCandidate[] {
  const lowerText = text.trim().toLowerCase();
  const tokens = lowerText.split(/[^a-z0-9._-]+/).filter(Boolean);

  const scored = children.map((child) => {
    let best = { score: 0, reason: 'recent' as WorkspaceCandidateReason };
    for (const name of candidateNames(child)) {
      const candidate = scoreAgainstName(name, lowerText, tokens);
      if (candidate.score > best.score) best = candidate;
    }
    return { path: child.path, name: child.name, score: best.score, reason: best.reason, mtimeMs: child.mtimeMs };
  });

  scored.sort((a, b) => b.score - a.score || b.mtimeMs - a.mtimeMs);
  return scored.map(({ path, name, score, reason }) => ({ path, name, score, reason }));
}
