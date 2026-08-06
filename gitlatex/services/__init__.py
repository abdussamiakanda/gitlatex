"""Domain logic, independent of HTTP.

Nothing here imports Flask request state or returns responses - these modules
take plain arguments and return plain data, so they can be used from a script
or a test without a running server. The thin blueprints in gitlatex/routes/
are what turn them into endpoints.

    spell          LaTeX-aware spell checking on top of symspellpy
    latex          running the engine + bibtex/biber, and parsing the log
    projectindex   parsing \\label{} definitions and BibTeX entries
    paths          path safety and project tree walking
    updates        the cached PyPI version check
    gitrepo        opening/closing repos and reading blobs
    git_backend    the optional GitPython import, isolated
"""
