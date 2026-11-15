interface Env {
  ASSETS: Fetcher;
  VERSION?: { id: string; tag?: string };
}

const EVENTS = new Set(["page_view", "render_settled", "preset", "download", "copy", "upload", "webmcp_tool"]);
const MAX_BODY = 2048;

function log(level: "info" | "warn", fields: Record<string, unknown>) {
  const message = fields.event === "asset_request" ? `asset ${fields.path} ${fields.status}` : `event ${fields.event}`;
  console.log(JSON.stringify({ message, level, service: "grunge", ...fields }));
}

function context(request: Request, env: Env) {
  const cf = (request as Request & { cf?: { country?: string; colo?: string } }).cf;
  return {
    ray: request.headers.get("cf-ray"),
    country: cf?.country,
    colo: cf?.colo,
    release: env.VERSION?.id,
  };
}

function clean(value: unknown): string | number | boolean | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, 64);
  return undefined;
}

async function event(request: Request, env: Env): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_BODY) return new Response(null, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const name = String(body.event ?? "");
  if (!EVENTS.has(name)) return new Response(null, { status: 400 });
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key !== "event" && /^[a-z_]{1,32}$/.test(key)) properties[key] = clean(value);
  }
  log("info", { event: name, ...properties, ...context(request, env) });
  return new Response(null, { status: 204 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/event" && request.method === "POST") return event(request, env);
    if (url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    const response = await env.ASSETS.fetch(request);
    log("info", { event: "asset_request", path: url.pathname, status: response.status, agent: /bot|curl|python|node|deno|agent/i.test(request.headers.get("user-agent") ?? ""), ...context(request, env) });
    return response;
  },
} satisfies ExportedHandler<Env>;
