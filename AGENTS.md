# Agent instructions

Write short, clear sentences in ASD-STE100 style.

- The engine in `src/engine.ts` is the source of truth for the look. Keep it free of DOM and Node APIs, so `/engine.js` works everywhere.
- `python/grunge.py` mirrors the knobs and presets. Change both together. The Python copy also lives in the `grunge-text` skill in `makoncline/home`.
- Rendering stays on the user's device. Do not send text or images to the Worker. Usage events carry only settings, sizes and timings.
- Verify with `pnpm check`. For visual changes, render and look at the result at full size and at delivery size.
- Merges to `main` deploy to production.
