import { grayFromRgba, prepareMask, wear, type Cache, type Knobs, type MaskName, type PreparedMask } from "./engine";

export interface RenderRequest {
  id: number;
  artwork: ImageData;
  mask: MaskName;
  seed: number;
  knobs: Knobs;
}

export type RenderResponse =
  | { id: number; ok: true; layer: ImageData; ms: number }
  | { id: number; ok: false; error: string };

const masks = new Map<MaskName, PreparedMask>();
const caches = new Map<MaskName, Cache>();

async function loadMask(name: MaskName): Promise<PreparedMask> {
  const existing = masks.get(name);
  if (existing) return existing;
  const response = await fetch(`/masks/${name}.png`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
  const prepared = prepareMask(grayFromRgba(image));
  masks.set(name, prepared);
  return prepared;
}

self.onmessage = async (event: MessageEvent<RenderRequest>) => {
  const { id, artwork, mask, seed, knobs } = event.data;
  try {
    const started = performance.now();
    const prepared = await loadMask(mask);
    if (!caches.has(mask)) caches.set(mask, new Map());
    const cache = caches.get(mask)!;
    if (cache.size > 400) cache.clear();
    const layer = wear(artwork, prepared, { ...knobs, seed, cache, maskKey: mask });
    const image = new ImageData(layer.data as Uint8ClampedArray<ArrayBuffer>, layer.width, layer.height);
    const response: RenderResponse = { id, ok: true, layer: image, ms: Math.round(performance.now() - started) };
    (self as unknown as Worker).postMessage(response, [image.data.buffer]);
  } catch (error) {
    const response: RenderResponse = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
    (self as unknown as Worker).postMessage(response);
  }
};
