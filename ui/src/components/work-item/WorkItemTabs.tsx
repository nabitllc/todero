/**
 * The tab strip over the main column. On a wide screen it reads as tabs with an
 * underline; on a phone the same markup is a segmented control, which is what
 * the stylesheet turns it into under the phone width.
 *
 * It is a real tab strip, not buttons that look like one: each tab names the
 * panel it opens, the panel names the tab it belongs to, and the arrow keys
 * move between tabs the way they do everywhere else — only the current tab is
 * a tab stop, so Tab leaves the strip rather than walking through it.
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { tabsFor, type WorkItemTab } from "./work-item-tabs";

export type WorkItemTabsProps = {
  activeTab: WorkItemTab;
  onTabChange: (tab: WorkItemTab) => void;
  hasDeliverable: boolean;
  hasPlan: boolean;
  children: ReactNode;
};

const PANEL_ID = "work-item-tab-panel";
const tabId = (tab: WorkItemTab) => `work-item-tab-${tab}`;

/** Which tab the key press moves to, or null when the key is not ours. */
export function tabForKey(key: string, tabs: WorkItemTab[], current: WorkItemTab): WorkItemTab | null {
  const at = tabs.indexOf(current);
  if (at < 0) return null;
  if (key === "ArrowRight") return tabs[(at + 1) % tabs.length];
  if (key === "ArrowLeft") return tabs[(at - 1 + tabs.length) % tabs.length];
  if (key === "Home") return tabs[0];
  if (key === "End") return tabs[tabs.length - 1];
  return null;
}

export function WorkItemTabs(props: WorkItemTabsProps) {
  const { activeTab, onTabChange, hasDeliverable, hasPlan, children } = props;
  const tabs = tabsFor({ hasDeliverable, hasPlan });
  const stripRef = useRef<HTMLDivElement>(null);

  // One tab is no choice at all, so the strip stays out of the way entirely.
  if (tabs.length < 2) {
    return (
      <div className="work-item-tabs" data-testid="work-item-tabs" data-tab-count="1">
        <div className="work-item-tabs-panel">{children}</div>
      </div>
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = tabForKey(
      event.key,
      tabs.map((tab) => tab.id),
      activeTab,
    );
    if (!next) return;
    event.preventDefault();
    onTabChange(next);
    // The arrow keys move focus with the selection, which is what the pattern
    // expects of a strip whose panels are already loaded.
    stripRef.current?.querySelector<HTMLButtonElement>(`#${tabId(next)}`)?.focus();
  }

  return (
    <div className="work-item-tabs" data-testid="work-item-tabs" data-tab-count={tabs.length}>
      <div
        className="work-item-tab-strip"
        role="tablist"
        aria-label="Task"
        ref={stripRef}
        onKeyDown={handleKeyDown}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={tabId(tab.id)}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={PANEL_ID}
            tabIndex={activeTab === tab.id ? 0 : -1}
            data-testid={`work-item-tab-${tab.id}`}
            className={
              activeTab === tab.id ? "work-item-tab work-item-tab-current" : "work-item-tab"
            }
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        className="work-item-tabs-panel"
        role="tabpanel"
        id={PANEL_ID}
        aria-labelledby={tabId(activeTab)}
      >
        {children}
      </div>
    </div>
  );
}
