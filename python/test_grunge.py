import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "python/grunge.py"
SIZE = (160, 90)
MATTE = (22, 22, 22, 255)


class GrungeCliTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="grunge-cli-")
        self.addCleanup(self.temporary.cleanup)
        self.work = Path(self.temporary.name).resolve()
        self.artwork = self.work / "artwork.png"
        image = Image.new("RGBA", SIZE, (0, 255, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.rectangle((20, 20, 65, 70), fill=(240, 80, 40, 128))
        draw.rectangle((90, 20, 140, 70), fill=(250, 245, 230, 255))
        image.save(self.artwork)

    def run_cli(self, name, *options, script=CLI):
        output = self.work / name
        result = subprocess.run(
            [sys.executable, "-I", str(script), str(self.artwork), str(output), *options],
            cwd=self.work,
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Seed ", result.stdout)
        return output, json.loads((output / "settings.json").read_text())

    def read_image(self, path):
        with Image.open(path) as image:
            return image.copy()

    def expected_preview(self, layer, background=None):
        if background is not None:
            layer = Image.alpha_composite(background, layer)
        return Image.alpha_composite(Image.new("RGBA", layer.size, MATTE), layer).convert("RGB")

    def assert_sheet(self, output, preview):
        sheet = self.read_image(output / "contact-sheet.png")
        self.assertEqual(sheet.mode, "RGB")
        self.assertEqual(sheet.size, (1280, 391))
        tile = preview.convert("RGBA").resize((640, 360), Image.Resampling.LANCZOS)
        expected = self.expected_preview(tile)
        for left in (0, 640):
            actual = sheet.crop((left, 31, left + 640, 391))
            self.assertEqual(actual.tobytes(), expected.tobytes())
        return sheet

    def test_seed_repeatability_and_saved_settings(self):
        options = ("--preset", "heavy-metal", "--edge", "55", "--seed", "1402", "--variants", "2", "--paper", "#e9e1cf")
        first, receipt = self.run_cli("first", *options)
        second, repeated = self.run_cli("repeat", *options)
        self.assertEqual(receipt, repeated)
        self.assertEqual(receipt["canvas_size"], list(SIZE))
        self.assertEqual(receipt["preset"], "heavy-metal")
        self.assertEqual(receipt["edge"], 55)
        self.assertEqual(receipt["chips"], 40)
        self.assertEqual(receipt["spray"], 45)
        self.assertEqual(receipt["mottle"], 35)
        self.assertEqual(receipt["displacement"], 50)
        self.assertEqual(Path(receipt["mask"]).name, "03-deep-field.png")
        self.assertEqual(receipt["artwork_sha256"], hashlib.sha256(self.artwork.read_bytes()).hexdigest())
        self.assertEqual(receipt["paper"], "#e9e1cf")
        self.assertEqual([variant["seed"] for variant in receipt["variants"]], [1402, 1403])
        for variant in receipt["variants"]:
            for key in ("layer", "image"):
                self.assertEqual((first / variant[key]).read_bytes(), (second / variant[key]).read_bytes())
            layer = self.read_image(first / variant["layer"])
            self.assertEqual(layer.mode, "RGBA")
            self.assertEqual(layer.size, SIZE)
            self.assertEqual(layer.getchannel("A").getextrema()[0], 0)
            self.assertGreater(layer.getchannel("A").getextrema()[1], 0)
        self.assertNotEqual((first / "variation-01-layer.png").read_bytes(), (first / "variation-02-layer.png").read_bytes())
        self.assertEqual((first / "contact-sheet.png").read_bytes(), (second / "contact-sheet.png").read_bytes())

    def test_default_masks_through_skill_entry_points(self):
        cases = (
            (ROOT / ".agents/skills/grunge-text/scripts/grunge.py", "professional", "02-night-dust.png"),
            (ROOT / ".claude/skills/grunge-text/scripts/grunge.py", "family-dinner", "04-dry-ink.png"),
            (CLI, "shred", "01-breaking-foam.png"),
        )
        for script, preset, mask in cases:
            with self.subTest(script=script, preset=preset):
                output, receipt = self.run_cli(preset, "--preset", preset, "--seed", "1402", script=script)
                self.assertEqual(Path(receipt["mask"]).name, mask)
                self.assertEqual(receipt["mask_sha256"], hashlib.sha256((ROOT / "public/masks" / mask).read_bytes()).hexdigest())
                self.assertEqual(self.read_image(output / "variation-01-layer.png").size, SIZE)
                self.assertIsNone(receipt["variants"][0]["image"])

    def test_transparent_and_partial_alpha_contact_sheet(self):
        output, receipt = self.run_cli("transparent", "--seed", "9", "--variants", "2")
        artwork = self.read_image(self.artwork)
        layer = self.read_image(output / "variation-01-layer.png")
        self.assertEqual(layer.tobytes(), artwork.tobytes())
        self.assertFalse((output / "variation-01.png").exists())
        self.assertIsNone(receipt["variants"][0]["image"])
        sheet = self.assert_sheet(output, artwork)
        self.assertEqual(sheet.getpixel((10, 41)), (22, 22, 22))
        expected_partial = tuple(round((value * 128 + 22 * 127) / 255) for value in (240, 80, 40))
        self.assertEqual(sheet.getpixel((160, 211)), expected_partial)
        self.assertEqual(sheet.getpixel((460, 211)), (250, 245, 230))

    def test_semitransparent_background_preview_and_layer(self):
        background = Image.new("RGBA", SIZE, (60, 120, 180, 128))
        path = self.work / "background.png"
        background.save(path)
        output, receipt = self.run_cli("background", "--seed", "9", "--variants", "2", "--background", str(path))
        artwork = self.read_image(self.artwork)
        layer = self.read_image(output / "variation-01-layer.png")
        self.assertEqual(layer.tobytes(), artwork.tobytes())
        preview = self.read_image(output / "variation-01.png")
        self.assertEqual(preview.mode, "RGB")
        self.assertEqual(preview.tobytes(), self.expected_preview(artwork, background).tobytes())
        self.assertEqual(preview.getpixel((0, 0)), (41, 71, 101))
        self.assertEqual(receipt["background_sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
        self.assert_sheet(output, preview)

    def test_semitransparent_paper_preview(self):
        output, receipt = self.run_cli("paper", "--seed", "9", "--paper", "#3c78b480")
        layer = self.read_image(output / "variation-01-layer.png")
        background = Image.new("RGBA", SIZE, (60, 120, 180, 128))
        preview = self.read_image(output / "variation-01.png")
        self.assertEqual(preview.tobytes(), self.expected_preview(layer, background).tobytes())
        self.assertEqual(layer.getpixel((0, 0))[3], 0)
        self.assertEqual(receipt["paper"], "#3c78b480")

    def make_custom_mask(self):
        path = self.work / "custom-mask.png"
        values = np.random.default_rng(7).integers(0, 256, (180, 320), dtype=np.uint8)
        Image.fromarray(values).save(path)
        return path

    def test_explicit_custom_mask(self):
        mask = self.make_custom_mask()
        output, receipt = self.run_cli("custom", "--mask", mask.name, "--preset", "professional", "--seed", "21")
        self.assertEqual(receipt["mask"], str(mask))
        self.assertEqual(receipt["mask_sha256"], hashlib.sha256(mask.read_bytes()).hexdigest())
        self.assertNotEqual(self.read_image(output / "variation-01-layer.png").tobytes(), self.read_image(self.artwork).tobytes())

    def test_built_download_with_explicit_mask(self):
        built = ROOT / "dist/grunge.py"
        self.assertTrue(built.is_file(), "Run pnpm check before the Python suite.")
        downloaded = self.work / "grunge.py"
        shutil.copyfile(built, downloaded)
        mask = self.make_custom_mask()
        output, receipt = self.run_cli("download", "--mask", str(mask), "--preset", "professional", "--seed", "21", script=downloaded)
        self.assertEqual(receipt["mask_sha256"], hashlib.sha256(mask.read_bytes()).hexdigest())
        self.assertEqual(self.read_image(output / "variation-01-layer.png").size, SIZE)


if __name__ == "__main__":
    unittest.main()
