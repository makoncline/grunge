import assert from "node:assert/strict";
import { test } from "node:test";
import { random, wear, type Gray, type Rgba } from "../src/engine.ts";

const width = 320, height = 180;

function artwork(): Rgba {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 40; y < 140; y++)
    for (let x = 0; x < width; x++) {
      const inStroke = (x > 40 && x < 110) || (x > 150 && x < 175) || (x > 210 && x < 280 && (y < 60 || y > 120 || x < 230));
      if (!inStroke) continue;
      const i = (y * width + x) * 4;
      data.set([200, 40, 20, 255], i);
    }
  return { data, width, height };
}

function speckMask(): Gray {
  const w = 960, h = 540, rng = random(7);
  const data = new Float32Array(w * h);
  for (let n = 0; n < 4000; n++) {
    const cx = Math.floor(rng() * w), cy = Math.floor(rng() * h), r = 1 + Math.floor(rng() * 3);
    for (let y = Math.max(0, cy - r); y < Math.min(h, cy + r); y++)
      for (let x = Math.max(0, cx - r); x < Math.min(w, cx + r); x++) data[y * w + x] = 1;
  }
  return { data, width: w, height: h };
}

const mask = speckMask();
const source = artwork();
const inside = (i: number) => source.data[i * 4 + 3] > 0;

function ink(layer: Rgba, where: (i: number) => boolean) {
  let total = 0;
  for (let i = 0; i < layer.width * layer.height; i++) if (where(i)) total += layer.data[i * 4 + 3] / 255;
  return total;
}

test("the same seed and knobs give the same render, and a new seed changes it", () => {
  const settings = { chips: 50, edge: 50, spray: 50, mottle: 30, displacement: 30 };
  const a = wear(source, mask, { ...settings, seed: 3 });
  const b = wear(source, mask, { ...settings, seed: 3 });
  const c = wear(source, mask, { ...settings, seed: 4 });
  assert.deepEqual(a.data, b.data);
  assert.notDeepEqual(a.data, c.data);
});

test("chips and edge chips remove ink inside the artwork; spray adds ink outside", () => {
  const off = wear(source, mask, {});
  const chips = wear(source, mask, { chips: 80 });
  const edge = wear(source, mask, { edge: 80 });
  const spray = wear(source, mask, { spray: 80 });
  assert.ok(ink(chips, inside) < ink(off, inside) * 0.97);
  assert.ok(ink(edge, inside) < ink(off, inside) * 0.97);
  assert.ok(ink(spray, (i) => !inside(i)) > ink(off, (i) => !inside(i)) + 50);
});

test("worn pixels keep the artwork colour, and a cache gives the same result", () => {
  const cache = new Map();
  const first = wear(source, mask, { chips: 40, spray: 60, seed: 9, cache, maskKey: "specks" });
  const second = wear(source, mask, { chips: 40, spray: 60, seed: 9, cache, maskKey: "specks" });
  assert.deepEqual(first.data, second.data);
  for (let i = 0; i < width * height; i++)
    if (first.data[i * 4 + 3] > 0) assert.deepEqual([...first.data.subarray(i * 4, i * 4 + 3)], [200, 40, 20]);
});

test("all knobs at zero return the artwork unchanged", () => {
  const off = wear(source, mask, { chips: 0, edge: 0, spray: 0, mottle: 0, displacement: 0, seed: 3 });
  assert.deepEqual(off.data, source.data);
  const slight = wear(source, mask, { mottle: 1, seed: 3 });
  assert.notDeepEqual(slight.data, source.data);
});

test("artwork without a transparent area is rejected", () => {
  const opaque = { data: new Uint8ClampedArray(width * height * 4).fill(255), width, height };
  assert.throws(() => wear(opaque, mask, {}), /transparent area/);
});
