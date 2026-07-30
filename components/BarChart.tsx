// Minimal, dependency-free horizontal bar chart rendered as inline SVG.
// No client-side interactivity is needed, so this can be rendered directly
// from server components (e.g. the Dashboard) without a "use client" directive
// or an external charting library.

export interface BarChartDatum {
  label: string;
  value: number;
}

interface BarChartProps {
  data: BarChartDatum[];
  /** Value that a full-width bar represents, e.g. 100 for percentages. */
  maxValue?: number;
  valueSuffix?: string;
  /** Tailwind-independent hex color for the bar fill. */
  color?: string;
  emptyLabel?: string;
}

export default function BarChart({
  data,
  maxValue,
  valueSuffix = "",
  color = "#1d4ed8",
  emptyLabel = "No data yet.",
}: BarChartProps) {
  if (data.length === 0) {
    return <p className="text-sm text-gray-400">{emptyLabel}</p>;
  }

  const width = 600;
  const barHeight = 22;
  const gap = 12;
  const labelWidth = 96;
  const valueAreaWidth = width - labelWidth - 48;
  const height = data.length * (barHeight + gap) - gap;
  const effectiveMax = maxValue ?? Math.max(...data.map((d) => d.value), 1);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
      {data.map((d, i) => {
        const barWidth = effectiveMax > 0 ? Math.max(2, (d.value / effectiveMax) * valueAreaWidth) : 0;
        const y = i * (barHeight + gap);
        return (
          <g key={d.label}>
            <text
              x={0}
              y={y + barHeight / 2 + 4}
              fontSize="11"
              fill="#6b7280"
              className="font-medium"
            >
              {d.label.length > 16 ? `${d.label.slice(0, 15)}…` : d.label}
            </text>
            <rect
              x={labelWidth}
              y={y}
              width={valueAreaWidth}
              height={barHeight}
              rx={5}
              fill="#f3f4f6"
            />
            <rect x={labelWidth} y={y} width={barWidth} height={barHeight} rx={5} fill={color} />
            <text
              x={labelWidth + barWidth + 8}
              y={y + barHeight / 2 + 4}
              fontSize="11"
              fill="#374151"
            >
              {d.value}
              {valueSuffix}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
