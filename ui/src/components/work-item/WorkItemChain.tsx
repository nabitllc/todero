/**
 * Mission › Feature › Task, above the title. Nothing when the task has no
 * feature goal behind it.
 */
import { Link } from "@/lib/router";
import type { ChainLink } from "./work-item-chain";

export function WorkItemChain({ chain }: { chain: ChainLink[] }) {
  if (chain.length === 0) return null;
  return (
    <nav className="work-item-chain" data-testid="work-item-chain" aria-label="Why this task">
      {chain.map((link, index) => (
        <span key={link.id} className="work-item-chain-link">
          {index > 0 ? <span className="work-item-chain-sep"> › </span> : null}
          {link.href ? (
            <Link to={link.href}>{link.label}</Link>
          ) : (
            <span className="work-item-chain-current">{link.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
