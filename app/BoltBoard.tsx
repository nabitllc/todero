import styles from "./page.module.css";

/*
  The product frame: one bolt (a 24-hour sprint) for an invented company.
  Canned on purpose — no operator data. The only motion is the Working chip.
*/
const goal = "Launch the docs site.";

const columns = [
  {
    name: "Backlog",
    items: [
      { title: "Write the install guide", role: "Write" },
      { title: "Add search to the docs", role: "Build" },
    ],
  },
  {
    name: "Doing",
    items: [
      { title: "Set up CI for the site", role: "Ops", working: true },
      { title: "Draft the landing copy", role: "Lead" },
    ],
  },
  {
    name: "Done",
    items: [
      { title: "Choose a static host", role: "Research" },
      { title: "Point the domain", role: "Ops" },
    ],
  },
];

export default function BoltBoard() {
  return (
    <figure className={styles.frame}>
      <div className={styles.board} role="img" aria-label={`A bolt board. Goal: ${goal} Backlog, Doing, Done.`}>
        <header className={styles.boardHead}>
          <span className={styles.bolt}>Bolt 14 · 24h</span>
          <span className={styles.goal}>{goal}</span>
          <span className={styles.left}>18h left</span>
        </header>
        <div className={styles.columns}>
          {columns.map((column) => (
            <section className={styles.column} key={column.name}>
              <h3 className={styles.columnName}>{column.name}</h3>
              <ul className={styles.items}>
                {column.items.map((item) => (
                  <li className={styles.item} key={item.title}>
                    <span className={styles.itemTitle}>{item.title}</span>
                    <span className={styles.itemMeta}>
                      <span className={styles.role}>{item.role}</span>
                      {item.working ? (
                        <span className={styles.chip}>
                          <span className={styles.chipA}>Queued</span>
                          <span className={styles.chipB}>Working</span>
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
      <figcaption className={styles.caption}>
        <span>MIT</span>
        <span>Based on Paperclip</span>
        <span>npm: todero</span>
        <span>macOS, Windows, Linux</span>
      </figcaption>
    </figure>
  );
}
