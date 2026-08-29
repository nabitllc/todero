import { api } from "./client";

export type VaultSource = "recommended" | "personal" | "none";

export type VaultSettingsRow = {
  id: 1;
  source: VaultSource;
  path: string | null;
  updatedAt: string;
};

export type VaultResponse = {
  settings: VaultSettingsRow | null;
  recommendedPath: string;
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
};
