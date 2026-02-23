import * as vl from "vega-lite";
import * as vega from "vega";
import { Resvg } from "@resvg/resvg-js";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const FONT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../assets/Inter-Regular.ttf",
);

const VEGA_LITE_BLOCK_RE = /```vega-lite\n([\s\S]*?)```/g;

/**
 * Extract vega-lite fenced code blocks from markdown content.
 * Returns the JSON specs found and the remaining text with blocks removed.
 */
export function extractVegaLiteBlocks(content: string): { specs: string[]; textWithout: string } {
  const specs: string[] = [];
  const textWithout = content.replace(VEGA_LITE_BLOCK_RE, (_match, json: string) => {
    specs.push(json.trim());
    return "";
  });
  return { specs, textWithout: textWithout.trim() };
}

/**
 * Compile a Vega-Lite spec to SVG, then convert to PNG via resvg.
 */
export async function renderVegaLiteSpec(specJson: string): Promise<{ png: Buffer; svg: string }> {
  const vlSpec = JSON.parse(specJson);

  // Set sensible defaults for server-side rendering
  if (!vlSpec.width || vlSpec.width === "container") vlSpec.width = 600;
  if (!vlSpec.height || vlSpec.height === "container") vlSpec.height = 400;
  if (!vlSpec.background || vlSpec.background === "transparent") vlSpec.background = "#1a1a2e";

  // Apply dark theme config with explicit Inter font
  if (!vlSpec.config) vlSpec.config = {};
  Object.assign(vlSpec.config, {
    font: "Inter",
    axis: {
      labelColor: "#a0a0b0",
      labelFont: "Inter",
      titleColor: "#d0d0e0",
      titleFont: "Inter",
      gridColor: "#2a2a3e",
      domainColor: "#3a3a4e",
    },
    legend: {
      labelColor: "#a0a0b0",
      labelFont: "Inter",
      titleColor: "#d0d0e0",
      titleFont: "Inter",
    },
    title: { color: "#d0d0e0", font: "Inter" },
    view: { stroke: "#2a2a3e" },
  });

  const vegaSpec = vl.compile(vlSpec).spec;
  const view = new vega.View(vega.parse(vegaSpec), { renderer: "none" });

  const svg = await view.toSVG();
  view.finalize();

  const resvg = new Resvg(svg, {
    font: {
      fontFiles: [FONT_PATH],
      loadSystemFonts: false,
      defaultFontFamily: "Inter",
    },
  });
  const png = Buffer.from(resvg.render().asPng());

  return { png, svg };
}
