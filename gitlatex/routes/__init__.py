"""HTTP routes, one blueprint per area of the UI.

Adding an endpoint means editing (or adding) one module here and listing its
blueprint below - nothing else in the app needs to know about it.

    pages         index.html and everything under public/
    system        version info and the PyPI update check
    repos         listing, selecting, cloning and deleting projects
    files         reading and writing files inside a project
    compile       building the document and serving the PDF
    synctex       jumping between editor lines and PDF positions
    projectindex  labels and citation keys for autocomplete
    spell         spell checking
    snippets      the user's own editor snippets
    review        comment threads on lines of project files
    git          push, pull, status, history and diffs
    scm           the Source control panel: staging, conflicts, branches, publish
    workspace     the file API behind the editor UI in web/
    engine        the in-browser TeX engine and its package shelf

`pages` is registered last: its catch-all route serves the app for unknown
paths, so every real endpoint must be matched before it.
"""

from gitlatex.routes import (
    compile as compile_routes,
    engine,
    files,
    git,
    pages,
    projectindex,
    repos,
    review,
    scm,
    snippets,
    spell,
    synctex,
    system,
    workspace,
)

BLUEPRINTS = (
    system.bp,
    repos.bp,
    files.bp,
    compile_routes.bp,
    synctex.bp,
    projectindex.bp,
    spell.bp,
    snippets.bp,
    review.bp,
    git.bp,
    scm.bp,
    workspace.bp,
    engine.bp,
    pages.bp,
)


def register_blueprints(app):
    for bp in BLUEPRINTS:
        app.register_blueprint(bp)
