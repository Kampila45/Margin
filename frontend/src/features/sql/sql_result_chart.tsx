/**
 * Vega-Lite v5 declarative visualizer for Margin SQL Assistant query results.
 * Embeds responsive, theme-aware Vega-Lite specifications with seamless native SVG fallback.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import vegaEmbed from "vega-embed";
import type { SqlChartSuggestion } from "../../types/api_contract_types";

interface SqlResultChartProps {
  suggestion: SqlChartSuggestion;
  rows: Record<string, unknown>[];
  className?: string;
}

export function SqlResultChart({ suggestion, rows, className = "" }: SqlResultChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [embedError, setEmbedError] = useState<string | null>(null);

  // Detect whether the environment supports Canvas (jsdom without canvas mock does not)
  const isCanvasSupported = useMemo(() => {
    if (typeof document === "undefined") return false;
    if (typeof window !== "undefined" && window.navigator?.userAgent?.includes("jsdom")) {
      return false;
    }
    try {
      const c = document.createElement("canvas");
      return Boolean(c.getContext && c.getContext("2d"));
    } catch {
      return false;
    }
  }, []);

  // Process rows for native SVG fallback calculations
  const chartData = useMemo(() => {
    return rows
      .map((r) => {
        const xVal = String(r[suggestion.x_column] ?? "");
        const rawY = r[suggestion.y_column];
        const yVal = typeof rawY === "number" ? rawY : Number(rawY);
        return {
          x: xVal,
          y: Number.isFinite(yVal) ? yVal : 0,
        };
      })
      .filter((d) => d.x.trim().length > 0)
      .slice(0, 30);
  }, [rows, suggestion]);

  const maxY = useMemo(() => {
    const max = Math.max(...chartData.map((d) => d.y), 0);
    return max <= 0 ? 1 : max * 1.15;
  }, [chartData]);

  const formatNumber = (num: number): string => {
    if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return Number.isInteger(num) ? num.toString() : num.toFixed(2);
  };

  // Construct complete Vega-Lite specification (omit inner title so the card header renders it once)
  const vegaLiteSpec = useMemo(() => {
    if (suggestion.vega_lite_spec) {
      const specWithoutTitle = Object.fromEntries(
        Object.entries(suggestion.vega_lite_spec).filter(([key]) => key !== "title"),
      );
      return {
        ...specWithoutTitle,
        data: { values: rows },
        background: "transparent",
        autosize: { type: "fit", contains: "padding" },
        config: {
          font: "Geist, sans-serif",
          view: { stroke: "transparent" },
          axis: {
            labelFont: "JetBrains Mono, monospace",
            titleFont: "Geist, sans-serif",
            labelFontSize: 11,
            titleFontSize: 12,
            gridColor: "#e4e1e6",
            domainColor: "#c6c5d7",
          },
        },
      };
    }

    const isLine = suggestion.chart_type === "line";
    const isHorizontal = suggestion.chart_type === "horizontal_bar";

    return {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      data: { values: rows },
      width: "container",
      height: isHorizontal ? Math.max(180, Math.min(480, rows.length * 24)) : 240,
      background: "transparent",
      autosize: { type: "fit", contains: "padding" },
      mark: isLine
        ? {
            type: "line",
            point: { filled: true, fill: "#4143d5", size: 50 },
            color: "#4143d5",
            strokeWidth: 2.5,
          }
        : {
            type: "bar",
            cornerRadiusEnd: 3,
            color: "#4143d5",
          },
      encoding: isHorizontal
        ? {
            y: {
              field: suggestion.x_column,
              type: "nominal",
              sort: "-x",
              axis: { title: suggestion.x_column.replace(/_/g, " ") },
            },
            x: {
              field: suggestion.y_column,
              type: "quantitative",
              axis: { title: suggestion.y_column.replace(/_/g, " "), gridDash: [3, 3] },
            },
            tooltip: [
              { field: suggestion.x_column, type: "nominal" },
              { field: suggestion.y_column, type: "quantitative" },
            ],
          }
        : {
            x: {
              field: suggestion.x_column,
              type: "nominal",
              axis: {
                title: suggestion.x_column.replace(/_/g, " "),
                labelAngle: 0,
                grid: false,
              },
            },
            y: {
              field: suggestion.y_column,
              type: "quantitative",
              axis: { title: suggestion.y_column.replace(/_/g, " "), gridDash: [3, 3] },
            },
            tooltip: [
              { field: suggestion.x_column, type: "nominal" },
              { field: suggestion.y_column, type: "quantitative" },
            ],
          },
      config: {
        font: "Geist, sans-serif",
        view: { stroke: "transparent" },
        axis: {
          labelFont: "JetBrains Mono, monospace",
          titleFont: "Geist, sans-serif",
          labelFontSize: 11,
          titleFontSize: 12,
          gridColor: "#e4e1e6",
          domainColor: "#c6c5d7",
        },
      },
    };
  }, [suggestion, rows]);

  useEffect(() => {
    if (!isCanvasSupported || !containerRef.current) return;
    let isCancelled = false;
    let localResult: Awaited<ReturnType<typeof vegaEmbed>> | null = null;
    setEmbedError(null);

    vegaEmbed(containerRef.current, vegaLiteSpec as Parameters<typeof vegaEmbed>[1], {
      renderer: "svg",
      actions: false,
      theme: "vox",
    })
      .then((res) => {
        if (isCancelled) {
          res.view.finalize();
        } else {
          localResult = res;
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setEmbedError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      isCancelled = true;
      localResult?.view.finalize();
    };
  }, [vegaLiteSpec, isCanvasSupported]);

  return (
    <div className={`p-4 bg-surface rounded-xl border border-outline-variant/30 space-y-3 ${className}`}>
      {/* Clean Card Header with Single Chart Title */}
      <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-outline-variant/20">
        <span className="font-label-md text-xs font-bold text-on-surface truncate">
          {suggestion.title}
        </span>
      </div>

      {/* Render Area: Either interactive Vega-Lite embed or clean native SVG in environments without Canvas (e.g. tests) */}
      {isCanvasSupported && !embedError ? (
        <div className="w-full overflow-x-auto min-h-[240px] flex items-center justify-center">
          <div ref={containerRef} className="w-full flex justify-center" />
        </div>
      ) : (
        /* Native SVG Renderer */
        <div className="w-full">
          {suggestion.chart_type === "horizontal_bar" ? (
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-2">
              {chartData.map((d, i) => {
                const widthPct = Math.min(100, Math.max(3, (d.y / maxY) * 100));
                return (
                  <div key={i} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs font-body-dense">
                      <span className="font-medium text-on-surface truncate max-w-[220px]" title={d.x}>
                        {d.x}
                      </span>
                      <span className="font-code-sm font-semibold text-primary">
                        {formatNumber(d.y)}
                      </span>
                    </div>
                    <div className="w-full bg-surface-container-high rounded-full h-3 overflow-hidden">
                      <div
                        className="bg-primary hover:bg-primary-container h-full rounded-full transition-all duration-300"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : suggestion.chart_type === "line" ? (
            <div className="w-full overflow-x-auto">
              <svg viewBox="0 0 640 240" className="w-full h-56 select-none" preserveAspectRatio="none">
                {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                  const yPos = 32 + 176 * (1 - pct);
                  return (
                    <g key={pct}>
                      <line
                        x1={48}
                        y1={yPos}
                        x2={592}
                        y2={yPos}
                        stroke="currentColor"
                        className="text-outline-variant/20"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={40}
                        y={yPos + 4}
                        textAnchor="end"
                        className="fill-current text-on-surface-variant text-[10px] font-mono"
                      >
                        {formatNumber(maxY * pct)}
                      </text>
                    </g>
                  );
                })}
                {/* Line Path */}
                {chartData.length > 0 && (
                  <path
                    d={chartData
                      .map((d, i) => {
                        const px = chartData.length === 1 ? 320 : 48 + (i / (chartData.length - 1)) * 544;
                        const py = 32 + 176 - (d.y / maxY) * 176;
                        return `${i === 0 ? "M" : "L"} ${px.toFixed(1)} ${py.toFixed(1)}`;
                      })
                      .join(" ")}
                    fill="none"
                    stroke="#4143d5"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {/* Data Points */}
                {chartData.map((d, idx) => {
                  const px = chartData.length === 1 ? 320 : 48 + (idx / (chartData.length - 1)) * 544;
                  const py = 32 + 176 - (d.y / maxY) * 176;
                  return (
                    <g key={idx}>
                      <circle cx={px} cy={py} r={4} fill="#4143d5" className="hover:r-6 cursor-pointer">
                        <title>{`${d.x}: ${d.y}`}</title>
                      </circle>
                    </g>
                  );
                })}
              </svg>
              <div className="flex justify-between items-center text-[10px] font-mono text-on-surface-variant pt-2 border-t border-outline-variant/10">
                <span className="truncate max-w-[120px]">{chartData[0]?.x}</span>
                <span className="truncate max-w-[120px] text-right">
                  {chartData[chartData.length - 1]?.x}
                </span>
              </div>
            </div>
          ) : (
            /* Bar Chart */
            <div className="w-full overflow-x-auto">
              <svg viewBox="0 0 640 240" className="w-full h-56 select-none" preserveAspectRatio="none">
                {[0, 0.33, 0.66, 1].map((pct) => {
                  const yPos = 30 + 180 * (1 - pct);
                  return (
                    <g key={pct}>
                      <line
                        x1={40}
                        y1={yPos}
                        x2={600}
                        y2={yPos}
                        stroke="currentColor"
                        className="text-outline-variant/20"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={34}
                        y={yPos + 4}
                        textAnchor="end"
                        className="fill-current text-on-surface-variant text-[10px] font-mono"
                      >
                        {formatNumber(maxY * pct)}
                      </text>
                    </g>
                  );
                })}
                {/* Bars */}
                {chartData.map((d, idx) => {
                  const barH = (d.y / maxY) * 180;
                  const spacing = 560 / chartData.length;
                  const width = Math.max(12, Math.min(36, spacing * 0.65));
                  const x = 40 + idx * spacing + (spacing - width) / 2;
                  const y = 30 + 180 - barH;
                  return (
                    <g key={idx}>
                      <rect
                        x={x}
                        y={y}
                        width={width}
                        height={Math.max(2, barH)}
                        rx={3}
                        fill="#4143d5"
                        className="hover:opacity-85 transition-opacity cursor-pointer"
                      >
                        <title>{`${d.x}: ${d.y}`}</title>
                      </rect>
                    </g>
                  );
                })}
              </svg>
              <div className="flex justify-between items-center text-[10px] font-mono text-on-surface-variant pt-2 border-t border-outline-variant/10 overflow-hidden">
                {chartData.slice(0, 8).map((d, i) => (
                  <span key={i} className="truncate max-w-[70px] text-center" title={d.x}>
                    {d.x}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
