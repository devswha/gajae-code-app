# Manual selective upstream intake

Gajae App accepts upstream changes only through a deliberate, reviewable
intake. There is no scheduled mirror, automatic synchronization, bulk merge,
or automatic source rewrite.

The historical upstream repository, `CloudCLI UI`, is
`https://github.com/siteboon/claudecodeui`. Both identifiers are provenance
only; it is not a Gajae App release source. Gajae App server artifacts are
published only through [GitHub Releases](https://github.com/devswha/Gajae-code-app/releases).

## Intake record

For every candidate, create a review record containing:

- upstream repository URL and immutable commit identifier;
- change rationale, affected files, and security impact;
- original author and commit attribution;
- applicable license and notice obligations;
- focused test evidence and identity-scan result; and
- the resulting Gajae App commit identifier.

Do not begin from a branch tip, a moving tag, or an unreviewed aggregate of
changes. Select the smallest set of commits that addresses the approved need.

## Review the candidate before applying it

Use the canonical checkout and a temporary intake branch. Before inspection,
configure its `upstream` remote to the historical source. Fetching is allowed
for inspection; it does not authorize integration.

```sh
CHECKOUT="$HOME/.local/share/gajae-app"
UPSTREAM_COMMIT=<reviewed-full-commit>

cd "$CHECKOUT"
git remote get-url upstream >/dev/null
git fetch --no-tags upstream
git show --stat --summary "$UPSTREAM_COMMIT"
git show --format=fuller "$UPSTREAM_COMMIT"
git diff "$UPSTREAM_COMMIT^" "$UPSTREAM_COMMIT" --
```

Confirm that the proposed change is available from the configured historical
upstream remote, has an immutable identifier, and does not combine unrelated
work. Reject the candidate when the source, authorship, or license status is
unclear.

## Preserve attribution, legal material, and identity

Before applying a candidate:

1. Read `LICENSE` and `NOTICE`; preserve their bytes and required attribution.
   Do not replace, shorten, relocate, or regenerate legal material as part of
   intake without dedicated legal review.
2. Preserve original commit attribution. When a commit is accepted unchanged,
   use `git cherry-pick -x` so its source identifier remains in history.
3. Inspect every changed public name, endpoint, release reference, artifact
   name, service unit name, and user-facing path. Gajae App identity is
   `gajae-app`, `gajae-app.service`,
   `gajae-app-server-<version>-linux-x64-node22.tar.gz`, and
   `https://github.com/devswha/Gajae-code-app/releases`.
4. Run the repository identity scanner for the candidate diff. Treat any
   non-provenance legacy product, service, package, or release reference as a
   blocker until it is intentionally removed or documented as provenance.
5. Run focused tests for every changed behavior and record the commands and
   results in the intake record. A failed, skipped, or missing relevant check
   blocks integration unless the reviewer explicitly documents the risk.

Historical provenance, including original links and changelog entries, may
remain intact when clearly labeled as history. It must never become an active
installation, service, or release instruction.

## Apply only the approved change

Apply the reviewed commit on a dedicated branch, resolve differences
intentionally, and repeat the license, attribution, test, and identity checks
on the resulting diff.

```sh
cd "$CHECKOUT"
git switch -c intake/<short-purpose>
git cherry-pick -x "$UPSTREAM_COMMIT"
git diff --check
```

A conflict is a review event, not permission to copy surrounding upstream
changes. Resolve only the approved behavior; otherwise abort the intake and
record why it was rejected.

After review, add a new Gajae App changelog entry above the historical
provenance section. Do not rewrite historical links or entries. Publishing a
new server artifact remains a separate release review and uses GitHub Releases
only.
