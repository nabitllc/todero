import { api } from "./client";

export type VaultSource = "recommended" | "personal" | "none";

/** Card label for Recommended. Clone URL may append .git. */
export const RECOMMENDED_VAULT_REPO_PAGE_URL = "https://github.com/nabitllc/todero-brain";

export type VaultSettingsRow = {
  id: 1;
  source: VaultSource;
  path: string | null;
  updatedAt: string;
};

export type VaultResponse = {
  settings: VaultSettingsRow | null;
  recommendedPath: string;
  recommendedRepoUrl: string;
  recommendedExists: boolean;
  recommendedFromEnv: boolean;
  readPath: string | null;
  readPathExists: boolean;
  readOnly: true;
};

export const toderoVaultApi = {
  get: () => api.get<VaultResponse>("/todero/vault"),
  save: (input: { source: VaultSource; path?: string | null }) =>
    api.put<{ settings: VaultSettingsRow; readPath: string | null; readPathExists: boolean; readOnly: true }>(
      "/todero/vault",
      input,
    ),
  /** Clone or pull the public repo into the app-owned folder, then attach it. */
  ensureRecommended: () => api.post<VaultResponse>("/todero/vault/recommended/ensure", {}),
};
