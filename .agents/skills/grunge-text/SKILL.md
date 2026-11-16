---
name: grunge-text
description: Apply seeded print wear with grunge.makon.dev or local scripts to display lettering, logos, or any transparent artwork layer. Use for distressed, printed, or grunge titles in video, thumbnails, and posters.
---

# Grunge Text

## Choose an entry point

- Use [the site](https://grunge.makon.dev) to preview and adjust settings by hand. In Chrome with WebMCP enabled, use `get_settings`, `update_settings`, `apply_preset`, `get_image`, and `get_code` to control the page.
- Use [engine.js](https://grunge.makon.dev/engine.js) or [engine.ts](https://grunge.makon.dev/engine.ts) when the render must match the site exactly with the same artwork, mask, settings, and seed.
- Use [grunge.py](scripts/grunge.py) for local batch renders, variants, and contact sheets. This link runs the canonical repository CLI at `python/grunge.py`. The `assets` link points to `public/masks`. It uses a different random generator than the site, so the marks will be in different positions.

Read [llms.txt](https://grunge.makon.dev/llms.txt) for details.

## Local renders

Make a transparent PNG of the artwork at the final canvas size, with the words or graphic in their final position. Keep the editable source. Keep small copy, labels, and logos that must stay clean on separate layers.

Set up the isolated Python environment from the repository root:

```sh
uv venv .venv
uv pip install --python .venv/bin/python -r python/requirements.txt
.venv/bin/python .agents/skills/grunge-text/scripts/grunge.py title.png renders-heavy --preset heavy-metal --seed 1402
.venv/bin/python .agents/skills/grunge-text/scripts/grunge.py title.png renders-calm --preset professional --edge 45 --background frame.png --variants 4
```

From another working directory, use absolute paths to the interpreter, script, and inputs. Mask names still resolve to `public/masks` in this repository.

Each variant gives a transparent `-layer.png` for the editor. With `--background` or `--paper`, it also gives an RGB preview. Previews and contact sheets use an opaque `#161616` matte behind any remaining alpha, including alpha in the background. The layer export keeps its transparency. With more than one variant, it gives a contact sheet. `settings.json` records the seed, knobs, mask, and source hashes. Use the same inputs, seed, and knobs to repeat a render. To call it from Python, import `wear()` from the script.

## Knobs

Each knob runs from 0 (off) to 100 (far too much). Each step changes the look by about the same amount.

- `--chips`: ink missing inside the shapes.
- `--edge`: chips that break the outline. Edge chips change the silhouette. At viewing size, they do more than any other knob.
- `--spray`: ink flecks outside the shapes. Use spray for energy. Keep it off for calm work.
- `--mottle`: uneven ink density. Use it only as support, at 10–35, together with chips or edge chips. Alone or above about 40, it looks like a soft digital gradient.
- `--displacement`: gentle warping of the outline. Up to about 50 is safe. Above about 70, strokes bend.

A light ragged outline fades in over the first 10 points of the strongest knob, so worn edges never look like vector shapes. With every knob at 0, the artwork is unchanged.

## Presets

Start from the preset for the use case. Then change one knob at a time. For calm work, set unhelpful knobs to 0.

| Preset | Use | Chips | Edge | Spray | Mottle | Displacement | Mask |
|---|---|---|---|---|---|---|---|
| `professional` | Brand, podcast, conference | 0 | 35 | 0 | 10 | 0 | Night Dust |
| `family-dinner` | Invitation, menu, holiday card | 10 | 45 | 0 | 20 | 15 | Dry Ink |
| `shred` | Trip video, sticker, crew shirt | 25 | 25 | 65 | 25 | 35 | Breaking Foam |
| `heavy-metal` | Gig flyer, merch | 40 | 80 | 45 | 35 | 50 | Deep Field |
| `wtf` | Zine, joke poster | 70 | 70 | 100 | 60 | 90 | Breaking Foam |

`--mask` takes a bundled mask name or a grayscale mask path. White marks apply the effect.

- [Breaking Foam](assets/01-breaking-foam.png) has ragged clusters and spray.
- [Night Dust](assets/02-night-dust.png) has fine, rounded specks and quiet gaps.
- [Deep Field](assets/03-deep-field.png) mixes dust with larger irregular marks.
- [Dry Ink](assets/04-dry-ink.png) has short chips and finer flecks.

## Review

- Look at the result at full size and at delivery size. For a thumbnail, check it at 320 px wide.
- The words must come first, and the texture second. If the eye finds a pattern first, lower the strongest knob.
- Keep some clean areas. Wear spread evenly everywhere looks like an overlay.
- To compare settings, change one knob and keep the seed. For a different pattern, change the seed.

The pixel sizes are tuned at 1280 × 720 and scale with the canvas, so 1080p and 4K match. A 4K render takes about 30 seconds and uses about 2 GB of memory.
