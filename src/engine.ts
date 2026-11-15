/**
 * Grunge print-wear engine. Pure TypeScript with no DOM or Node APIs.
 *
 * Knobs run from 0 (off) to 100 (far too much). Pixel sizes are tuned at 1280 x 720 and scale with the canvas.
 * Use `wear(artwork, mask, settings)` with RGBA artwork that has a transparent area and a grayscale mask.
 */

export const KNOBS = ["chips", "edge", "spray", "mottle", "displacement"] as const;
export type Knob = (typeof KNOBS)[number];
export type Knobs = Record<Knob, number>;
export type MaskName = "01-breaking-foam" | "02-night-dust" | "03-deep-field" | "04-dry-ink";

export interface Rgba {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Gray {
  data: Float32Array;
  width: number;
  height: number;
}

export const MAXIMUM: Knobs = { chips: 20, edge: 40, spray: 16, mottle: 14, displacement: 12 };

export const MASKS: Record<MaskName, string> = {
  "01-breaking-foam": "Breaking Foam: ragged clusters and spray",
  "02-night-dust": "Night Dust: fine, rounded specks and quiet gaps",
  "03-deep-field": "Deep Field: dust with larger irregular marks",
  "04-dry-ink": "Dry Ink: short chips and finer flecks",
};

export const PRESETS: Record<string, Knobs & { mask: MaskName; use: string }> = {
  off: { chips: 0, edge: 0, spray: 0, mottle: 0, displacement: 0, mask: "03-deep-field", use: "No wear" },
  professional: { chips: 0, edge: 35, spray: 0, mottle: 10, displacement: 0, mask: "02-night-dust", use: "Brand, podcast, conference" },
  "family-dinner": { chips: 10, edge: 45, spray: 0, mottle: 20, displacement: 15, mask: "04-dry-ink", use: "Invitation, menu, holiday card" },
  shred: { chips: 25, edge: 25, spray: 65, mottle: 25, displacement: 35, mask: "01-breaking-foam", use: "Trip video, sticker, crew shirt" },
  "heavy-metal": { chips: 40, edge: 80, spray: 45, mottle: 35, displacement: 50, mask: "03-deep-field", use: "Gig flyer, merch" },
  wtf: { chips: 70, edge: 70, spray: 100, mottle: 60, displacement: 90, mask: "01-breaking-foam", use: "Zine, joke poster" },
};

const REFERENCE_PIXELS = 1280 * 720;

export function multiplier(knob: Knob, percent: number): number {
  const level = Math.min(100, Math.max(0, percent)) / 100;
  return (MAXIMUM[knob] + 1) ** level - 1;
}

/** Seeded generator. The same keys always give the same sequence. */
export function random(...keys: number[]): () => number {
  let h = 1779033703 ^ keys.length;
  for (const key of keys) {
    h = Math.imul(h ^ (key >>> 0), 3432918353);
    h = (h << 13) | (h >>> 19);
    h = Math.imul(h ^ Math.floor(key / 4294967296), 461845907);
  }
  const next = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
  let a = next(), b = next(), c = next(), d = next();
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function noise(width: number, height: number, rng: () => number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = rng();
  return out;
}

function normalize(values: Float32Array): Float32Array {
  let sum = 0, squares = 0;
  for (const v of values) { sum += v; squares += v * v; }
  const mean = sum / values.length;
  const std = Math.sqrt(Math.max(squares / values.length - mean * mean, 0)) + 1e-9;
  for (let i = 0; i < values.length; i++) values[i] = (values[i] - mean) / std;
  return values;
}

function boxPass(src: Float32Array, dst: Float32Array, width: number, height: number, radius: number, horizontal: boolean) {
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  const step = horizontal ? 1 : width;
  const scale = 1 / (2 * radius + 1);
  for (let line = 0; line < lines; line++) {
    const start = horizontal ? line * width : line;
    const at = (i: number) => src[start + Math.min(length - 1, Math.max(0, i)) * step];
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += at(i);
    for (let i = 0; i < length; i++) {
      dst[start + i * step] = sum * scale;
      sum += at(i + radius + 1) - at(i - radius);
    }
  }
}

function kernelPass(src: Float32Array, dst: Float32Array, width: number, height: number, kernel: Float32Array, horizontal: boolean) {
  const radius = (kernel.length - 1) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = horizontal ? Math.min(width - 1, Math.max(0, x + k)) : x;
        const sy = horizontal ? y : Math.min(height - 1, Math.max(0, y + k));
        sum += src[sy * width + sx] * kernel[k + radius];
      }
      dst[y * width + x] = sum;
    }
  }
}

/** Gaussian blur. Large radii use three box passes, which is close to Gaussian and linear in time. */
export function blur(values: Float32Array, width: number, height: number, sigma: number): Float32Array {
  const out = Float32Array.from(values);
  if (sigma <= 0) return out;
  const temp = new Float32Array(values.length);
  if (sigma < 2.5) {
    const radius = Math.ceil(sigma * 3);
    const kernel = new Float32Array(2 * radius + 1);
    let total = 0;
    for (let i = -radius; i <= radius; i++) total += kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
    for (let i = 0; i < kernel.length; i++) kernel[i] /= total;
    kernelPass(out, temp, width, height, kernel, true);
    kernelPass(temp, out, width, height, kernel, false);
    return out;
  }
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  const upper = lower + 2;
  const lowerCount = Math.round((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
  for (let pass = 0; pass < 3; pass++) {
    const radius = ((pass < lowerCount ? lower : upper) - 1) / 2;
    boxPass(out, temp, width, height, radius, true);
    boxPass(temp, out, width, height, radius, false);
  }
  return out;
}

/** Summed-area table, for exact area-averaged crops of a mask at any scale. */
export interface PreparedMask extends Gray {
  table: Float64Array;
}

export function prepareMask(mask: Gray): PreparedMask {
  const { width, height, data } = mask;
  let min = Infinity, max = -Infinity;
  for (const v of data) { min = Math.min(min, v); max = Math.max(max, v); }
  if (min === max) throw new Error("Choose a mask with both light and dark pixels.");
  const table = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += data[y * width + x];
      table[(y + 1) * (width + 1) + x + 1] = table[y * (width + 1) + x + 1] + row;
    }
  }
  return { ...mask, table };
}

function areaSum(mask: PreparedMask, x: number, y: number): number {
  const w = mask.width + 1;
  x = Math.min(mask.width, Math.max(0, x));
  y = Math.min(mask.height, Math.max(0, y));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(mask.width, x0 + 1), y1 = Math.min(mask.height, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const t = mask.table;
  const top = t[y0 * w + x0] * (1 - fx) + t[y0 * w + x1] * fx;
  const bottom = t[y1 * w + x0] * (1 - fx) + t[y1 * w + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** A crop of the mask that shows `coverage` of it across the canvas, at a seeded position. */
export function crop(mask: PreparedMask, rng: () => number, coverage: number, width: number, height: number): Float32Array {
  const fit = Math.min(mask.width / width, mask.height / height) * coverage;
  const halfW = (width * fit) / 2, halfH = (height * fit) / 2;
  const cx = halfW + rng() * (mask.width - 2 * halfW);
  const cy = halfH + rng() * (mask.height - 2 * halfH);
  const left = cx - halfW, top = cy - halfH;
  const out = new Float32Array(width * height);
  if (fit >= 1) {
    const area = fit * fit;
    for (let y = 0; y < height; y++) {
      const sy0 = top + y * fit, sy1 = sy0 + fit;
      for (let x = 0; x < width; x++) {
        const sx0 = left + x * fit, sx1 = sx0 + fit;
        const sum = areaSum(mask, sx1, sy1) - areaSum(mask, sx0, sy1) - areaSum(mask, sx1, sy0) + areaSum(mask, sx0, sy0);
        out[y * width + x] = Math.min(1, Math.max(0, sum / area));
      }
    }
    return out;
  }
  for (let y = 0; y < height; y++) {
    const sy = Math.min(mask.height - 1, Math.max(0, top + (y + 0.5) * fit - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(mask.height - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(mask.width - 1, Math.max(0, left + (x + 0.5) * fit - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(mask.width - 1, x0 + 1), fx = sx - x0;
      const d = mask.data;
      const v = (d[y0 * mask.width + x0] * (1 - fx) + d[y0 * mask.width + x1] * fx) * (1 - fy)
        + (d[y1 * mask.width + x0] * (1 - fx) + d[y1 * mask.width + x1] * fx) * fy;
      out[y * width + x] = v;
    }
  }
  return out;
}

/** Four-connected components of values above the threshold. Label 0 is background. */
export function components(values: Float32Array, width: number, height: number, threshold: number): { labels: Int32Array; count: number } {
  const labels = new Int32Array(values.length);
  const stack = new Int32Array(values.length);
  let count = 0;
  for (let start = 0; start < values.length; start++) {
    if (labels[start] || values[start] <= threshold) continue;
    count++;
    let top = 0;
    stack[top++] = start;
    labels[start] = count;
    while (top) {
      const i = stack[--top];
      const x = i % width;
      const neighbours = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width];
      for (const n of neighbours) {
        if (n >= 0 && n < values.length && !labels[n] && values[n] > threshold) {
          labels[n] = count;
          stack[top++] = n;
        }
      }
    }
  }
  return { labels, count };
}

function maximumFilter(values: Float32Array, width: number, height: number, size: number): Float32Array {
  const radius = (size - 1) >> 1;
  const temp = new Float32Array(values.length);
  const out = new Float32Array(values.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let m = -Infinity;
      for (let k = Math.max(0, x - radius); k <= Math.min(width - 1, x + radius); k++) m = Math.max(m, values[y * width + k]);
      temp[y * width + x] = m;
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let m = -Infinity;
      for (let k = Math.max(0, y - radius); k <= Math.min(height - 1, y + radius); k++) m = Math.max(m, temp[k * width + x]);
      out[y * width + x] = m;
    }
  return out;
}

/**
 * Euclidean distance from each pixel where `from` is 1 to the nearest pixel where it is 0, with that pixel's index.
 * Pixels where `from` is 0 get distance 0 and their own index.
 */
export function distance(from: Uint8Array, width: number, height: number): { distance: Float32Array; nearest: Int32Array } {
  const INF = 1e20;
  const columnDistance = new Float64Array(width * height);
  const columnSource = new Int32Array(width * height);
  const n = Math.max(width, height);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n), source = new Int32Array(n);
  const transform = (length: number) => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < length; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < length; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) ** 2 + f[v[k]];
      source[q] = v[k];
    }
  };
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = from[y * width + x] ? INF : 0;
    transform(height);
    for (let y = 0; y < height; y++) { columnDistance[y * width + x] = d[y]; columnSource[y * width + x] = source[y]; }
  }
  const out = new Float32Array(width * height);
  const nearest = new Int32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = columnDistance[y * width + x];
    transform(width);
    for (let x = 0; x < width; x++) {
      const sx = source[x];
      out[y * width + x] = Math.sqrt(d[x]);
      nearest[y * width + x] = columnSource[y * width + sx] * width + sx;
    }
  }
  return { distance: out, nearest };
}

/** Optional cache for mask crops, so repeated renders at the same size, mask, and seed are fast. */
export type Cache = Map<string, unknown>;

function cached<T>(cache: Cache | undefined, key: string, make: () => T): T {
  if (!cache) return make();
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
}

interface Marks { values: Float32Array; ranks: Float32Array }

function marks(mask: PreparedMask, seed: number, stream: number, index: number, width: number, height: number, cache?: Cache, maskKey = ""): Marks {
  return cached(cache, `marks:${maskKey}:${seed}:${stream}:${index}:${width}x${height}`, () => {
    const values = crop(mask, random(seed, stream, index), 0.75, width, height);
    const { labels, count } = components(values, width, height, 0.03);
    const rankRng = random(seed, stream, index, 9);
    const perLabel = new Float32Array(count + 1);
    perLabel[0] = 2;
    for (let i = 1; i <= count; i++) perLabel[i] = rankRng();
    const ranks = new Float32Array(values.length);
    for (let i = 0; i < values.length; i++) ranks[i] = perLabel[labels[i]];
    return { values, ranks };
  });
}

/** Amount 1 is one 75% crop of the mask. Higher amounts add crops. Lower amounts keep fewer whole marks. */
function layered(mask: PreparedMask, seed: number, stream: number, amount: number, width: number, height: number,
  shape: (values: Float32Array) => Float32Array, cache?: Cache, maskKey?: string): Float32Array {
  const total = new Float32Array(width * height);
  for (let index = 0; index < Math.ceil(amount); index++) {
    const { values, ranks } = marks(mask, seed, stream, index, width, height, cache, maskKey);
    const shaped = shape(values);
    const keep = Math.min(1, Math.max(0, amount - index));
    for (let i = 0; i < total.length; i++) if (ranks[i] < keep && shaped[i] > total[i]) total[i] = shaped[i];
  }
  return total;
}

export interface WearOptions extends Partial<Knobs> {
  seed?: number;
  /** Reuse between renders. Pass a new Map when the mask changes, or set `maskKey`. */
  cache?: Cache;
  maskKey?: string;
}

/** Return the worn artwork as RGBA at the artwork's size. Colours come from the artwork itself. */
export function wear(artwork: Rgba, mask: Gray | PreparedMask, options: WearOptions = {}): Rgba {
  const { width, height } = artwork;
  const pixels = width * height;
  const seed = options.seed ?? 1402;
  const cache = options.cache;
  const maskKey = options.maskKey ?? "";
  const prepared = "table" in mask ? mask : cached(cache, `mask:${maskKey}`, () => prepareMask(mask));
  const scale = Math.sqrt(pixels / REFERENCE_PIXELS);
  const c = multiplier("chips", options.chips ?? 0);
  const e = multiplier("edge", options.edge ?? 0);
  const s = multiplier("spray", options.spray ?? 0);
  const m = multiplier("mottle", options.mottle ?? 0);
  const d = multiplier("displacement", options.displacement ?? 0);

  const clean = new Float32Array(pixels);
  let visible = false, transparent = false;
  for (let i = 0; i < pixels; i++) {
    clean[i] = artwork.data[i * 4 + 3] / 255;
    if (clean[i] > 0) visible = true;
    if (clean[i] === 0) transparent = true;
  }
  if (!visible || !transparent) throw new Error("Use artwork with visible pixels and a transparent area.");

  const notSolid = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) notSolid[i] = clean[i] < 0.9 ? 1 : 0;
  const solidNearest = distance(notSolid, width, height).nearest;

  const size = `${width}x${height}`;
  const grain = cached(cache, `grain:${seed}:${size}`, () => normalize(blur(noise(width, height, random(seed, 0, 0)), width, height, 1.0 * scale)));
  const film = cached(cache, `film:${seed}:${size}`, () => {
    const values = normalize(blur(noise(width, height, random(seed, 0, 1)), width, height, 70 * scale));
    for (let i = 0; i < values.length; i++) values[i] = smoothstep(-1.5, 1.5, values[i]);
    return values;
  });
  const rough = cached(cache, `rough:${seed}:${size}`, () => {
    const values = normalize(blur(noise(width, height, random(seed, 0, 2)), width, height, 1.6 * scale));
    for (let i = 0; i < values.length; i++) values[i] = Math.min(2.5, Math.max(-2.5, values[i]));
    return values;
  });
  const density = cached(cache, `density:${maskKey}:${seed}:${size}`, () => {
    const values = blur(crop(prepared, random(seed, 4, 0), 1.0, width, height), width, height, 40 * scale);
    let min = Infinity, max = -Infinity;
    for (const v of values) { min = Math.min(min, v); max = Math.max(max, v); }
    for (let i = 0; i < values.length; i++) values[i] = (values[i] - min) / (max - min + 1e-9);
    return values;
  });
  const field = cached(cache, `field:${maskKey}:${seed}:${size}`, () =>
    blur(crop(prepared, random(seed, 4, 1), 1 / (1.18 * 3), width, height), width, height, 32 * scale));

  // Gentle broad displacement from the gradient of a smoothed mask crop.
  const gy = new Float32Array(pixels), gx = new Float32Array(pixels);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      gy[i] = y === 0 ? field[i + width] - field[i] : y === height - 1 ? field[i] - field[i - width] : (field[i + width] - field[i - width]) / 2;
      gx[i] = x === 0 ? field[i + 1] - field[i] : x === width - 1 ? field[i] - field[i - 1] : (field[i + 1] - field[i - 1]) / 2;
    }
  const sample: number[] = [];
  for (let i = 0; i < pixels; i++) if (clean[i] > 0) sample.push(Math.abs(gy[i]), Math.abs(gx[i]));
  sample.sort((a, b) => a - b);
  const reference = (sample[Math.floor(0.9 * (sample.length - 1))] ?? 0) + 1e-9;
  const amount = 0.4375 * d * scale;
  let alpha = new Float32Array(pixels);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const sy = y + Math.min(1, Math.max(-1, gy[i] / reference)) * amount;
      const sx = x + Math.min(1, Math.max(-1, gx[i] / reference)) * amount;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const at = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= width || yy >= height ? 0 : clean[yy * width + xx]);
      alpha[i] = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    }

  // Always-on printed outline: slight ink spread and a ragged edge.
  const spread = blur(alpha, width, height, 0.9 * scale);
  alpha = new Float32Array(pixels);
  for (let i = 0; i < pixels; i++) {
    const edgeZone = smoothstep(0, 0.2, spread[i]) * (1 - smoothstep(0.8, 1, spread[i]));
    alpha[i] = smoothstep(0.32, 0.68, spread[i] + 0.07 * rough[i] * edgeZone);
  }

  const outside = new Uint8Array(pixels), core = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) { outside[i] = alpha[i] > 0 ? 0 : 1; core[i] = alpha[i] > 0.5 ? 1 : 0; }
  const out = distance(outside, width, height);
  const distanceIn = distance(core, width, height).distance;

  const filterSize = Math.max(3, Math.round(3 * scale) | 1);
  const grainyGray = (values: Float32Array) => {
    const solid = maximumFilter(values, width, height, filterSize);
    const shaped = new Float32Array(pixels);
    for (let i = 0; i < pixels; i++) shaped[i] = solid[i] > 0.9 ? values[i] : Math.min(1, Math.max(0, values[i] * (1 + 0.6 * grain[i])));
    return shaped;
  };
  const cutouts = layered(prepared, seed, 1, c, width, height, grainyGray, cache, maskKey);
  const bites = layered(prepared, seed, 3, e, width, height, (values) => values.map((v) => smoothstep(0.3, 0.55, v)), cache, maskKey);
  const flecks = layered(prepared, seed, 2, s, width, height, grainyGray, cache, maskKey);
  const biteNear = (2 + 0.15 * Math.max(e - 1, 0)) * scale, biteFar = (5 + 0.25 * Math.max(e - 1, 0)) * scale;
  const reach = Math.sqrt(Math.max(s, 1e-6));

  const result = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    const di = distanceIn[i], dout = out.distance[i];
    const cut = cutouts[i] * (0.8 + 0.2 * Math.max(Math.exp(-di / (10 * scale)), density[i])) * 0.95;
    const bite = bites[i] * (1 - smoothstep(biteNear, biteFar, di));
    const fleck = outside[i] ? flecks[i] * Math.exp(-dout / (6 * reach * scale)) * (dout <= 26 * reach * scale ? 1 : 0) : 0;
    const ink = Math.min(1, Math.max(0, 1 - 0.06 * m * film[i]));
    const a = Math.min(1, Math.max(0, alpha[i] * (1 - cut) * (1 - bite) * ink + fleck));
    const colourIndex = solidNearest[out.nearest[i]];
    result[i * 4] = artwork.data[colourIndex * 4];
    result[i * 4 + 1] = artwork.data[colourIndex * 4 + 1];
    result[i * 4 + 2] = artwork.data[colourIndex * 4 + 2];
    result[i * 4 + 3] = Math.round(a * 255);
  }
  return { data: result, width, height };
}

/** Convert RGBA mask pixels (any channel layout with equal RGB) to a grayscale mask. */
export function grayFromRgba(image: Rgba): Gray {
  const data = new Float32Array(image.width * image.height);
  for (let i = 0; i < data.length; i++) data[i] = (image.data[i * 4] * 0.299 + image.data[i * 4 + 1] * 0.587 + image.data[i * 4 + 2] * 0.114) / 255;
  return { data, width: image.width, height: image.height };
}
