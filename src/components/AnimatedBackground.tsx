// Fixed, non-interactive backdrop mounted once in the root layout so it stays
// visible (and keeps animating) across every page. Pure CSS animation on
// transform/opacity only, so it runs on the compositor and costs no JS.

const CROSS_TILE = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='112' height='140' viewBox='0 0 112 140'>
    <defs>
      <linearGradient id='h' x1='0' x2='1' y1='0' y2='0'>
        <stop offset='0' stop-color='#9fd6c4' stop-opacity='0'/>
        <stop offset='.5' stop-color='#b9e6d6' stop-opacity='.9'/>
        <stop offset='1' stop-color='#9fd6c4' stop-opacity='0'/>
      </linearGradient>
      <linearGradient id='v' x1='0' x2='0' y1='0' y2='1'>
        <stop offset='0' stop-color='#9fd6c4' stop-opacity='0'/>
        <stop offset='.5' stop-color='#b9e6d6' stop-opacity='.9'/>
        <stop offset='1' stop-color='#9fd6c4' stop-opacity='0'/>
      </linearGradient>
      <radialGradient id='c'>
        <stop offset='0' stop-color='#b9e6d6' stop-opacity='.9'/>
        <stop offset='1' stop-color='#b9e6d6' stop-opacity='0'/>
      </radialGradient>
    </defs>
    <rect x='0' y='68.5' width='112' height='3' fill='url(#h)'/>
    <rect x='54.5' y='0' width='3' height='140' fill='url(#v)'/>
    <circle cx='56' cy='70' r='20' fill='url(#c)'/>
  </svg>`,
)}")`;

export function AnimatedBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#3f3f3f] print:hidden"
    >
      {/* Soft grey-to-green light entering from the top-right corner */}
      <div className="bg-blob absolute -top-[30%] -right-[15%] h-[130%] w-[60%] animate-[blob-drift_22s_ease-in-out_infinite_alternate] bg-[radial-gradient(closest-side,rgb(120_120_120/0.85),rgb(120_120_120/0.35)_55%,transparent)] blur-3xl" />
      <div className="absolute -top-[45%] -right-[14%] h-[90%] w-[28%] animate-[glow-pulse_9s_ease-in-out_infinite_alternate] bg-[radial-gradient(closest-side,rgb(47_168_134/0.95),rgb(47_168_134/0.4)_60%,transparent)] blur-3xl" />

      {/* Blurred, slanted grid of crosses fading out from the bottom-left */}
      <div className="absolute inset-0 [mask-image:radial-gradient(ellipse_75%_60%_at_0%_100%,black_20%,transparent_100%)]">
        <div className="absolute inset-0 origin-bottom-left -skew-x-[12deg] blur-[3px]">
          <div
            className="absolute -top-[140px] -left-[112px] -right-0 -bottom-0 animate-[cross-drift_16s_linear_infinite] opacity-90"
            style={{ backgroundImage: CROSS_TILE, backgroundSize: "112px 140px" }}
          />
        </div>
      </div>
    </div>
  );
}
