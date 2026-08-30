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
  createdAt?: Date | string;
};

function createdAtMs(createdAt: Date | string | undefined): number {
  if (createdAt instanceof Date) return createdAt.getTime();
  if (createdAt == null) return 0;
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
  createdAt?: Date | string;
}

export type ArchivedCompanyBounce =
  | { action: "stay" }
  | { action: "onboarding" }
  | { action: "company"; company: BounceCandidateCompany };

/**
 * Decides whether a navigation that landed on an archived company's URL
 * should bounce using the same cold-open pick as `/` and unprefixed board
 * routes.
 *
 * Stale state deposits users into archived companies long after archiving:
 * remembered last-visited paths, browser history, bookmarks, and restored
 * tabs all outlive the archive. Those are cold arrivals, even when bootstrap
 * has already written the stored archive into `selectedCompanyId`. Cold
 * arrivals bounce through {@link pickColdOpenCompany}: last-viewed only if
 * still active, else first-created active, else the onboarding wizard.
 *
 * Deliberate visits still work: opening an archive from the companies list
 * this session (`selectionSource === "manual"`) stays put so settings and
 * unarchive flows remain reachable.
 */
export function resolveArchivedCompanyBounce(params: {
  matchedCompany: BounceCandidateCompany | null;
  selectedCompanyId: string | null;
  companies: BounceCandidateCompany[];
  selectionSource?: CompanySelectionSource;
  lastViewedId?: string | null;
}): ArchivedCompanyBounce {
  const { matchedCompany, selectedCompanyId, companies, selectionSource } = params;
  if (!matchedCompany || matchedCompany.status !== "archived") {
    return { action: "stay" };
  }
  const openedFromCompaniesListThisSession =
    selectionSource === "manual" && selectedCompanyId === matchedCompany.id;
  if (openedFromCompaniesListThisSession) {
    return { action: "stay" };
  }

  const picked = pickColdOpenCompany(
    companies,
    params.lastViewedId ?? selectedCompanyId,
  );
  if (!picked) return { action: "onboarding" };
  if (picked.id === matchedCompany.id) return { action: "stay" };
  return { action: "company", company: picked };
}

/**
 * Prefix an unprefixed board path with the cold-open company, or send the
 * operator to the onboarding wizard when there is no active org.
 */
export function resolveUnprefixedBoardPath(params: {
  pathname: string;
  search?: string;
  hash?: string;
  companies: readonly ColdOpenCompany[];
  lastViewedId: string | null | undefined;
}): "/onboarding" | `/${string}` {
  const company = pickColdOpenCompany(params.companies, params.lastViewedId);
  if (!company) return "/onboarding";
  return `/${company.issuePrefix}${params.pathname}${params.search ?? ""}${params.hash ?? ""}`;
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
