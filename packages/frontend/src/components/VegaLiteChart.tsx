import { useRef, useEffect, memo } from "react";
import embed from "vega-embed";

const DARK_THEME = {
  background: "transparent",
  axis: {
    labelColor: "#a0a0b0",
    titleColor: "#d0d0e0",
    gridColor: "rgba(255,255,255,0.06)",
    domainColor: "rgba(255,255,255,0.12)",
  },
  legend: { labelColor: "#a0a0b0", titleColor: "#d0d0e0" },
  title: { color: "#d0d0e0" },
  view: { stroke: "transparent" },
  range: {
    category: ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#fb923c"],
  },
};

function VegaLiteChart({ spec }: { spec: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let view: any;

    const render = async () => {
      try {
        const parsed = JSON.parse(spec);

        // Set responsive width
        if (!parsed.width) parsed.width = "container";
        if (!parsed.height && !parsed.encoding?.row && !parsed.encoding?.facet) {
          parsed.height = 300;
        }

        const result = await embed(containerRef.current!, parsed, {
          actions: false,
          renderer: "svg",
          config: DARK_THEME,
        });

        if (disposed) {
          result.view.finalize();
        } else {
          view = result.view;
        }
      } catch (err) {
        console.warn("[VegaLiteChart] Failed to render:", err);
        if (containerRef.current) {
          containerRef.current.textContent = "Failed to render chart";
        }
      }
    };

    render();

    return () => {
      disposed = true;
      view?.finalize();
    };
  }, [spec]);

  return (
    <div
      ref={containerRef}
      className="my-2 rounded-lg overflow-hidden"
      style={{ background: "var(--slate)", border: "1px solid var(--graphite)" }}
    />
  );
}

export default memo(VegaLiteChart);
