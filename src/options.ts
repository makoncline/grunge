import type { Knobs, MaskName } from "./engine";

export const FONTS: Record<string, { family: string; weight: number }> = {
  Anton: { family: "Anton", weight: 400 },
  "Archivo Black": { family: "Archivo Black", weight: 400 },
  "Alfa Slab One": { family: "Alfa Slab One", weight: 400 },
  "Bebas Neue": { family: "Bebas Neue", weight: 400 },
  "DM Serif Display": { family: "DM Serif Display", weight: 400 },
  Oswald: { family: "Oswald", weight: 700 },
};

export const SIZES = ["1280x720", "1920x1080", "3840x2160", "1080x1080", "1080x1920"] as const;

export interface Settings extends Knobs {
  text: string;
  font: string;
  ink: string;
  paper: string;
  size: (typeof SIZES)[number];
  mask: MaskName;
  seed: number;
  source: "text" | "upload";
}
