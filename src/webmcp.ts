import { KNOBS, MASKS, PRESETS } from "./engine";
import { applyPreset, code, getSettings, pngBase64, updateSettings } from "./main";
import { FONTS, SIZES, type Settings } from "./options";
import { track } from "./telemetry";

interface ModelContext {
  registerTool(tool: {
    name: string;
    description: string;
    inputSchema: object;
    annotations?: { readOnlyHint?: boolean };
    execute(input: Record<string, unknown>): Promise<unknown>;
  }, options?: { signal?: AbortSignal }): Promise<void> | void;
}

const knobProperties = Object.fromEntries(KNOBS.map((k) => [k, { type: "number", minimum: 0, maximum: 100, description: `${k}: 0 is off, 100 is far too much.` }]));

const tools = [
  {
    name: "get_settings",
    description: "Read the current grunge settings: five knobs (0–100), mask, seed, text, font, ink, paper and canvas size.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    execute: async () => getSettings(),
  },
  {
    name: "update_settings",
    description: "Change any settings and re-render on the user's device. Knobs: chips (ink missing inside), edge (chips that break the outline), spray (flecks outside), mottle (uneven ink, keep 10–35), displacement (outline warp, keep under 50). Returns the settings after the render.",
    inputSchema: {
      type: "object",
      properties: {
        ...knobProperties,
        seed: { type: "integer", minimum: 0 },
        mask: { type: "string", enum: Object.keys(MASKS) },
        text: { type: "string", description: "Lettering. Use \\n for line breaks." },
        font: { type: "string", enum: Object.keys(FONTS) },
        ink: { type: "string", description: "Hex colour, such as #1d1b18." },
        paper: { type: "string", description: "Hex colour, or 'transparent'." },
        size: { type: "string", enum: [...SIZES] },
      },
    },
    readOnly: false,
    execute: async (input: Record<string, unknown>) => updateSettings(input as Partial<Settings>),
  },
  {
    name: "apply_preset",
    description: `Apply a use-case preset: ${Object.entries(PRESETS).map(([name, p]) => `${name} (${p.use})`).join(", ")}.`,
    inputSchema: { type: "object", properties: { name: { type: "string", enum: Object.keys(PRESETS) } }, required: ["name"] },
    readOnly: false,
    execute: async (input: Record<string, unknown>) => applyPreset(String(input.name)),
  },
  {
    name: "get_image",
    description: "Return the current render as a base64 PNG. 'flattened' includes the paper colour. 'layer' is the transparent worn artwork.",
    inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["flattened", "layer"] } } },
    readOnly: true,
    execute: async (input: Record<string, unknown>) => ({ mimeType: "image/png", base64: await pngBase64(input.kind === "layer" ? "layer" : "flattened") }),
  },
  {
    name: "get_code",
    description: "Return code that reproduces the current render without this page: a JavaScript snippet using the same engine, a Python command, the recipe and download links.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    execute: async () => code(),
  },
];

/** Register native WebMCP tools. There is no polyfill; unsupported browsers keep the normal UI. */
export async function installWebMCP(): Promise<string> {
  const context = (document as unknown as { modelContext?: ModelContext }).modelContext;
  if (!context) {
    document.documentElement.dataset.webmcp = "unavailable";
    return "unavailable";
  }
  let registration: AbortController | undefined;
  const register = async () => {
    registration?.abort();
    registration = new AbortController();
    try {
      for (const tool of tools) {
        await context.registerTool({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: { readOnlyHint: tool.readOnly },
          async execute(input) {
            track("webmcp_tool", { name: tool.name });
            try {
              return await tool.execute(input ?? {});
            } catch (error) {
              return { isError: true, error: error instanceof Error ? error.message : String(error) };
            }
          },
        }, { signal: registration.signal });
      }
      document.documentElement.dataset.webmcp = "ready";
    } catch (error) {
      registration.abort();
      document.documentElement.dataset.webmcp = "error";
      console.error("WebMCP registration failed:", error);
    }
  };
  window.addEventListener("pagehide", () => registration?.abort());
  window.addEventListener("pageshow", (event) => { if (event.persisted) register(); });
  await register();
  return document.documentElement.dataset.webmcp ?? "error";
}
