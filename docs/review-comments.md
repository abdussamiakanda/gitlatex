# Review comments

An Overleaf-style review panel for leaving comments on your text.

- **Add a comment:** select some text (or put the cursor on a line) and click
  **Add comment** in the panel, press `Cmd`+`Option`+`M` / `Ctrl`+`Alt`+`M`, or
  right-click → **Add Comment**.
- **Open the panel** with the **Review comments** icon in the left bar. Its badge
  shows how many comments are open in the current file.
- Comment cards line up with the text they are about and scroll with the editor.
  Commented text is highlighted, with a marker in the margin.
- **Hover** over commented text to see a preview of the comment. Click the
  preview to open that thread in the review panel.
- **Reply** (`Enter` sends, `Shift`+`Enter` adds a new line), **resolve** or
  **reopen**, and **delete** threads or your own replies. Tick **Resolved** in the
  panel to show resolved threads.
- Comments are **signed with your git identity** (`user.name` and `user.email`),
  the same one your commits use.
- Comments **stay attached to their text** as you edit, find it again after a
  pull, and follow a file when you rename it. Deleting a file removes its
  comments.

## Shared through Git

Each thread is a small JSON file in `.gitlatex/comments/` inside the project, so
comments are pushed and pulled with your files. Each thread has its own file, so
two people starting threads at the same time won't get merge conflicts, and
replies made on both sides of a pull are combined automatically (the app
registers a git merge driver for these files, so this also works for `git pull`
in a terminal). See [sync-and-conflicts.md](sync-and-conflicts.md#review-comments)
for the details.
