# Git and version history

Every project is a plain folder. Git projects can be committed, pushed and
pulled from the editor; plain folders can be turned into a Git repository from
the Source control panel.

The project list shows which kind each project is: a folder with arrows for a
Git repository with a remote, a folder with the Git mark for a local-only
repository, and a plain folder for no Git.

## Source control panel

Modelled on VS Code's:

- **Stage and unstage** files, or all of them, and **discard** changes.
- **Commit** the staged changes (`Ctrl`/`Cmd`+`Enter`). With nothing staged,
  Commit takes every change.
- **Pull, push, sync or fetch**, with ahead/behind counts from the remote.
- **Create and switch branches**, or **publish** a local repository to a new
  remote.

## Merge conflicts

When a pull conflicts, the conflicting files are listed under **Merge Changes**.
Open each one and pick the current or incoming version for every conflict, or
take a whole file with its buttons, then commit to finish the merge.
[sync-and-conflicts.md](sync-and-conflicts.md) explains what push and pull do
and how to fix a conflict by hand.

## Version history

- **Version history panel** listing your commits, with the files each one touched
  and per-file insertion/deletion counts.
- **Side-by-side diffs** for any file in any commit, for your uncommitted working
  tree, or **between any two commits** you select.
