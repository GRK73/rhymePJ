from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class RetiredAnalysisTests(unittest.TestCase):
    def test_analysis_runtime_is_retired(self) -> None:
        # The V1 sources remain available in Git history at 5df2ae8.
        self.assertFalse((ROOT / "public" / "js" / "lyricsAnalysis.js").exists())
        self.assertFalse((ROOT / "public" / "js" / "lyricsAnalysisMetrics.js").exists())

    def test_navigation_exposes_search_only(self) -> None:
        html = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("가사 한 줄 제작 AI", html)
        self.assertIn('data-search-mode="word"', html)
        self.assertIn('data-search-mode="linked"', html)
        self.assertNotIn('data-search-mode="generate"', html)
        self.assertNotIn("가사 세부 분석 (Beta)", html)
        self.assertNotIn("js/lyricsAnalysis.js", html)
        self.assertNotIn("js/lyricsAnalysisMetrics.js", html)


if __name__ == "__main__":
    unittest.main()
