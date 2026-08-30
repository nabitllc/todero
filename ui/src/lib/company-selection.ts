export type CompanySelectionSource = "manual" | "route_sync" | "bootstrap";

export const SELECTED_COMPANY_STORAGE_KEY = "todero.selectedCompanyId";

/** Active orgs are everything that is not archived (paused still counts). */
export function isActiveCompany(company: { status: string }): boolean {
  return company.status !== "archived";
}

export function activeCompanies<T extends { status: string }>(companies: readonly T[]): T[] {
  return companies.filter(isActiveCompany);
}

export type ColdOpenCompany = {
  id: string;
  issuePrefix: string;
  status: string;
  createdAt: Date | string;
};

function createdAtMs(createdAt: Date | string): number {
  if (createdAt instanceof Date) return createdAt.getTime();
  const ms = Date.parse(String(createdAt));
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Last-viewed org for a cold open: an in-memory selection if one exists,
 * otherwise `todero.selectedCompanyId` in localStorage. CompanyRootRedirect
 * can render before the bootstrap effect hydrates selection from storage,
 * so the redirect must read the store itself rather than waiting on
 * `selectedCompany`.
 */
export function resolveLastViewedCompanyId(
  selectedCompanyId: string | null | undefined,
): string | null {
  if (selectedCompanyId) return selectedCompanyId;
  try {
    return localStorage.getItem(SELECTED_COMPANY_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Which company a cold open of Todero (`/` or Desktop start) should land on.
 *
 * Zero active orgs — including archived-only — returns null so the caller
 * can open the onboarding wizard instead of dumping the user into an
 * archive or a launcher card. A last-viewed id wins only when that org is
 * still active. Otherwise the earliest-created active org (by `createdAt`,
 * not array order) is used.
 */
export function pickColdOpenCompany<T extends ColdOpenCompany>(
  companies: readonly T[],
  lastViewedId: string | null | undefined,
): T | null {
  const active = activeCompanies(companies);
  if (active.length === 0) return null;
  if (lastViewedId) {
    const lastViewed = active.find((company) => company.id === lastViewedId);
    if (lastViewed) return lastViewed;
  }
  return active.reduce((earliest, company) =>
    createdAtMs(company.createdAt) < createdAtMs(earliest.createdAt) ? company : earliest,
  );
}

export function resolveColdOpenPath(params: {
  companies: readonly ColdOpenCompany[];
  lastViewedId: string | null | undefined;
}): "/onboarding" | `/${string}/dashboard` {
  const company = pickColdOpenCompany(params.companies, params.lastViewedId);
  if (!company) return "/onboarding";
  return `/${company.issuePrefix}/dashboard`;
}


interface BounceCandidateCompany {
  id: string;
  name: string;
  issuePrefix: string;
  status: string;
}

/**
 * Decides whether a navigation that landed on an archived company's URL
 * should bounce to an active company instead of dwelling in the archive.
 *
 * Stale state deposits users into archived companies long after archiving:
 * remembered last-visited paths, browser history, bookmarks, and restored
 * tabs all outlive the archive. Rendering those pages is safe, but it is
 * never where the user wants to *be* — the sidebar does not even list the
 * company. Cold arrivals therefore bounce to an active company.
 *
 * Deliberate visits still work: when the archived company is already the
 * selection (the user chose it from the companies list), there is no
 * bounce, so its settings and unarchive flows stay reachable. When no
 * active company exists there is nowhere better to go, so the archive
 * renders rather than bouncing into a dead end.
 */
export function resolveArchivedCompanyBounce(params: {
  matchedCompany: BounceCandidateCompany | null;
  selectedCompanyId: string | null;
  companies: BounceCandidateCompany[];
}): BounceCandidateCompany | null {
  const { matchedCompany, selectedCompanyId, companies } = params;
  if (!matchedCompany || matchedCompany.status !== "archived") return null;
  if (selectedCompanyId === matchedCompany.id) return null;

  const selectedActive = companies.find(
    (company) => company.id === selectedCompanyId && company.status !== "archived",
  );
  return selectedActive ?? companies.find((company) => company.status !== "archived") ?? null;
}

export function shouldSyncCompanySelectionFromRoute(params: {
  selectionSource: CompanySelectionSource;
  selectedCompanyId: string | null;
  routeCompanyId: string;
}): boolean {
  const { selectionSource, selectedCompanyId, routeCompanyId } = params;

  if (selectedCompanyId === routeCompanyId) return false;

  // Let manual company switches finish their remembered-path navigation first.
  if (selectionSource === "manual" && selectedCompanyId) {
    return false;
  }

  return true;
}
