"""Git merge driver for review comment threads (.gitlatex/comments/*.json).

Two people replying to the same thread both append to its `messages` list, so
a plain text merge always conflicts there. This merges the two versions the
way a person would: keep every message from both sides, in date order.

Git runs it as `<python> comments_merge.py %O %A %B` (ancestor, ours, theirs)
and expects the result written to %A; a non-zero exit leaves a normal
conflict. comments.install_merge_driver() registers it, so it runs for pulls
and merges made from the command line as well as from the app.

Kept free of gitlatex imports: git runs it as a plain script.
"""

import json
import sys

# Resolving is one change made of three fields, so they move together.
RESOLVED_KEYS = ("resolved", "resolvedBy", "resolvedAt")


def _load(path, required):
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        text = ""
    if not text.strip() and not required:
        return {}  # no common ancestor
    data = json.loads(text)  # ValueError on conflict markers or junk
    if not isinstance(data, dict):
        raise ValueError("not a thread")
    return data


def _pick(base, ours, theirs):
    """Three-way pick of one value: whichever side changed it; ours if both did."""
    if ours == base:
        return theirs
    return ours


def _merge_messages(base, ours, theirs):
    def ids(t):
        return {m.get("id") for m in t.get("messages") or [] if isinstance(m, dict)}
    base_ids = ids(base)
    # A message in the ancestor that one side no longer has was deleted there.
    deleted = (base_ids - ids(ours)) | (base_ids - ids(theirs))
    # Ours first, so messages with the same date keep ours before theirs. In
    # a rebase (how the app pulls) "ours" is the remote, which was there first.
    by_id = {}
    for m in (ours.get("messages") or []) + (theirs.get("messages") or []):
        if isinstance(m, dict) and m.get("id") not in deleted:
            by_id.setdefault(m.get("id"), m)
    # The opening message stays first whatever its date says.
    first = next((m.get("id") for m in ours.get("messages") or [] if isinstance(m, dict)), None)
    return sorted(by_id.values(), key=lambda m: (m.get("id") != first, str(m.get("date") or "")))


def _merge_resolved(base, ours, theirs):
    def group(t):
        return {k: t[k] for k in RESOLVED_KEYS if k in t}
    b, o, t = group(base), group(ours), group(theirs)
    if o == b:
        return t
    if t == b:
        return o
    # Both sides resolved or reopened it: the later decision wins.
    return t if str(t.get("resolvedAt") or "") > str(o.get("resolvedAt") or "") else o


def merge(base, ours, theirs):
    out = {}
    for key in list(ours) + [k for k in theirs if k not in ours]:
        if key == "messages" or key in RESOLVED_KEYS:
            continue
        value = _pick(base.get(key), ours.get(key), theirs.get(key))
        if value is not None:
            out[key] = value
    out.update(_merge_resolved(base, ours, theirs))
    out["messages"] = _merge_messages(base, ours, theirs)
    return out


def main(argv):
    if len(argv) != 4:
        print("usage: comments_merge.py BASE OURS THEIRS", file=sys.stderr)
        return 2
    _, base_path, ours_path, theirs_path = argv
    try:
        base = _load(base_path, required=False)
        ours = _load(ours_path, required=True)
        theirs = _load(theirs_path, required=True)
    except ValueError as e:
        print("gitlatex: cannot merge comment thread %s: %s" % (ours_path, e), file=sys.stderr)
        return 1
    merged = merge(base, ours, theirs)
    # Same format as comments._write, so the next edit makes a small diff.
    with open(ours_path, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)
        f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
