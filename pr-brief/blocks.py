#!/usr/bin/env python3
"""Build code blocks for a pr-brief / pr-flow spec without hand-copying anything.

Shared by both skills: `diff`, `context` and `facts` blocks have the same shape in a brief
and in a flow. Run it from the repository (or the scratchpad clone) that holds the ref.

CLI (each command prints one JSON block on stdout):

  blocks.py report <OWNER/REPO> <N> <brief|flow>
      Prints the output path of a page, without extension (add .json / .html):
      ~/.claude/skills/reports/[<TICKET>-]<repo>-<N>-<kind>, where <TICKET> comes from the
      PR's head branch — `PROD-7715-feat/x` → PROD-7715, `3068-chore/x` or `#3068-x` → GH-3068,
      anything else → no prefix.

  blocks.py hunks <pr.diff> [<path>]
      Lists the files of the diff, or the hunks of <path> with their index and @@ header —
      the indexes `--hunk` / `hunks=[…]` expect.

  blocks.py diff  <pr.diff> <path> [--hunk N] [--hunk M ...] [--trim A-B]
      Verbatim hunks of <path> from a `gh pr diff` dump. --hunk selects by index
      (default: all). --trim A-B keeps only added lines A..B of a *new-file* hunk and
      recomputes the @@ header.

  blocks.py ctx   <ref> <path> <A-B>[,<C-D>...] [--hl 12,14] [--note "..."]
      Out-of-diff excerpt read from `git show <ref>:<path>`; several ranges become
      segments separated by an elision row. --hl lists the lines to highlight.

  blocks.py facts '<text>' --run '<command>'
      One fact item whose command is RUN here and whose output is captured verbatim.
      Several --run flags pair with several texts, in order.
  blocks.py facts '<text>' [--cmd '<command>' --out '<output>']
      Only for an output that no shell command can reproduce (a console scenario):
      the output is pasted from where it was produced, verbatim.

Importable (the usual way — write a builder script in the scratchpad):

    from blocks import Blocks
    B = Blocks(ref="refs/pr-brief/<N>", diff_path="<scratch>/pr-<N>.diff")
    B.diff(path)                                  # every hunk of the file, verbatim
    B.diff(path, hunks=[0])                       # selected hunks
    B.diff(path, trim=(31, 71))                   # new-file hunk cut to added lines 31..71
    B.ctx(path, [(18, 30)], highlight=[22])       # excerpt from the ref, with line numbers
    B.line(path, "def rows")                      # line number of a pattern, never typed by hand
    B.excerpt(path, "  rows() {", "^  },", highlight=["this.x"])   # ctx located by patterns
    B.hunks(path)                                 # [(index, "@@ … @@ header")]

    # a second repo (the agorize-core companion): its blocks link to that repo / PR
    C = Blocks(ref="refs/pr-brief/core-<M>", diff_path="<scratch>/core-<M>.diff",
               cwd="<core clone>", repo="Agorize/agorize-core",
               pr_url="https://github.com/Agorize/agorize-core/pull/<M>")
    B.ran("`Foo` has no spec.", "git grep -n Foo refs/pr-brief/<N> -- spec")   # runs it
    Blocks.facts([...])                           # wraps fact items into a block
"""

import argparse
import hashlib
import os
import json
import re
import subprocess
import sys

HUNK_RE = re.compile(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@")


EMPTY_OUTPUT = "(aucun résultat)"
REPORTS_DIR = os.path.expanduser("~/.claude/skills/reports")


def ticket_of(branch):
    """`PROD-7715-feat/x` → `PROD-7715`; `3068-chore/x`, `#3068-x` → `GH-3068`; else None."""
    m = re.match(r"^([A-Z][A-Z0-9]*-\d+)(?:[-_/]|$)", branch)
    if m:
        return m.group(1)
    m = re.match(r"^#?(\d+)(?:[-_/]|$)", branch)
    return f"GH-{m.group(1)}" if m else None


def report_path(repo, number, kind, branch=None):
    """Output path, without extension, of a page of `kind` (`brief` / `flow`) for a PR."""
    if branch is None:
        branch = subprocess.check_output(
            ["gh", "pr", "view", str(number), "--repo", repo, "--json", "headRefName",
             "--jq", ".headRefName"], text=True).strip()
    ticket = ticket_of(branch)
    name = f"{repo.split('/')[-1]}-{number}-{kind}"
    return os.path.join(REPORTS_DIR, f"{ticket}-{name}" if ticket else name)


class Blocks:
    def __init__(self, ref=None, diff_path=None, cwd=None, repo=None, pr_url=None):
        self.ref = ref
        self.cwd = cwd  # repository to run git and fact commands in (default: current dir)
        # set both for a repo other than the brief's own: blocks then carry `repo` + `ref`
        # (context) or `repo` + `url` (diff), so the page links to the right place
        self.repo = repo
        self.pr_url = pr_url
        self._sha = None
        self._files = {}
        self._hunks = {}
        if diff_path:
            self._parse(open(diff_path, encoding="utf-8").read())

    # ---- diff ----
    def _parse(self, text):
        files, cur = {}, None
        for line in text.split("\n"):
            m = re.match(r"^diff --git a/(.*?) b/(.*)$", line)
            if m:
                cur = m.group(2)
                files[cur] = []
                continue
            if cur is None:
                continue
            if line.startswith("@@"):
                files[cur].append([line])
                continue
            if line.startswith(("+++", "---", "index ", "new file", "deleted file", "similarity", "rename ")):
                continue
            if files[cur]:
                files[cur][-1].append(line)
        self._hunks = {p: ["\n".join(h).rstrip("\n") for h in hs] for p, hs in files.items()}

    def paths(self):
        """Paths as the diff names them — the path *after* a rename."""
        return list(self._hunks)

    def hunks(self, path):
        """[(index, header)] of a file's hunks: pick `hunks=[…]` from this, never by counting."""
        return [(i, h.split("\n", 1)[0]) for i, h in enumerate(self._hunks[path])]

    def hunk(self, path, index=0):
        return self._hunks[path][index]

    def trim_new(self, path, start, end, index=0):
        """Keep added lines start..end of a new-file hunk; header recomputed."""
        body = self._hunks[path][index].split("\n")[1:]
        added = [l for l in body if l.startswith("+")]
        kept = added[start - 1:end]
        return "\n".join([f"@@ -0,0 +{start},{len(kept)} @@"] + kept)

    def diff(self, path, hunks=None, trim=None):
        if trim:
            chosen = [self.trim_new(path, trim[0], trim[1], (hunks or [0])[0])]
        elif hunks is None:
            chosen = list(self._hunks[path])
        else:
            chosen = [self._hunks[path][i] for i in hunks]
        block = {"kind": "diff", "path": path, "hunks": chosen}
        if self.repo:
            block["repo"] = self.repo
            if self.pr_url:
                block["url"] = f"{self.pr_url}/files#diff-{hashlib.sha256(path.encode()).hexdigest()}"
        return block

    # ---- context ----
    def show(self, path):
        if path not in self._files:
            out = subprocess.run(["git", "cat-file", "-p", f"{self.ref}:{path}"],
                                 capture_output=True, text=True, encoding="utf-8", cwd=self.cwd)
            if out.returncode:
                sys.exit(out.stderr.strip())
            self._files[path] = out.stdout.split("\n")
        return self._files[path]

    def ctx(self, path, ranges, highlight=None, note=None):
        """ranges: [(start, end), ...]; highlight: iterable of absolute line numbers."""
        hl = set(highlight or [])
        segs = []
        for start, end in ranges:
            lines = self.show(path)[start - 1:end]
            seg = {"start_line": start, "code": "\n".join(lines)}
            seg_hl = sorted(n for n in hl if start <= n <= end)
            if seg_hl:
                seg["highlight"] = seg_hl
            segs.append(seg)
        block = {"kind": "context", "path": path}
        if self.repo:
            block["repo"] = self.repo
            block["ref"] = self.sha()
        if len(segs) == 1:
            block.update(segs[0])
        else:
            block["segments"] = segs
        if note:
            block["note"] = note
        return block

    def sha(self):
        if self._sha is None:
            self._sha = subprocess.check_output(["git", "rev-parse", self.ref], text=True,
                                                cwd=self.cwd).strip()
        return self._sha

    def line(self, path, pattern, after=1):
        """1-based number of the first line at or after `after` that contains `pattern`.

        A pattern starting with `^` must equal the whole line (without the `^`): `"^  },"`
        matches the end of a method, not the end of an object nested inside it.
        """
        exact = pattern.startswith("^")
        for number, text in enumerate(self.show(path)[after - 1:], start=after):
            if (text == pattern[1:]) if exact else (pattern in text):
                return number
        sys.exit(f"{pattern!r} not found in {path} (from line {after})")

    def span(self, path, start, end, after=1):
        first = self.line(path, start, after)
        return first, self.line(path, end, first)

    def excerpt(self, path, start, end, highlight=(), note=None, after=1):
        """`ctx` whose range and highlighted lines are located by patterns (see `line`)."""
        first, last = self.span(path, start, end, after)
        return self.ctx(path, [(first, last)], [self.line(path, p, first) for p in highlight], note)

    @staticmethod
    def fact(text, command=None, output=None, detail=None):
        """A fact item with a pasted output. Prefer `ran`, which executes the command."""
        item = {"text": text}
        if detail:
            item["detail"] = detail
        if command:
            item["command"] = command
            item["output"] = output or EMPTY_OUTPUT
        return item

    def ran(self, text, command, detail=None, empty=EMPTY_OUTPUT):
        """A fact item whose command is executed now; its real output is embedded.

        stdout wins; an empty stdout falls back to stderr, then to `empty` (the text the
        page shows for "nothing matched"). The exit code is deliberately ignored: `grep`
        exits 1 on no match, and no match is often the very fact being established.
        """
        run = subprocess.run(command, shell=True, capture_output=True, text=True,
                             encoding="utf-8", cwd=self.cwd)
        output = run.stdout.strip() or run.stderr.strip() or empty
        return self.fact(text, command, output, detail)

    @staticmethod
    def facts(items):
        return {"kind": "facts", "items": list(items)}


def parse_ranges(spec):
    out = []
    for part in spec.split(","):
        a, b = part.split("-") if "-" in part else (part, part)
        out.append((int(a), int(b)))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("report")
    r.add_argument("repo"); r.add_argument("number"); r.add_argument("kind", choices=["brief", "flow"])
    h = sub.add_parser("hunks")
    h.add_argument("diff_path"); h.add_argument("path", nargs="?")
    d = sub.add_parser("diff")
    d.add_argument("diff_path"); d.add_argument("path")
    d.add_argument("--hunk", type=int, action="append")
    d.add_argument("--trim")
    c = sub.add_parser("ctx")
    c.add_argument("ref"); c.add_argument("path"); c.add_argument("ranges")
    c.add_argument("--hl"); c.add_argument("--note")
    f = sub.add_parser("facts")
    f.add_argument("text", nargs="+")
    f.add_argument("--run", action="append", help="command to execute; its output is captured")
    f.add_argument("--cmd", dest="command", action="append", help="command shown but not run (with --out)")
    f.add_argument("--out", action="append")
    a = ap.parse_args()

    if a.cmd == "report":
        print(report_path(a.repo, a.number, a.kind))
    elif a.cmd == "hunks":
        b = Blocks(diff_path=a.diff_path)
        rows = b.hunks(a.path) if a.path else list(enumerate(b.paths()))
        print("\n".join(f"{i}\t{text}" for i, text in rows))
    elif a.cmd == "diff":
        b = Blocks(diff_path=a.diff_path)
        trim = tuple(int(x) for x in a.trim.split("-")) if a.trim else None
        print(json.dumps(b.diff(a.path, a.hunk, trim), ensure_ascii=False, indent=1))
    elif a.cmd == "ctx":
        b = Blocks(ref=a.ref)
        hl = [int(x) for x in a.hl.split(",")] if a.hl else None
        print(json.dumps(b.ctx(a.path, parse_ranges(a.ranges), hl, a.note), ensure_ascii=False, indent=1))
    else:
        b = Blocks()
        runs, cmds, outs = a.run or [], a.command or [], a.out or []
        items = []
        for i, text in enumerate(a.text):
            if i < len(runs):
                items.append(b.ran(text, runs[i]))
            else:
                items.append(Blocks.fact(text, cmds[i] if i < len(cmds) else None,
                                         outs[i] if i < len(outs) else None))
        print(json.dumps(Blocks.facts(items), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
