# Cursor page after compilation

After a successful compile, GitLaTeX opens the PDF page corresponding to the
editor cursor captured when that build started. Included `.tex` files work
through the existing SyncTeX mapping. This applies to both the React interface
and `/classic`.

On that page, visible differences from the previously displayed PDF are marked
for three seconds (in the theme's accent colour; amber in `/classic`). An unchanged rendering produces no highlight.
This is a visual comparison, so moved text, changed figures, and removed content
can all mark a region. The comparison is limited to the cursor page; it does not
navigate to other changed pages. It is not a semantic word-by-word diff.

No highlight is shown on the first load, when there is no previous matching
page, or if the page dimensions change. Tiny antialiasing differences are
ignored. The browser's native PDF viewer supports page navigation but does not
support these overlays; use the built-in PDF.js viewer for highlights.

SyncTeX must be available for cursor navigation. The local and browser compilers
already generate it. A remote Compiler API must return it with the PDF (or, for
the classic UI, return a mapped `page` number). Without a usable mapping, the
built-in viewer keeps its existing scroll behavior. A failed build does not
trigger cursor navigation or new change highlights.

## Manual check

1. Open a multipage document and compile it once.
2. Put the editor cursor in text on a later page, then compile without edits.
   The viewer should open that page without a highlight.
3. Edit text on that page and compile again. Visible differences should be
   marked for three seconds, then disappear.
4. Repeat from a `.tex` file included by the main document.
5. Try a compile error: it must not create a new change highlight.
