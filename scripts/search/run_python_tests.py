"""Run the Python regression tests (retired features stay retired, Pages asset bundle)."""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
SEARCH_MODULES = ("test_retired_analysis", "test_pages_asset_bundle")

if __name__ == "__main__":
    sys.path.insert(0, str(ROOT / "tests" / "v2"))
    suite = unittest.defaultTestLoader.loadTestsFromNames(SEARCH_MODULES)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
