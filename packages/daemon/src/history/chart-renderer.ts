import * as vl from "vega-lite";
import * as vega from "vega";
import sharp from "sharp";

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
 * Compile a Vega-Lite spec to SVG, then convert to PNG via sharp.
 */
export async function renderVegaLiteSpec(specJson: string): Promise<{ png: Buffer; svg: string }> {
  const vlSpec = JSON.parse(specJson);

  // Set sensible defaults for server-side rendering
  if (!vlSpec.width) vlSpec.width = 600;
  if (!vlSpec.height) vlSpec.height = 400;
  if (!vlSpec.background) vlSpec.background = "#1a1a2e";

  // Apply dark theme config
  if (!vlSpec.config) vlSpec.config = {};
  Object.assign(vlSpec.config, {
    axis: {
      labelColor: "#a0a0b0",
      titleColor: "#d0d0e0",
      gridColor: "#2a2a3e",
      domainColor: "#3a3a4e",
    },
    legend: { labelColor: "#a0a0b0", titleColor: "#d0d0e0" },
    title: { color: "#d0d0e0" },
    view: { stroke: "#2a2a3e" },
  });

  const vegaSpec = vl.compile(vlSpec).spec;
  const view = new vega.View(vega.parse(vegaSpec), { renderer: "none" });

  const svg = await view.toSVG();
  view.finalize();

  const png = await sharp(Buffer.from(svg)).png().toBuffer();

  return { png, svg };
}
