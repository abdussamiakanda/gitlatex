"""GitLaTeX IDE - LaTeX projects with Git support."""
try:
    from gitlatex._version import __version__  # written by setuptools-scm at build time
except ImportError:
    try:
        from importlib.metadata import version

        __version__ = version("gitlatex")
    except Exception:
        __version__ = "0.0.0+unknown"
