"""A pure-Python reader for .synctex(.gz) files.

TeX writes a record for every box, glyph run, kern and glue it ships out,
tagged with the input file and line that produced it. That is enough to
answer both SyncTeX questions without the `synctex` command-line tool, so
jumping between source and PDF works on machines with no TeX installed
(PDFs built by a remote Compiler API).

The lookups follow synctex_parser.c from the SyncTeX distribution
(github.com/jlaurens/synctex) so the answers match `synctex view` and
`synctex edit`: the same "visible" box extents, the same boundary nodes at
both ends of every hbox, the same line search order and the same rules for
picking the record nearest a click. Forms (\\pdfxform) are skipped.

Record lines inside a page ("{3" ... "}3"):
    [tag,line:h,v:W,H,D   vbox open        ]  close
    (tag,line:h,v:W,H,D   hbox open        )  close
    vtag,line:h,v:W,H,D   void vbox        htag,line:h,v:W,H,D  void hbox
    rtag,line:h,v:W,H,D   rule             ktag,line:h,v:W       kern
    xtag,line:h,v         boundary         gtag,line:h,v         glue
    $tag,line:h,v         math
Coordinates are integers from the page's top-left corner, v pointing down
to the baseline; H is the height above it and D the depth below.
"""

import gzip
import os

_INF = 2 ** 31 - 1          # INT_MAX: "no distance yet"
_SP_PER_BP = 65781.76

_BOXES = "([vh"             # _synctex_node_is_box
_LEAVES = "vhkgr$x"
_BDRY = "b"                 # box boundary: added by the parser, not in the file


class _Node(object):
    __slots__ = ("kind", "tag", "line", "h", "v", "W", "H", "D",
                 "hV", "vV", "WV", "HV", "DV", "mean", "weight",
                 "parent", "children", "friend")

    def __init__(self, kind, tag, line, h, v, W=0, H=0, D=0, parent=None):
        self.kind = kind
        self.tag, self.line = tag, line
        self.h, self.v, self.W, self.H, self.D = h, v, W, H, D
        # Visible extents: an hbox grows to cover everything drawn inside it.
        self.hV, self.vV, self.WV, self.HV, self.DV = h, v, W, H, D
        self.mean = None
        self.weight = 0
        self.parent = parent
        self.children = []
        # The (tag, line) the node was filed under when read. The C parser
        # files nodes in a hash by tag+line and later retags some of them,
        # which leaves those unreachable from the old line; mirror that.
        self.friend = None


# -- geometry helpers ---------------------------------------------------------

def _hbox_box(n):
    """(min_h, min_v, max_h, max_v) of an hbox's visible extent."""
    if n.WV < 0:
        max_h = n.hV
        min_h = max_h + n.WV
    else:
        min_h = n.hV
        max_h = min_h + n.WV
    return min_h, n.vV - n.HV, max_h, n.vV + n.DV


def _data_box(n):
    if n.W < 0:
        max_h = n.h
        min_h = max_h + n.W
    else:
        min_h = n.h
        max_h = min_h + n.W
    return min_h, n.v - n.H, max_h, n.v + n.D


def _kern_box(n):
    """_synctex_data_xob: the kern's position is recorded after the move."""
    if n.W > 0:
        max_h = n.h
        min_h = max_h - n.W
    else:
        min_h = n.h
        max_h = min_h - n.W
    return min_h, n.v - n.H, max_h, n.v + n.D


def _contain_point(box, h, v):
    """_synctex_make_hbox_contain_point."""
    if box.kind != "(":
        return
    if box.WV < 0:
        mx = box.hV
        mn = mx + box.WV
        if h < mn:
            box.WV = h - mx
        elif h > mx:
            box.hV = h
            box.WV = mn - h
    else:
        mn = box.hV
        mx = mn + box.WV
        if h < mn:
            box.hV = h
            box.WV = mx - h
        elif h > mx:
            box.WV = h - mn
    n = box.vV
    if v < n - box.HV:
        box.HV = n - v
    elif v > n + box.DV:
        box.DV = v - n


def _contain_box(box, b):
    """_synctex_make_hbox_contain_box; b = (min_h, min_v, max_h, max_v)."""
    if box.kind != "(":
        return
    min_h, min_v, max_h, max_v = b
    if box.WV < 0:
        mx = box.hV
        mn = mx + box.WV
        if min_h < mn:
            box.WV = min_h - mx
        elif max_h > mx:
            box.hV = max_h
            box.WV = mn - max_h
    else:
        mn = box.hV
        mx = mn + box.WV
        if min_h < mn:
            box.hV = min_h
            box.WV = mx - min_h
        elif max_h > mx:
            box.WV = max_h - mn
    n = box.vV
    if min_v < n - box.HV:
        box.HV = n - min_v
    elif max_v > n + box.DV:
        box.DV = max_v - n


def _distance_to_box(hh, hv, b):
    """_synctex_distance_to_box_v2: L1 outside the corners, 0 inside."""
    min_h, min_v, max_h, max_v = b
    if hv < min_v:
        if hh < min_h:
            return min_v - hv + min_h - hh
        if hh <= max_h:
            return min_v - hv
        return min_v - hv + hh - max_h
    if hv <= max_v:
        if hh < min_h:
            return min_h - hh
        if hh <= max_h:
            return 0
        return hh - max_h
    if hh < min_h:
        return hv - max_v + min_h - hh
    if hh <= max_h:
        return hv - max_v
    return hv - max_v + hh - max_h


def _h_ordered(hh, n):
    """_synctex_point_h_ordered_distance_v2: >0 right of hit, <0 left, 0 over."""
    k = n.kind
    if k in "[vh" or k == "(":
        if k == "(":
            width, mn = n.WV, n.hV
        else:
            width, mn = n.W, n.h
        mx = mn + abs(width)
        if hh < mn:
            return mn - hh
        if hh > mx:
            return mx - hh
        return 0
    if k == "k":
        mx = n.W
        if mx < 0:
            mn = n.h
            mx = mn - mx
        else:
            mn = -mx
            mx = n.h
            mn += mx
        med = (mn + mx) // 2
        if hh < mn:
            return mn - hh + 1
        if hh > mx:
            return mx - hh - 1
        if hh > med:
            return mx - hh + 1
        return mn - hh - 1
    if k in "rg$x" or k == _BDRY:
        return n.h - hh
    return _INF


def _v_ordered(hv, n):
    k = n.kind
    if k in "[vh":
        mn = n.v
        mx = mn + abs(n.D)
        mn -= abs(n.H)
    elif k == "(":
        mn = n.vV
        mx = mn + abs(n.DV)
        mn -= abs(n.HV)
    elif k in "rkg$":
        p = n.parent
        mn = n.v
        mx = mn + abs(p.D if p else 0)
        mn -= abs(p.H if p else 0)
    else:
        return _INF
    if hv < mn:
        return mn - hv
    if hv > mx:
        return mx - hv
    return 0


def _in_box(hh, hv, n):
    return _h_ordered(hh, n) == 0 and _v_ordered(hv, n) == 0


def _node_distance(hh, hv, n):
    """_synctex_point_node_distance_v2."""
    k = n.kind
    if k == "[":
        return _distance_to_box(hh, hv, (n.h, n.v - abs(n.H), n.h + abs(n.W), n.v + abs(n.D)))
    if k == "(":
        return _distance_to_box(hh, hv, (n.hV, n.vV - abs(n.HV), n.hV + abs(n.WV), n.vV + abs(n.DV)))
    if k in "vh":
        top, bottom = n.v - abs(n.H), n.v + abs(n.D)
        d = _distance_to_box(hh, hv, (n.h, top, n.h, bottom))
        right = n.h + abs(n.W)
        dd = _distance_to_box(hh, hv, (right, top, right, bottom))
        return min(d, dd)
    p_height = abs(n.parent.H) if n.parent is not None else 0
    if k == "k":
        d = _distance_to_box(hh, hv, (n.h, n.v - p_height, n.h, n.v))
        left = n.h - n.W
        dd = _distance_to_box(hh, hv, (left, n.v - p_height, left, n.v))
        return min(d, dd)
    if k in "g$x" or k == _BDRY:
        return _distance_to_box(hh, hv, (n.h, n.v - p_height, n.h, n.v))
    return _INF


def _smallest_container(node, other):
    def dims(n):
        return abs(n.WV), abs(n.DV) + abs(n.HV)
    w, th = dims(node)
    ow, oth = dims(other)
    area, other_area = th * w, oth * ow
    if area != other_area:
        return node if area < other_area else other
    if abs(node.W) != abs(other.W):
        return node if abs(node.W) > abs(other.W) else other
    if th != oth:
        return node if th < oth else other
    return node


def _deepest_v2(hh, hv, node):
    if node is None or not node.children:
        return None
    for child in node.children:
        if _in_box(hh, hv, child):
            deep = _deepest_v2(hh, hv, child)
            if deep is not None:
                return deep
    if node.kind == "[":
        best, best_d = None, _INF
        for child in node.children:
            if child.children:
                d = _node_distance(hh, hv, child)
                if d <= best_d:
                    best, best_d = child, d
        if best is not None:
            return best
    if _in_box(hh, hv, node):
        return node
    return None


def _deepest_v3(hh, hv, node):
    if node is not None and node.children:
        for child in node.children:
            deep = _deepest_v3(hh, hv, child)
            if deep[0] is not None:
                return deep
        if node.kind == "[":
            best = (None, _INF)
            for child in node.children:
                if child.children:
                    d = _node_distance(hh, hv, child)
                    if d < best[1]:
                        best = (child, d)
            if best[0] is not None:
                return best
        if _in_box(hh, hv, node):
            return (node, 0)
    return (None, _INF)


def _closest_deep_child(hh, hv, node):
    best = (None, _INF)
    for child in node.children:
        if child.kind in _BOXES:
            nd = _closest_deep_child(hh, hv, child)
        else:
            nd = (child, _node_distance(hh, hv, child))
        if nd[1] < best[1] or (nd[1] == best[1] and (nd[0] is None or nd[0].kind != "k")):
            best = nd
    return best


def _prefer(current, candidate):
    """Tie-break between two equally distant nodes: the earlier line wins."""
    cur = current[0]
    node = candidate[0]
    return cur is not None and cur.tag == node.tag and cur.line > node.line


def _closest_children(hh, hv, node):
    """_synctex_eq_get_closest_children_in_box_v2 -> ((l, dl), (r, dr))."""
    left = right = (None, _INF)
    if not node.children:
        return left, right
    if node.kind != "(":
        # The vbox variant in synctex_parser.c never looks at the children
        # (it reads the child of a NULL node), so a vbox yields nothing and
        # the caller falls back to the box itself.
        return left, right
    for child in node.children:
        d = _h_ordered(hh, child)
        if d > 0:
            if right[1] > d or (right[1] == d and _prefer(right, (child, d))):
                right = (child, d)
        elif d == 0:
            if child.children:
                return _closest_children(hh, hv, child)
            left = (child, 0)
        else:
            d = -d
            if left[1] > d or (left[1] == d and _prefer(left, (child, d))):
                left = (child, d)
    narrowed = []
    for side in (left, right):
        if side[0] is not None:
            nd = _deepest_v3(hh, hv, side[0])
            if nd[0] is not None:
                side = nd
            nd = _closest_deep_child(hh, hv, side[0])
            if nd[0] is not None:
                side = (nd[0], side[1])
        narrowed.append(side)
    return narrowed[0], narrowed[1]


class SynctexData(object):
    """One parsed synctex file: its inputs and a node tree per page."""

    def __init__(self, text):
        self.inputs = {}        # tag -> file name as the engine recorded it
        self.pages = {}         # page -> top-level nodes
        self.hboxes = {}        # page -> hboxes, most recently closed first
        self.friends = {}       # (tag, line) -> [(page, node), ...]
        self.max_line = {}      # tag -> highest line of a box from that input
        pre_unit = 8192.0
        pre_mag = 1000.0
        pre_x = pre_y = 578.0
        post_mag = None
        self._bound = 1500000
        self._parse(text)
        header = self._header
        pre_unit = _num(header.get("Unit"), pre_unit) or 8192.0
        pre_mag = _num(header.get("Magnification"), pre_mag) or 1000.0
        pre_x = _num(header.get("X Offset"), pre_x)
        pre_y = _num(header.get("Y Offset"), pre_y)
        tail = text[text.rfind("Post scriptum:"):] if "Post scriptum:" in text else ""
        for raw in tail.splitlines()[1:]:
            if raw.startswith("Magnification:"):
                post_mag = _num(raw.split(":", 1)[1], None)
        self.unit = (post_mag or 1.0) * pre_unit / _SP_PER_BP * pre_mag / 1000.0
        self.x_offset = pre_x * (pre_unit / _SP_PER_BP)
        self.y_offset = pre_y * (pre_unit / _SP_PER_BP)
        self._bound = int(1500000 / (pre_mag / 1000.0))

    # -- parsing ----------------------------------------------------------

    def _file(self, page, node):
        node.friend = (node.tag, node.line)
        self.friends.setdefault(node.friend, []).append((page, node))

    def _parse(self, text):
        page = None
        stack = []
        last_k = last_g = None
        in_form = False
        lines = text.split("\n")
        start = 0
        self._header = {}
        for i, raw in enumerate(lines):
            if raw.startswith("Content:"):
                start = i + 1
                break
            if raw.startswith("Input:"):
                tag, _, name = raw[6:].partition(":")
                self.inputs[_int(tag)] = name
            else:
                key, _, value = raw.partition(":")
                self._header[key] = value.strip()
        for raw in lines[start:]:
            if not raw:
                continue
            c = raw[0]
            if in_form:
                if c == ">":
                    in_form = False
                continue
            if c == "<":
                in_form = True
                continue
            if page is None:
                if c == "{":
                    page = _int(raw[1:])
                    self.pages.setdefault(page, [])
                    self.hboxes.setdefault(page, [])
                    stack = []
                    # x records at the head of each open box, waiting for the
                    # next node to tell them their real line (see _settle).
                    pending = [[]]
                elif raw.startswith("Input:"):
                    tag, _, name = raw[6:].partition(":")
                    self.inputs[_int(tag)] = name
                elif raw.startswith("Postamble:"):
                    break
                continue
            parent = stack[-1] if stack else None
            siblings = parent.children if parent is not None else self.pages[page]

            if c in "([":
                node = _record(raw, parent)
                if node is None:
                    continue
                siblings.append(node)
                stack.append(node)
                pending.append([])
                self._register_line(node)
                if c == "(":
                    bdry = _Node(_BDRY, node.tag, node.line, node.h, node.v, parent=node)
                    node.children.append(bdry)
                    self._file(page, bdry)
                last_k = last_g = None
            elif c in "])":
                if parent is not None and parent.kind == ("[" if c == "]" else "("):
                    if c == ")":
                        self._close_hbox(parent, last_k, last_g)
                        self.hboxes[page].append(parent)
                    stack.pop()
                    if c == "]" and not parent.children:
                        self._file(page, parent)    # only empty vboxes are filed
                    # Heads never settled inside the box keep their own line;
                    # heads waiting in the enclosing box take the box's.
                    for x in pending.pop():
                        self._file(page, x)
                    self._settle(page, pending[-1], parent)
                    if c == ")" and stack:
                        _contain_box(stack[-1], _hbox_box(parent))
                last_k = last_g = None
            elif c in _LEAVES:
                node = _record(raw, parent)
                if node is None:
                    continue
                prev = siblings[-1] if siblings else None
                siblings.append(node)
                self._register_line(node)
                if c == "x":
                    # "Sometimes, the first nodes of a box have the wrong line
                    # number. These are only boundary (x) nodes." A box's
                    # leading x records take the line of the node after them.
                    if (prev is not None and prev.kind == _BDRY) or pending[-1]:
                        pending[-1].append(node)
                    else:
                        self._file(page, node)
                else:
                    if c in "kgr$":
                        self._file(page, node)
                    self._settle(page, pending[-1], node)
                # Rules and void vboxes do not stretch the visible box
                # ("Rules are sometimes far too big").
                if parent is not None:
                    if c == "h":
                        _contain_box(parent, _data_box(node))
                    elif c == "k":
                        _contain_box(parent, _kern_box(node))
                    elif c in "g$x":
                        _contain_point(parent, node.h, node.v)
                if c == "k":
                    last_k, last_g = node, None
                elif c == "g" and last_k is not None:
                    last_g = node
                else:
                    last_k = last_g = None
            elif c == "}":
                # Most recently closed first, the order synctex scans them in.
                self.hboxes[page].reverse()
                page = None
                stack = []
                last_k = last_g = None
            elif raw.startswith("Input:"):
                tag, _, name = raw[6:].partition(":")
                self.inputs[_int(tag)] = name
            else:
                # anchors ("!"), form refs ("f"), characters ("c") ...
                if c in "fc":
                    last_k = last_g = None

    def _register_line(self, node):
        self.max_line[node.tag] = max(self.max_line.get(node.tag, 0), node.line)

    def _settle(self, page, heads, node):
        """Leading x records take node's tag and line, then get filed."""
        for x in heads:
            x.tag, x.line = node.tag, node.line
            self._file(page, x)
        del heads[:]

    def _close_hbox(self, box, last_k, last_g):
        kids = box.children
        start = kids[0]
        if len(kids) > 1:
            start.line = kids[1].line
            weight = total = 0
            for child in kids[1:]:
                if child.kind == "(":
                    if child.weight:
                        weight += child.weight
                        total += child.mean * child.weight
                    else:
                        weight += 1
                        total += child.mean
                else:
                    weight += 1
                    total += child.line
            box.mean = (total + weight // 2) // weight
            box.weight = weight
        else:
            box.mean = box.line
            box.weight = 1
        last = kids[-1]
        end = _Node(_BDRY, last.tag, last.line, box.hV + box.WV, box.vV, parent=box)
        kids.append(end)
        start.h, start.v = box.hV, box.vV
        if last_k is not None and last_g is not None:
            # A kern then glue closing the line (\parfillskip) belongs to the
            # text before it, not to the blank line that ended the paragraph.
            for prev, nxt in zip(kids, kids[1:]):
                if nxt is last_k:
                    last_k.tag, last_k.line = prev.tag, prev.line
                    last_g.tag, last_g.line = prev.tag, prev.line
                    break

    # -- coordinates ------------------------------------------------------

    def _visible_box(self, page, node):
        """The box `synctex view` prints for a match (h, bottom v, W, H)."""
        if node.kind == "(":
            h, v, W, H, D = node.hV, node.vV, node.WV, node.HV, node.DV
        else:
            h, v, W, H, D = node.h, node.v, node.W, node.H, node.D
        u = self.unit
        return {
            "page": page,
            "h": round(h * u + self.x_offset, 6),
            "v": round((v + D) * u + self.y_offset, 6),
            "W": round(W * u, 6),
            "H": round((H + D) * u, 6),
        }

    def _box_visible(self, node):
        """_synctex_node_box_visible: the line-sized box around a match."""
        if node.kind not in _BOXES:
            node = node.parent
            if node is None:
                return None
        mean = _mean_line(node)
        parent = node
        while parent.parent is not None:
            parent = parent.parent
            if parent.kind == "(":
                if abs(mean - _mean_line(parent)) > 1:
                    return node
                if parent.W > self._bound or parent.H + parent.D > self._bound:
                    return parent
                node = parent
        return node

    # -- forward: source line -> PDF boxes --------------------------------

    def tags_for(self, matches):
        """Input tags whose recorded name satisfies matches(name), in file order."""
        return [tag for tag in sorted(self.inputs) if matches(self.inputs[tag])]

    def forward(self, tags, line):
        """Boxes for `line` of the first of `tags`, like `synctex view`.

        A line that produced nothing (blank line, \\begin{...}) is answered by
        the nearest line that did: line+1, line-1, line+2, line-2, ...
        """
        if not tags:
            return []
        tag = tags[0]
        max_line = self.max_line.get(tag, 0)
        line = min(line, max_line)
        offset = 1
        for _ in range(100):
            if line > max_line:
                continue
            hits = self._query(tag, line, exclude_box=True) or self._query(tag, line, exclude_box=False)
            if hits:
                boxes, seen = [], set()
                for page, node in hits:
                    box = self._box_visible(node)
                    if box is None:
                        continue
                    b = self._visible_box(page, box)
                    key = (b["page"], b["h"], b["v"], b["W"], b["H"])
                    if key not in seen:
                        seen.add(key)
                        boxes.append(b)
                boxes.sort(key=lambda b: (b["page"], b["v"], b["h"]))
                return boxes
            line += offset
            offset = -(offset - 1) if offset < 0 else -(offset + 1)
            if line <= 0:
                line += offset
                offset = -(offset - 1) if offset < 0 else -(offset + 1)
        return []

    def _query(self, tag, line, exclude_box):
        return [(page, node) for page, node in self.friends.get((tag, line), ())
                if (node.tag, node.line) == node.friend
                and not (exclude_box and node.kind in _BOXES)]

    # -- inverse: PDF point -> source line --------------------------------

    def inverse(self, page, x, y):
        """[(tag, line), ...] behind the point (x, y) on `page`, best first.

        Like `synctex edit`: one answer, or two when the text on either side
        of the point comes from different lines.
        """
        roots = self.pages.get(page)
        if not roots:
            return []
        hh = int((x - self.x_offset) / self.unit)
        hv = int((y - self.y_offset) / self.unit)
        hboxes = self.hboxes.get(page, [])
        node = None
        for i, box in enumerate(hboxes):
            if _in_box(hh, hv, box):
                node = box
                for other in hboxes[i + 1:]:
                    if _in_box(hh, hv, other):
                        node = _smallest_container(other, node)
                node = _deepest_v2(hh, hv, node)
                left, right = _closest_children(hh, hv, node)
                break
        else:
            node = roots[0]
            left, right = _closest_deep_child(hh, hv, node), (None, _INF)
        l, r = left[0], right[0]
        if l is not None and r is not None:
            if (l.tag, l.line) != (r.tag, r.line):
                if r.line < l.line or (r.line == l.line and left[1] > right[1]):
                    l, r = r, l
                return [(l.tag, l.line), (r.tag, r.line)]
            if left[1] > right[1]:
                l = r
        elif r is not None:
            l = r
        elif l is None:
            l = node
        return [(l.tag, l.line)] if l is not None else []


def _mean_line(node):
    if node.mean is not None:
        return node.mean
    if node.parent is not None and node.parent.mean is not None:
        return node.parent.mean
    return node.line


def _record(raw, parent):
    kind = raw[0]
    parts = raw[1:].split(":")
    if len(parts) < 2:
        return None
    link = parts[0].split(",")
    pos = parts[1].split(",")
    if len(link) < 2 or len(pos) < 2:
        return None
    size = parts[2].split(",") if len(parts) > 2 else []
    try:
        tag, line = int(link[0]), int(link[1])
        h, v = int(pos[0]), int(pos[1])
        W = int(size[0]) if size else 0
        H = int(size[1]) if len(size) > 1 else 0
        D = int(size[2]) if len(size) > 2 else 0
    except ValueError:
        return None
    return _Node(kind, tag, line, h, v, W, H, D, parent)


def _int(value):
    try:
        return int(value)
    except ValueError:
        return 0


def _num(value, default):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


_cache = {}


def load(path):
    """Parsed data for the .synctex.gz / .synctex at path, cached by mtime."""
    stamp = os.path.getmtime(path)
    hit = _cache.get(path)
    if hit and hit[0] == stamp:
        return hit[1]
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rb") as f:
        # latin-1 keeps every byte; file names are decoded as UTF-8 on demand.
        text = f.read().decode("latin-1")
    data = SynctexData(text)
    _cache.clear()   # one document open at a time; keep memory flat
    _cache[path] = (stamp, data)
    return data
