import json
import tempfile
import unittest
from pathlib import Path

from analyze import suggest_cuts


class TranscriptPauses(unittest.TestCase):
    def suggestions(self, words, silences):
        with tempfile.TemporaryDirectory(prefix="qassa-pause-test-") as tmp:
            out = Path(tmp)
            (out / "silences.json").write_text(json.dumps(silences), encoding="utf-8")
            if words is not None:
                (out / "transcript.json").write_text(json.dumps({"segments": [], "words": [
                    {"i": i, "t0": a, "t1": b, "w": f"word{i}"} for i, (a, b) in enumerate(words)
                ]}), encoding="utf-8")
            return [s for s in suggest_cuts(out, {"duration": 10}, "m") if s["reason"] == "silence"]

    def test_music_masked_gap_and_shorter_than_threshold(self):
        cuts = self.suggestions([(0.1, 1), (2.7, 3), (3.6, 4), (4.21, 5)], [])
        self.assertEqual([(s["t0"], s["t1"]) for s in cuts], [(1.12, 2.6)])

    def test_energy_and_transcript_gaps_do_not_duplicate(self):
        for energy in [[[1, 2.7]], [[1.1, 2.5]], [[1, 2.7], [1, 2.7]]]:
            cuts = self.suggestions([(0.1, 1), (2.7, 3)], energy)
            self.assertEqual(len(cuts), 1)
            self.assertEqual((cuts[0]["t0"], cuts[0]["t1"]), (1.12, 2.6))

    def test_energy_only_stays_available_without_transcript(self):
        cuts = self.suggestions(None, [[1, 2.7]])
        self.assertEqual([(s["t0"], s["t1"]) for s in cuts], [(1.12, 2.6)])

    def test_overlapping_words_are_not_a_pause(self):
        self.assertEqual(self.suggestions([(0.1, 3), (1, 1.5), (3.1, 4)], []), [])


if __name__ == "__main__":
    unittest.main()
