"""Apply seeded print wear to a transparent artwork layer.

Knobs run from 0 (off) to 100 (far too much). Pixel sizes are tuned at 1280 x 720 and scale with the canvas.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt, gaussian_filter, label, map_coordinates, maximum_filter

ASSETS = Path(__file__).resolve().parent.parent / "public" / "masks"
PREVIEW_MATTE = "#161616"
REFERENCE_SIZE = (1280, 720)
OUTLINE_RAMP = 10
KNOBS = ("chips", "edge", "spray", "mottle", "displacement")
MAXIMUM = {"chips": 20, "edge": 40, "spray": 16, "mottle": 14, "displacement": 12}
PRESETS = {
    "off": {"chips": 0, "edge": 0, "spray": 0, "mottle": 0, "displacement": 0, "mask": "03-deep-field"},
    "professional": {"chips": 0, "edge": 35, "spray": 0, "mottle": 10, "displacement": 0, "mask": "02-night-dust"},
    "family-dinner": {"chips": 10, "edge": 45, "spray": 0, "mottle": 20, "displacement": 15, "mask": "04-dry-ink"},
    "shred": {"chips": 25, "edge": 25, "spray": 65, "mottle": 25, "displacement": 35, "mask": "01-breaking-foam"},
    "heavy-metal": {"chips": 40, "edge": 80, "spray": 45, "mottle": 35, "displacement": 50, "mask": "03-deep-field"},
    "wtf": {"chips": 70, "edge": 70, "spray": 100, "mottle": 60, "displacement": 90, "mask": "01-breaking-foam"},
}


def multiplier(knob, percent):
    return (MAXIMUM[knob] + 1) ** (percent / 100) - 1


def smoothstep(edge0, edge1, values):
    t = np.clip((values - edge0) / (edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)


def unit(values):
    return (values - values.mean()) / (values.std() + 1e-9)


def mask_path(mask):
    path = Path(mask)
    return path if path.suffix else ASSETS / f"{mask}.png"


def load_mask(path):
    with Image.open(path) as image:
        texture = np.asarray(image.convert("L"), dtype=np.float32) / 255
    if texture.min() == texture.max():
        raise ValueError("Choose a mask with both light and dark pixels.")
    return texture


def window(texture, rng, coverage, size):
    width, height = size
    fit = min(texture.shape[1] / width, texture.shape[0] / height) * coverage
    half_w, half_h = width * fit / 2, height * fit / 2
    cx = rng.uniform(half_w, texture.shape[1] - half_w)
    cy = rng.uniform(half_h, texture.shape[0] - half_h)
    crop = Image.fromarray(texture).resize(size, Image.Resampling.LANCZOS, box=(cx - half_w, cy - half_h, cx + half_w, cy + half_h))
    return np.clip(np.asarray(crop), 0, 1)


def grainy_gray(mask, grain, scale):
    """Keep solid marks and their soft edges. Flat gray interiors become broken, thin ink."""
    solid = maximum_filter(mask, max(3, int(round(3 * scale)) | 1)) > 0.9
    return np.where(solid, mask, np.clip(mask * (1 + 0.6 * grain), 0, 1))


def layered_marks(texture, seed, stream, amount, size, shape):
    """Amount 1 is one 75% crop of the mask. Higher amounts add crops. Lower amounts keep fewer whole marks."""
    sequence = np.random.SeedSequence([seed, stream])
    rank_rng = np.random.default_rng([seed, stream, 9])
    total = np.zeros(size[::-1], dtype=np.float32)
    for index in range(int(np.ceil(amount))):
        marks = window(texture, np.random.default_rng(sequence.spawn(1)[0]), 0.75, size)
        labels, count = label(marks > 0.03)
        ranks = np.concatenate([[2.0], rank_rng.random(count)])[labels]
        total = np.maximum(total, shape(marks) * (ranks < np.clip(amount - index, 0, 1)))
    return total


def wear(artwork, mask="03-deep-field", seed=1402, chips=0, edge=0, spray=0, mottle=0, displacement=0):
    """Return the worn artwork as a transparent RGBA image at the artwork's size."""
    rgba = np.asarray(artwork.convert("RGBA"), dtype=np.float32) / 255
    clean = rgba[..., 3]
    if not (clean > 0).any() or clean.min() > 0:
        raise ValueError("Use artwork with visible pixels and a transparent area.")
    size = artwork.size
    scale = float(np.sqrt(size[0] * size[1] / (REFERENCE_SIZE[0] * REFERENCE_SIZE[1])))
    texture = load_mask(mask_path(mask))
    levels = {"chips": chips, "edge": edge, "spray": spray, "mottle": mottle, "displacement": displacement}
    c, e, s, m, d = (multiplier(knob, float(np.clip(levels[knob], 0, 100))) for knob in KNOBS)
    strongest = max(float(np.clip(levels[knob], 0, 100)) for knob in KNOBS)
    if strongest == 0:
        return artwork.convert("RGBA").copy()
    outline = min(1.0, strongest / OUTLINE_RAMP)

    _, solid_index = distance_transform_edt(clean < 0.9, return_indices=True)
    colour = rgba[..., :3][solid_index[0], solid_index[1]]
    grain_rng, mottle_rng, rough_rng = (np.random.default_rng(x) for x in np.random.SeedSequence([seed, 0]).spawn(3))
    shape = size[::-1]
    grain = unit(gaussian_filter(grain_rng.random(shape), 1.0 * scale))
    film_noise = smoothstep(-1.5, 1.5, unit(gaussian_filter(mottle_rng.random(shape), 70 * scale)))
    rough = np.clip(unit(gaussian_filter(rough_rng.random(shape), 1.6 * scale)), -2.5, 2.5)
    density_rng, displacement_rng = (np.random.default_rng(x) for x in np.random.SeedSequence([seed, 4]).spawn(2))
    density = gaussian_filter(window(texture, density_rng, 1.0, size), 40 * scale)
    density = (density - density.min()) / (np.ptp(density) + 1e-9)
    field = np.asarray(np.gradient(gaussian_filter(window(texture, displacement_rng, 1 / (1.18 * 3), size), 32 * scale)))
    offsets = np.clip(field / (np.percentile(np.abs(field[:, clean > 0]), 90) + 1e-9), -1, 1)

    alpha = map_coordinates(clean, np.indices(shape, dtype=float) + offsets * 0.4375 * d * scale, order=1)
    spread = gaussian_filter(alpha, 0.9 * scale)
    edge_zone = smoothstep(0, 0.2, spread) * (1 - smoothstep(0.8, 1, spread))
    alpha = alpha * (1 - outline) + smoothstep(0.32, 0.68, spread + 0.07 * rough * edge_zone) * outline
    inside = alpha > 0
    distance_out, nearest = distance_transform_edt(~inside, return_indices=True)
    distance_in = distance_transform_edt(alpha > 0.5)

    cutouts = layered_marks(texture, seed, 1, c, size, lambda x: grainy_gray(x, grain, scale))
    cutouts *= (0.8 + 0.2 * np.maximum(np.exp(-distance_in / (10 * scale)), density)) * 0.95
    bites = layered_marks(texture, seed, 3, e, size, lambda x: smoothstep(0.3, 0.55, x))
    bites *= 1 - smoothstep((2 + 0.15 * max(e - 1, 0)) * scale, (5 + 0.25 * max(e - 1, 0)) * scale, distance_in)
    reach = max(s, 1e-6) ** 0.5
    flecks = layered_marks(texture, seed, 2, s, size, lambda x: grainy_gray(x, grain, scale))
    flecks *= np.exp(-distance_out / (6 * reach * scale)) * (distance_out <= 26 * reach * scale)
    film = np.clip(1 - 0.06 * m * film_noise, 0, 1)

    alpha = np.clip(alpha * (1 - cutouts) * (1 - bites) * film + flecks * ~inside, 0, 1)
    layer = np.dstack([colour[nearest[0], nearest[1]], alpha])
    return Image.fromarray(np.uint8(np.round(layer * 255)), "RGBA")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def flatten(image):
    matte = Image.new("RGBA", image.size, PREVIEW_MATTE)
    return Image.alpha_composite(matte, image.convert("RGBA")).convert("RGB")


def contact_sheet(images, size):
    columns = min(2, len(images))
    tile_w = 640
    tile_h = round(tile_w * size[1] / size[0])
    rows = (len(images) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * tile_w, rows * (tile_h + 31)), PREVIEW_MATTE)
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=17)
    for index, image in enumerate(images):
        left, top = index % columns * tile_w, index // columns * (tile_h + 31)
        draw.text((left + 10, top + 5), f"Variation {index + 1}", fill="white", font=font)
        tile = image.convert("RGBA").resize((tile_w, tile_h), Image.Resampling.LANCZOS)
        sheet.paste(flatten(tile), (left, top + 31))
    return sheet


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("artwork", type=Path, help="Transparent PNG at the final canvas size.")
    parser.add_argument("output", type=Path, help="New or empty output directory.")
    parser.add_argument("--preset", choices=PRESETS, default="off", help="Starting knob values and mask.")
    for knob in KNOBS:
        parser.add_argument(f"--{knob}", type=float, help=f"0 to 100. Overrides the preset.")
    parser.add_argument("--mask", help="Bundled mask name or a grayscale mask path. Overrides the preset.")
    parser.add_argument("--background", type=Path, help="Background at the canvas size. Preview alpha uses an opaque #161616 matte.")
    parser.add_argument("--paper", help="Background colour, such as '#e9e1cf'. Preview alpha uses an opaque #161616 matte.")
    parser.add_argument("--seed", type=int, help="Omit to choose and record a new seed.")
    parser.add_argument("--variants", type=int, default=1, help="Consecutive seeds to render.")
    args = parser.parse_args()

    settings = dict(PRESETS[args.preset])
    for knob in KNOBS:
        if getattr(args, knob) is not None:
            settings[knob] = getattr(args, knob)
    if args.mask:
        settings["mask"] = args.mask
    if any(not 0 <= settings[knob] <= 100 for knob in KNOBS) or args.variants < 1:
        parser.error("Use knob values from 0 to 100 and at least one variant.")
    if args.background and args.paper:
        parser.error("Use --background or --paper, not both.")
    if not mask_path(settings["mask"]).is_file():
        parser.error(f"Mask not found: {settings['mask']}")
    if args.output.exists() and (not args.output.is_dir() or any(args.output.iterdir())):
        parser.error("Choose a new or empty output directory.")
    with Image.open(args.artwork) as image:
        artwork = image.convert("RGBA")
    base = None
    if args.background:
        with Image.open(args.background) as image:
            base = image.convert("RGBA")
        if base.size != artwork.size:
            parser.error("Use a background at the artwork's canvas size.")
    elif args.paper:
        base = Image.new("RGBA", artwork.size, args.paper)

    seed = args.seed if args.seed is not None else int(np.random.SeedSequence().entropy % 2**31)
    args.output.mkdir(parents=True, exist_ok=True)
    receipt = {
        "artwork": str(args.artwork.resolve()),
        "artwork_sha256": sha256(args.artwork),
        "background_sha256": sha256(args.background) if args.background else None,
        "paper": args.paper,
        "canvas_size": list(artwork.size),
        "preset": args.preset,
        "mask": str(mask_path(settings["mask"]).resolve()),
        "mask_sha256": sha256(mask_path(settings["mask"])),
        **{knob: settings[knob] for knob in KNOBS},
        "variants": [],
    }
    previews = []
    for index in range(args.variants):
        variant_seed = seed + index
        layer = wear(artwork, settings["mask"], variant_seed, **{knob: settings[knob] for knob in KNOBS})
        name = f"variation-{index + 1:02}"
        layer.save(args.output / f"{name}-layer.png")
        preview = layer
        if base is not None:
            preview = flatten(Image.alpha_composite(base, layer))
            preview.save(args.output / f"{name}.png")
        previews.append(preview)
        receipt["variants"].append({"seed": variant_seed, "layer": f"{name}-layer.png", "image": f"{name}.png" if base is not None else None})
    if args.variants > 1:
        contact_sheet(previews, artwork.size).save(args.output / "contact-sheet.png")
    (args.output / "settings.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(f"Seed {seed}")


if __name__ == "__main__":
    main()
