import styles from "./page.module.css";

/*
  The signature: one octopus, drawn by hand — pointed mantle, eight uneven arms,
  two of them starting behind the mantle so it has depth. No captions.
  Arms carry pathLength=1 so the draw-in animation needs no measured lengths.
*/
const behind = [
  { d: "M170 112C120 130 60 120 40 170C30 195 50 215 70 205", w: 1.5 },
  { d: "M232 112C290 128 350 118 360 165C366 190 345 210 330 195", w: 1.5 },
];

const front = [
  { d: "M160 136C130 160 90 175 80 215C76 232 90 242 100 235", w: 2.2 },
  { d: "M178 138C165 170 150 200 140 240", w: 1.9 },
  { d: "M196 140C200 175 190 210 200 245C203 253 212 254 214 246", w: 2.2 },
  { d: "M214 140C225 170 240 195 236 232", w: 1.7 },
  { d: "M232 136C262 160 300 172 316 208C322 224 310 236 300 230", w: 2.2 },
  { d: "M246 130C280 140 310 140 335 150", w: 1.3 },
];

function Arm({ d, w, index }: { d: string; w: number; index: number }) {
  return (
    <path
      className={styles.arm}
      d={d}
      strokeWidth={w}
      pathLength={1}
      style={{ "--i": index } as React.CSSProperties}
    />
  );
}

export default function Octopus() {
  return (
    <svg
      className={styles.octopus}
      viewBox="20 10 360 250"
      role="img"
      aria-label="A line-drawn octopus."
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {behind.map((arm, index) => (
        <Arm key={arm.d} d={arm.d} w={arm.w} index={index} />
      ))}
      <g className={styles.mantle}>
        <path
          className={styles.mantleFill}
          d="M200 22C236 34 258 70 256 108C254 130 232 140 200 140C168 140 146 130 144 108C142 70 164 34 200 22Z"
          strokeWidth={2}
        />
        <circle cx="184" cy="92" r="4" fill="currentColor" stroke="none" />
        <circle cx="216" cy="92" r="4" fill="currentColor" stroke="none" />
      </g>
      {front.map((arm, index) => (
        <Arm key={arm.d} d={arm.d} w={arm.w} index={index + behind.length} />
      ))}
    </svg>
  );
}
