import styles from "./page.module.css";

/*
  The signature: a line-drawn octopus, eight arms, each ending at a role.
  A canned composition about Todero the product — no operator data.
  Arms carry pathLength=1 so the draw-in animation needs no measured lengths.
*/
const arms = [
  { d: "M364 128C330 175 130 140 70 196", x: 70, role: "Lead" },
  { d: "M374 131C350 180 210 150 165 196", x: 165, role: "Research" },
  { d: "M386 132C375 180 290 155 260 196", x: 260, role: "Design" },
  { d: "M396 132C392 175 365 160 355 196", x: 355, role: "Build" },
  { d: "M404 132C408 175 435 160 445 196", x: 445, role: "Test" },
  { d: "M414 132C425 180 510 155 540 196", x: 540, role: "Write" },
  { d: "M426 131C450 180 590 150 635 196", x: 635, role: "Ops" },
  { d: "M436 128C470 175 670 140 730 196", x: 730, role: "Support" },
];

export default function Octopus() {
  return (
    <svg
      className={styles.octopus}
      viewBox="0 0 800 240"
      role="img"
      aria-label="An octopus with eight arms, each reaching a role: Lead, Research, Design, Build, Test, Write, Ops, Support."
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g className={styles.head}>
        <path d="M340 96C340 40 460 40 460 96C460 118 440 132 420 132H380C360 132 340 118 340 96Z" />
        <circle cx="382" cy="86" r="4" fill="currentColor" stroke="none" />
        <circle cx="418" cy="86" r="4" fill="currentColor" stroke="none" />
      </g>
      {arms.map((arm, index) => (
        <g key={arm.role} style={{ "--i": index } as React.CSSProperties}>
          <path className={styles.arm} d={arm.d} pathLength={1} />
          <circle className={styles.tip} cx={arm.x} cy="196" r="3" fill="currentColor" stroke="none" />
          <text className={styles.role} x={arm.x} y="226" textAnchor="middle" stroke="none">
            {arm.role}
          </text>
        </g>
      ))}
    </svg>
  );
}
