/** One colour of dots: what a method estimated for each train (across), and what the train really cost (up). */
export type ScatterSeries = { id: string; label: string; color: string; points: { estimate: number; real: number }[] };

const [W, H, LEFT, RIGHT, TOP, BOTTOM] = [620, 440, 56, 16, 16, 52];

/** A scatter plot of the estimates against the real prices, on the diagonal where an estimate is exact: above it the estimate was too low. */
export function ScatterPlot({ series, xLabel = "Estimation (€)", yLabel = "Prix réel (€)" }: { series: ScatterSeries[]; xLabel?: string; yLabel?: string }) {
  const all = series.flatMap((s) => s.points);
  const top = Math.max(50, ...all.flatMap((p) => [p.estimate, p.real]));
  const step = top > 250 ? 100 : top > 120 ? 50 : 25;
  const max = Math.ceil(top / step) * step;
  const x = (value: number) => LEFT + (value / max) * (W - LEFT - RIGHT);
  const y = (value: number) => H - BOTTOM - (value / max) * (H - TOP - BOTTOM);
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step);

  return (
    <figure className="flex flex-col gap-3">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Estimations contre prix réels: ${series.map((s) => `${s.label}, ${s.points.length} trains`).join("; ")}`} className="w-full max-w-[760px] text-white">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={LEFT} x2={W - RIGHT} y1={y(tick)} y2={y(tick)} stroke="currentColor" strokeOpacity={0.1} />
            <line y1={TOP} y2={H - BOTTOM} x1={x(tick)} x2={x(tick)} stroke="currentColor" strokeOpacity={0.1} />
            <text x={LEFT - 8} y={y(tick) + 4} textAnchor="end" fontSize={13} fill="currentColor" fillOpacity={0.7}>{tick}</text>
            <text x={x(tick)} y={H - BOTTOM + 18} textAnchor="middle" fontSize={13} fill="currentColor" fillOpacity={0.7}>{tick}</text>
          </g>
        ))}
        {/* An exact estimate is on this line */}
        <line x1={x(0)} y1={y(0)} x2={x(max)} y2={y(max)} stroke="currentColor" strokeOpacity={0.55} strokeDasharray="6 5" />
        {series.map((s) =>
          s.points.map((p, i) => <circle key={`${s.id}-${i}`} cx={x(p.estimate)} cy={y(p.real)} r={3.6} fill={s.color} fillOpacity={0.6} />),
        )}
        <text x={(LEFT + W - RIGHT) / 2} y={H - 8} textAnchor="middle" fontSize={14} fill="currentColor" fillOpacity={0.85}>{xLabel}</text>
        <text transform={`translate(14 ${(TOP + H - BOTTOM) / 2}) rotate(-90)`} textAnchor="middle" fontSize={14} fill="currentColor" fillOpacity={0.85}>{yLabel}</text>
      </svg>
      <figcaption className="flex flex-wrap gap-x-6 gap-y-2 text-base text-white/80">
        {series.map((s) => (
          <span key={s.id} className="flex items-center gap-2">
            <span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label} ({s.points.length})
          </span>
        ))}
        <span className="text-white/55">· Au-dessus de la diagonale, l’estimation était trop basse.</span>
      </figcaption>
    </figure>
  );
}
