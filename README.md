# Grunge

Seeded print wear for lettering and artwork: chips, edge chips, spray, ink mottle and displacement. Each knob runs from 0 (off) to 100 (far too much).

Live at https://grunge.makon.dev. It is a static site. Rendering happens on the user's device in a Web Worker.

- `src/engine.ts` — the engine. Pure TypeScript with no DOM or Node APIs. Published as `/engine.js` and `/engine.ts`.
- `src/main.ts` — the page. `src/webmcp.ts` registers native WebMCP tools.
- `python/grunge.py` — the Python CLI, also published as `/grunge.py`.
- `public/masks/` — the four grayscale masks.
- `public/llms.txt` — instructions for agents.
- `worker/index.ts` — the Cloudflare Worker. It serves the static assets and writes structured usage logs (`/api/event`) to Workers Observability. Logs contain no text or images.

## Develop

```sh
pnpm install
pnpm dev        # page at http://localhost:5173
pnpm check      # typecheck, engine tests, build
pnpm preview    # built site with the Worker
```

## Python CLI

`python/grunge.py` is the canonical CLI. The skill script at `.agents/skills/grunge-text/scripts/grunge.py` links to it. Its `assets` link points to `public/masks`. Keep the links inside the repository.

Use an isolated environment for Pillow, NumPy, and SciPy:

```sh
uv venv .venv
uv pip install --python .venv/bin/python -r python/requirements.txt
.venv/bin/python python/grunge.py title.png renders --preset heavy-metal --seed 1402 --variants 2
```

The artwork must have visible pixels and a transparent area. Use a new or empty output directory. Bundled mask names resolve from the script location, not the working directory. From another directory, use absolute paths to the interpreter, script, and inputs.

Each variant exports a transparent `-layer.png`. Use `--background frame.png` or `--paper '#e9e1cf'` for an RGB preview. Previews and contact sheets use an opaque `#161616` matte behind any remaining alpha. This includes semi-transparent backgrounds. Layer exports keep their transparency. `settings.json` records the settings, seeds, and input hashes.

The build publishes `dist/grunge.py`. A downloaded script needs a downloaded mask and an explicit `--mask /path/to/mask.png`. It does not search for masks in other locations.

## Tests

```sh
pnpm check
.venv/bin/python -I -m unittest discover -s python -p 'test_*.py' -v
```

Build first with `pnpm check`. The Python suite runs the real CLI through the repository, skill, and built download entry points. It checks repeatable renders, masks, settings, layer exports, and alpha compositing. It uses temporary files and no mocks.

## Deploy

Pull requests run `pnpm check`. Merges to `main` run `pnpm check` and then `wrangler deploy` in GitHub Actions (`.github/workflows/deploy.yml`). The `CLOUDFLARE_API_TOKEN` secret is scoped to Workers in this account and the makon.dev zone.

## License

MIT
