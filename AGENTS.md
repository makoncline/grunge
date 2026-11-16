# Agent instructions

Write short, clear sentences in ASD-STE100 style.

- The engine in `src/engine.ts` is the source of truth for the look. Keep it free of DOM and Node APIs, so `/engine.js` works everywhere.
- `python/grunge.py` is the canonical Python CLI. It mirrors the engine knobs and presets. Change both together. The script at `.agents/skills/grunge-text/scripts/grunge.py` links to it. The skill's `assets` link points to the canonical masks in `public/masks`. Do not add copies or path-search fallbacks.
- Repository and skill entry points use bundled masks. The downloaded `/grunge.py` uses an explicit `--mask` path. Keep that contract.
- Contact sheets and flattened previews use an opaque `#161616` matte behind any remaining alpha. Keep `-layer.png` exports transparent.
- Rendering stays on the user's device. Do not send text or images to the Worker. Usage events carry only settings, sizes and timings.
- Verify with `pnpm check`, then `.venv/bin/python -I -m unittest discover -s python -p 'test_*.py' -v`. Use `python/requirements.txt` in an isolated uv environment. For visual changes, render and look at the result at full size and at delivery size.
- Merges to `main` deploy to production.
