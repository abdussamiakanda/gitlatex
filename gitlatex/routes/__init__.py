"""HTTP routes, one blueprint per area of the UI.

Adding an endpoint means editing (or adding) one module here and listing its
blueprint below - nothing else in the app needs to know about it.

    pages         index.html and everything under public/
    system        version info and the PyPI update check
    repos         listing, selecting, cloning and deleting projects
    files         reading and writing files inside a project
    compile       building the document and serving the PDF
    projectindex  labels and citation keys for autocomplete
    spell         spell checking
    git           push, pull, status, history and diffs

`pages` is registered last: its catch-all route serves index.html for unknown
paths, so every real endpoint must be matched before it.
"""

from gitlatex.routes import (
    compile as compile_routes,
    files,
    git,
    pages,
    projectindex,
    repos,
    spell,
    system,
)

BLUEPRINTS = (
    system.bp,
    repos.bp,
    files.bp,
    compile_routes.bp,
    projectindex.bp,
    spell.bp,
    git.bp,
    pages.bp,
)


def register_blueprints(app):
    for bp in BLUEPRINTS:
        app.register_blueprint(bp)
