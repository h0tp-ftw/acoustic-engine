# Releasing

Releases are automated. Pushing a version tag builds the package, creates a
GitHub Release with notes generated from `CHANGELOG.md`, and publishes to PyPI
via **Trusted Publishing** (no token or secret anywhere).

## One-time setup (already configured if releases work)

1. **PyPI → the `acoustic-engine` project → Manage → Publishing → add a trusted
   publisher** (GitHub Actions):
   - Owner: `h0tp-ftw` · Repository: `acoustic-engine`
   - Workflow: `release.yml` · Environment: `pypi`
2. **GitHub → Settings → Environments → New environment** named `pypi`
   (optionally add required reviewers for a manual approval gate before publish).

That's it — no API token is stored anywhere.

## Cutting a release

```bash
# 1. Draft the changelog from your commits, then review/edit it.
python scripts/changelog.py update 1.2.0
$EDITOR CHANGELOG.md

# 2. Bump the version in pyproject.toml and src/acoustic_engine/__init__.py to match.

# 3. Commit, tag, push.
git commit -am "release: 1.2.0"
git tag v1.2.0
git push origin main v1.2.0
```

Pushing the tag triggers [`.github/workflows/release.yml`](.github/workflows/release.yml),
which builds, creates the GitHub Release (notes from the `## 1.2.0` section of
`CHANGELOG.md`), and publishes to PyPI.

## Notes

- Commit messages should follow `type(scope): summary` (feat, fix, docs,
  refactor, perf, chore, ci, build, test) so `scripts/changelog.py` can group
  them. Anything that doesn't match is skipped.
- `python scripts/changelog.py notes 1.2.0` prints exactly what the release body
  will contain — handy for previewing.
- To switch from Trusted Publishing to an API token, see the comment at the
  bottom of `release.yml`.
