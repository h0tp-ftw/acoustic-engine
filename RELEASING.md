# Releasing

Releases are automated by [`.github/workflows/release.yml`](.github/workflows/release.yml).
Any of three triggers builds the package, creates a GitHub Release with notes
from `CHANGELOG.md`, and publishes to PyPI via **Trusted Publishing** (no token
or secret stored anywhere).

## The normal flow — bump the version, merge

In a PR (or directly on `main`):

1. **Bump the version** in `pyproject.toml` **and** `src/acoustic_engine/__init__.py`
   to the same value (the workflow fails fast if they disagree).
2. **Add a `## <version>` section** to `CHANGELOG.md` — this becomes the GitHub
   Release notes. (Or let the workflow generate one; see below.)
3. **Merge to `main`.**

On that push, the workflow sees a version that isn't tagged yet, tags
`v<version>`, builds, and publishes. A push to `main` that does **not** change
the version is a no-op, so this is safe on every merge.

> Preview the notes first: `python scripts/changelog.py notes <version>` prints
> exactly what the Release body will contain. To draft a section from your
> commits: `python scripts/changelog.py update <version>` (then review/edit).

## Other ways to trigger it

- **Button:** Actions → **Release** → **Run workflow** → type the version (e.g.
  `1.3.0`). The workflow bumps the files + changelog, commits, tags, and
  publishes — handy when you don't want to edit files locally.
- **Tag:** `git tag v1.3.0 && git push origin v1.3.0` (you've already bumped and
  committed).

All three converge on the same build/publish. Tags the workflow pushes via
`GITHUB_TOKEN` don't re-trigger it, so there's never a double run.

## One-time setup (already configured if releases work)

1. **PyPI Trusted Publishing** — on the `acoustic-engine` project → *Publishing* →
   add a trusted publisher:
   - Owner `h0tp-ftw` · Repository `acoustic-engine`
   - Workflow `release.yml` · Environment `pypi`
2. **Actions write permission** — Settings → Actions → General → *Workflow
   permissions* → **Read and write**. Required so the workflow can push the
   `v<version>` tag and create the Release; with the read-only default those
   steps 403. (Alternatively grant it per-job, but the repo default must allow it.)
3. *(Optional)* a GitHub **Environment** named `pypi` (Settings → Environments)
   if you want a manual approval gate before the publish step.

No API token is stored anywhere. To switch from Trusted Publishing to a token
instead, see the comment at the bottom of `release.yml`.

## Notes

- Commit messages following `type(scope): summary` (feat, fix, docs, refactor,
  perf, chore, ci, build, test) let `scripts/changelog.py` group them when it
  generates a section. Anything that doesn't match is skipped.
- The version-bump auto-release and the no-op-on-unchanged behavior are both
  exercised in practice (1.2.0 shipped this way; ordinary merges skip cleanly).
