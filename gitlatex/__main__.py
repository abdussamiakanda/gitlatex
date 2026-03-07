"""Allow running as python -m gitlatex."""
from gitlatex.server import main

if __name__ == "__main__":
    raise SystemExit(main() or 0)
