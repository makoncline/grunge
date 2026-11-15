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

## Deploy

Merges to `main` deploy to production through Cloudflare Workers Builds (`pnpm run build` then `npx wrangler deploy`). `pnpm deploy` deploys from a local checkout.

## License

MIT
