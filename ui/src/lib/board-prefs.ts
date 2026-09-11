/**
 * What the person chose on the board, remembered per organization: the same
 * habit the Tasks board already has, kept in its own key so the two views do
 * not fight over one setting.
 */
export interface BoardPrefs {
  /** Rows by feature of the plan, or one row per agent. */
  rowsBy: "feature" | "agent";
  /** Whether finished features stay on the board. */
  showCompleted: boolean;
  /** One-line titles. */
  compactCards: boolean;
  /** Only this agent's work, or everyone's. */
  agentFilter: string | null;
}

export const BOARD_PREFS_DEFAULT: BoardPrefs = {
  rowsBy: "feature",
  showCompleted: false,
  compactCards: false,
  agentFilter: null,
};

export function boardPrefsKey(companyId: string): string {
  return `todero.board.prefs.${companyId}`;
}

/** Merges whatever was stored over the defaults; bad JSON reads as defaults. */
export function loadBoardPrefs(companyId: string): BoardPrefs {
  if (typeof window === "undefined") return BOARD_PREFS_DEFAULT;
  try {
    const raw = window.localStorage.getItem(boardPrefsKey(companyId));
    if (!raw) return BOARD_PREFS_DEFAULT;
    const parsed = JSON.parse(raw) as Partial<BoardPrefs>;
    return {
      rowsBy: parsed.rowsBy === "agent" ? "agent" : "feature",
      showCompleted: parsed.showCompleted === true,
      compactCards: parsed.compactCards === true,
      agentFilter: typeof parsed.agentFilter === "string" ? parsed.agentFilter : null,
    };
  } catch {
    return BOARD_PREFS_DEFAULT;
  }
}

export function saveBoardPrefs(companyId: string, prefs: BoardPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(boardPrefsKey(companyId), JSON.stringify(prefs));
  } catch {
    // A browser that refuses storage still gets a working board.
  }
}
