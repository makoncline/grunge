import "@fontsource/anton";
import "@fontsource/archivo-black";
import "@fontsource/alfa-slab-one";
import "@fontsource/bebas-neue";
import "@fontsource/dm-serif-display";
import "@fontsource/oswald/700.css";
import "./style.css";
import { KNOBS, MASKS, PRESETS, type Knob, type Knobs, type MaskName } from "./engine";
import type { RenderRequest, RenderResponse } from "./render-worker";
import { track } from "./telemetry";
import { installWebMCP } from "./webmcp";
import { FONTS, SIZES, type Settings } from "./options";

const LABELS: Record<Knob, string> = { chips: "Chips", edge: "Edge chips", spray: "Spray", mottle: "Mottle", displacement: "Displacement" };
const SITE = location.origin;
const REPOSITORY = "https://github.com/makoncline/grunge";

const defaults: Settings = {
  ...pickKnobs(PRESETS["heavy-metal"]), mask: PRESETS["heavy-metal"].mask,
  text: "FIELD\nNOTES", font: "Anton", ink: "#1d1b18", paper: "#e9e1cf", size: "1280x720", seed: 1402, source: "text",
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let settings: Settings = loadSettings();
let upload: ImageData | null = null;
let layer: ImageData | null = null;

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem("grunge-settings") ?? "null");
    if (saved && typeof saved === "object") return { ...defaults, ...saved, source: "text" };
  } catch {}
  return { ...defaults };
}

function saveSettings() {
  try { localStorage.setItem("grunge-settings", JSON.stringify(settings)); } catch {}
}

function dimensions(): [number, number] {
  if (settings.source === "upload" && upload) return [upload.width, upload.height];
  const [w, h] = settings.size.split("x").map(Number);
  return [w, h];
}

let artworkKey = "";
let artwork: ImageData | null = null;

function textArtwork(): ImageData {
  const [width, height] = dimensions();
  const key = JSON.stringify([settings.text, settings.font, settings.ink, width, height]);
  if (key === artworkKey && artwork) return artwork;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const { family, weight } = FONTS[settings.font] ?? FONTS.Anton;
  const lines = settings.text.split("\n").filter((line) => line.trim()) || [" "];
  const measure = (size: number) => {
    context.font = `${weight} ${size}px "${family}"`;
    const metrics = lines.map((line) => context.measureText(line));
    const heights = metrics.map((m) => m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
    const gap = size * 0.08;
    return { metrics, heights, gap, blockH: heights.reduce((a, b) => a + b, 0) + gap * (lines.length - 1), blockW: Math.max(...metrics.map((m) => m.actualBoundingBoxLeft + m.actualBoundingBoxRight)) };
  };
  let low = 4, high = height;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    const { blockH, blockW } = measure(mid);
    if (blockH <= height * 0.56 && blockW <= width * 0.62) low = mid; else high = mid;
  }
  const { metrics, heights, gap, blockH } = measure(low);
  context.fillStyle = settings.ink;
  let y = (height - blockH) / 2;
  metrics.forEach((m, i) => {
    const lineW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    context.fillText(lines[i], (width - lineW) / 2 + m.actualBoundingBoxLeft, y + m.actualBoundingBoxAscent);
    y += heights[i] + gap;
  });
  artworkKey = key;
  artwork = context.getImageData(0, 0, width, height);
  return artwork;
}

const worker = new Worker(new URL("./render-worker.ts", import.meta.url), { type: "module" });
let requestId = 0;
let inFlight = false;
let pending = false;
const waiters: Array<(ok: boolean) => void> = [];

function render(): Promise<boolean> {
  syncControls();
  saveSettings();
  scheduleSettledEvent();
  const done = new Promise<boolean>((resolve) => waiters.push(resolve));
  if (inFlight) { pending = true; return done; }
  inFlight = true;
  pending = false;
  setStatus("Rendering…", true);
  const source = settings.source === "upload" && upload ? upload : textArtwork();
  const copy = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  const request: RenderRequest = { id: ++requestId, artwork: copy, mask: settings.mask, seed: settings.seed, knobs: pickKnobs(settings) };
  worker.postMessage(request, [copy.data.buffer]);
  return done;
}

worker.onmessage = (event: MessageEvent<RenderResponse>) => {
  const response = event.data;
  inFlight = false;
  if (response.ok) {
    layer = response.layer;
    lastRenderMs = response.ms;
    drawPreview();
    setStatus(`Rendered ${layer.width} × ${layer.height} in ${response.ms} ms on this device`);
  } else {
    setStatus(`Render failed: ${response.error}`);
  }
  if (pending) { render(); return; }
  for (const resolve of waiters.splice(0)) resolve(response.ok);
};

function pickKnobs(source: Partial<Knobs>): Knobs {
  return Object.fromEntries(KNOBS.map((k) => [k, Number(source[k] ?? 0)])) as Knobs;
}

function composite(flatten: boolean): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = layer!.width;
  canvas.height = layer!.height;
  const context = canvas.getContext("2d")!;
  if (flatten && settings.paper !== "transparent") {
    context.fillStyle = settings.paper;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const scratch = document.createElement("canvas");
  scratch.width = canvas.width;
  scratch.height = canvas.height;
  scratch.getContext("2d")!.putImageData(layer!, 0, 0);
  context.drawImage(scratch, 0, 0);
  return canvas;
}

function drawPreview() {
  if (!layer) return;
  const preview = $<HTMLCanvasElement>("preview");
  preview.width = layer.width;
  preview.height = layer.height;
  preview.classList.toggle("checker", settings.paper === "transparent");
  preview.getContext("2d")!.drawImage(composite(true), 0, 0);
}

function setStatus(text: string, busy = false) {
  const status = $("status");
  status.textContent = text;
  status.classList.toggle("busy", busy);
}

function syncControls() {
  for (const k of KNOBS) {
    $<HTMLInputElement>(k).value = String(settings[k]);
    $<HTMLOutputElement>(`${k}-out`).value = String(Math.round(settings[k]));
  }
  $<HTMLSelectElement>("mask").value = settings.mask;
  $<HTMLInputElement>("seed").value = String(settings.seed);
  $<HTMLTextAreaElement>("text").value = settings.text;
  $<HTMLSelectElement>("font").value = settings.font;
  $<HTMLInputElement>("ink").value = settings.ink;
  $<HTMLInputElement>("paper").value = settings.paper === "transparent" ? "#e9e1cf" : settings.paper;
  $<HTMLInputElement>("transparent").checked = settings.paper === "transparent";
  $<HTMLSelectElement>("size").value = settings.size;
  $<HTMLElement>("text-controls").hidden = settings.source === "upload";
  $<HTMLElement>("upload-controls").hidden = settings.source !== "upload";
  $("code").textContent = code().javascript;
}

let lastRenderMs = 0;
let settledTimer = 0;
function scheduleSettledEvent() {
  clearTimeout(settledTimer);
  settledTimer = window.setTimeout(() => track("render_settled", {
    ...pickKnobs(settings), mask: settings.mask, size: dimensions().join("x"), source: settings.source, ms: lastRenderMs,
  }), 2500);
}

export function code() {
  const knobs = pickKnobs(settings);
  const options = { ...knobs, seed: settings.seed };
  const javascript = `import { wear } from "${SITE}/engine.js";

// artwork: { data: Uint8ClampedArray (RGBA), width, height } with a transparent area.
// mask: { data: Float32Array (0–1 gray), width, height } from ${SITE}/masks/${settings.mask}.png
const layer = wear(artwork, mask, ${JSON.stringify(options)});`;
  const python = `curl -O ${SITE}/grunge.py -O ${SITE}/masks/${settings.mask}.png
python grunge.py artwork.png renders --mask ${settings.mask}.png ${KNOBS.map((k) => `--${k} ${knobs[k]}`).join(" ")} --seed ${settings.seed}`;
  return {
    recipe: { ...options, mask: settings.mask },
    javascript,
    python,
    notes: "The JavaScript engine is the same code this site runs, so it reproduces this render exactly. The Python script has the same knobs and look, but a different random generator, so marks land in different places.",
    links: { engine: `${SITE}/engine.js`, source: `${SITE}/engine.ts`, python: `${SITE}/grunge.py`, masks: Object.keys(MASKS).map((m) => `${SITE}/masks/${m}.png`), agents: `${SITE}/llms.txt`, repository: REPOSITORY },
  };
}

export async function pngBase64(kind: "flattened" | "layer"): Promise<string> {
  const blob = await new Promise<Blob>((resolve) => composite(kind === "flattened").toBlob((b) => resolve(b!), "image/png"));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function download(kind: "flattened" | "layer") {
  if (!layer) return;
  composite(kind === "flattened").toBlob((blob) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob!);
    link.download = `grunge-${KNOBS.map((k) => `${k}${Math.round(settings[k])}`).join("-")}-seed${settings.seed}${kind === "layer" ? "-layer" : ""}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, "image/png");
  track("download", { kind, size: dimensions().join("x") });
}

export function getSettings(): Settings {
  return { ...settings };
}

export async function updateSettings(changes: Partial<Settings>): Promise<{ ok: boolean; settings: Settings }> {
  const next = { ...settings, ...changes };
  for (const k of KNOBS) next[k] = Math.min(100, Math.max(0, Number(next[k]) || 0));
  if (!(next.mask in MASKS)) throw new Error(`Unknown mask: ${next.mask}`);
  if (!(next.font in FONTS)) throw new Error(`Unknown font: ${next.font}`);
  if (!SIZES.includes(next.size)) throw new Error(`Unknown size: ${next.size}`);
  if (changes.text !== undefined) next.source = "text";
  next.seed = Math.max(0, Math.floor(Number(next.seed) || 0));
  settings = next;
  const ok = await render();
  return { ok, settings: getSettings() };
}

export function applyPreset(name: string) {
  const preset = PRESETS[name];
  if (!preset) throw new Error(`Unknown preset: ${name}`);
  track("preset", { name });
  return updateSettings({ ...pickKnobs(preset), mask: preset.mask });
}

function buildControls() {
  const knobs = $("knobs");
  for (const k of KNOBS) {
    knobs.insertAdjacentHTML("beforeend", `<label class="knob"><span>${LABELS[k]}</span><input type="range" id="${k}" min="0" max="100" step="1"><output id="${k}-out"></output></label>`);
    $<HTMLInputElement>(k).addEventListener("input", (e) => updateSettings({ [k]: Number((e.target as HTMLInputElement).value) }));
  }
  for (const [name, preset] of Object.entries(PRESETS)) {
    const button = document.createElement("button");
    button.textContent = name;
    button.title = preset.use;
    button.onclick = () => applyPreset(name);
    $("presets").appendChild(button);
  }
  for (const [name, description] of Object.entries(MASKS)) $("mask").insertAdjacentHTML("beforeend", `<option value="${name}">${description.split(":")[0]}</option>`);
  for (const name of Object.keys(FONTS)) $("font").insertAdjacentHTML("beforeend", `<option>${name}</option>`);
  for (const size of SIZES) $("size").insertAdjacentHTML("beforeend", `<option>${size}</option>`);
  $<HTMLSelectElement>("mask").onchange = (e) => updateSettings({ mask: (e.target as HTMLSelectElement).value as MaskName });
  $<HTMLInputElement>("seed").oninput = (e) => updateSettings({ seed: Number((e.target as HTMLInputElement).value) });
  $("dice").onclick = () => updateSettings({ seed: Math.floor(Math.random() * 100000) });
  $<HTMLTextAreaElement>("text").oninput = (e) => updateSettings({ text: (e.target as HTMLTextAreaElement).value });
  $<HTMLSelectElement>("font").onchange = (e) => updateSettings({ font: (e.target as HTMLSelectElement).value });
  $<HTMLInputElement>("ink").oninput = (e) => updateSettings({ ink: (e.target as HTMLInputElement).value });
  $<HTMLInputElement>("paper").oninput = (e) => updateSettings({ paper: (e.target as HTMLInputElement).value });
  $<HTMLInputElement>("transparent").onchange = (e) => updateSettings({ paper: (e.target as HTMLInputElement).checked ? "transparent" : $<HTMLInputElement>("paper").value });
  $<HTMLSelectElement>("size").onchange = (e) => updateSettings({ size: (e.target as HTMLSelectElement).value as Settings["size"] });
  $<HTMLInputElement>("file").onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const bitmap = await createImageBitmap(file);
    const limit = 3840 / Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, limit);
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    upload = context.getImageData(0, 0, canvas.width, canvas.height);
    track("upload", { size: `${canvas.width}x${canvas.height}` });
    updateSettings({ source: "upload" });
  };
  $("use-text").onclick = () => updateSettings({ source: "text" });
  $("download-flat").onclick = () => download("flattened");
  $("download-layer").onclick = () => download("layer");
  for (const kind of ["recipe", "javascript", "python"] as const) {
    $(`copy-${kind}`).onclick = async () => {
      const value = code()[kind];
      const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
      try { await navigator.clipboard.writeText(text); } catch { prompt("Copy", text); }
      track("copy", { kind });
    };
  }
}

async function start() {
  buildControls();
  await document.fonts.load(`400 64px "Anton"`);
  await Promise.all(Object.values(FONTS).map(({ family, weight }) => document.fonts.load(`${weight} 64px "${family}"`)));
  const webmcp = await installWebMCP();
  track("page_view", { webmcp, width: innerWidth });
  render();
}

start();
