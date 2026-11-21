"""CLI wrapper — the logic lives in src/public_data.py.

    python scripts/probe_sources.py "Victorinox AG" "Schmiedgasse 57, 6438 Ibach"
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.public_data import main  # noqa: E402

if __name__ == "__main__":
    main()
