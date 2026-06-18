#!/usr/bin/env python3
"""Changelog / release-notes automation (standard library only).

Two commands:

  python scripts/changelog.py update 1.2.0
      Generate a section for 1.2.0 from the conventional-commit messages since
      the last release tag and prepend it to CHANGELOG.md. Review and edit the
      result, then commit it. Run this when preparing a release.

  python scripts/changelog.py notes 1.2.0
      Print the release notes for 1.2.0 (the curated CHANGELOG.md section if it
      exists, otherwise generated from commits). Used by CI to fill the GitHub
      Release body.

Commit convention: `type(scope): summary` — feat, fix, docs, refactor, perf,
chore, ci, build, test. Anything that doesn't match is ignored.
"""

import re
import subprocess
import sys
from pathlib import Path

CHANGELOG = Path(__file__).resolve().parent.parent / "CHANGELOG.md"

# Conventional-commit type -> changelog heading, in display order.
SECTIONS = [
    ("Added", ("feat",)),
    ("Fixed", ("fix",)),
    ("Changed", ("refactor", "perf", "change")),
    ("Documentation", ("docs",)),
    ("Other", ("chore", "ci", "build", "test", "style")),
]
_COMMIT_RE = re.compile(r"(\w+)(?:\([^)]*\))?!?:\s*(.+)")


def _run(*args: str) -> str:
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout.strip()


def _previous_tag(version: str):
    """Highest existing tag other than the one being released."""
    current = f"v{version}"
    tags = [t for t in _run("git", "tag", "--sort=-v:refname").splitlines() if t and t != current]
    return tags[0] if tags else None


def _commit_subjects(since):
    rng = f"{since}..HEAD" if since else "HEAD"
    return [line for line in _run("git", "log", rng, "--pretty=%s").splitlines() if line]


def generate(version: str) -> str:
    """Build a CHANGELOG section for `version` from commits since the last tag."""
    buckets = {name: [] for name, _ in SECTIONS}
    for subject in _commit_subjects(_previous_tag(version)):
        match = _COMMIT_RE.match(subject)
        if not match:
            continue
        typ, desc = match.group(1).lower(), match.group(2).strip()
        for name, types in SECTIONS:
            if typ in types:
                buckets[name].append(desc)
                break

    lines = [f"## {version}", ""]
    for name, _ in SECTIONS:
        if buckets[name]:
            lines.append(f"### {name}")
            lines += [f"- {desc}" for desc in buckets[name]]
            lines.append("")
    if len(lines) == 2:  # nothing matched
        lines.append("_No notable changes._")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def cmd_update(version: str) -> int:
    section = generate(version)
    text = CHANGELOG.read_text() if CHANGELOG.exists() else "# Changelog\n"
    if text.lstrip().startswith("# Changelog"):
        header, _, rest = text.partition("\n")
        text = f"{header}\n\n{section}\n{rest.lstrip(chr(10))}"
    else:
        text = f"# Changelog\n\n{section}\n{text}"
    CHANGELOG.write_text(text)
    print(f"Prepended a {version} section to {CHANGELOG.name}. Review and edit before committing.")
    return 0


def cmd_notes(version: str) -> int:
    text = CHANGELOG.read_text() if CHANGELOG.exists() else ""
    match = re.search(
        rf"(?m)^##\s+{re.escape(version)}\b.*?(?=^##\s+|\Z)", text, re.S
    )
    if match:
        body = re.sub(rf"(?m)^##\s+{re.escape(version)}.*\n", "", match.group(0)).strip()
    else:
        body = re.sub(r"(?m)^##\s+.*\n", "", generate(version), count=1).strip()
    print(body)
    return 0


def main(argv) -> int:
    if len(argv) != 2 or argv[0] not in ("update", "notes"):
        print(__doc__)
        return 1
    version = argv[1].lstrip("v")
    return cmd_update(version) if argv[0] == "update" else cmd_notes(version)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
