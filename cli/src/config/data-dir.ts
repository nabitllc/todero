import path from "node:path";
import { readOperatorEnv, setOperatorEnv } from "@todero/shared/operator-env";
import {
  expandHomePrefix,
  resolveDefaultConfigPath,
  resolveDefaultContextPath,
  resolveToderoInstanceId,
} from "./home.js";

export interface DataDirOptionLike {
  dataDir?: string;
  config?: string;
  context?: string;
  instance?: string;
}

export interface DataDirCommandSupport {
  hasConfigOption?: boolean;
  hasContextOption?: boolean;
}

export function applyDataDirOverride(
  options: DataDirOptionLike,
  support: DataDirCommandSupport = {},
): string | null {
  const rawDataDir = options.dataDir?.trim();
  if (!rawDataDir) return null;

  const resolvedDataDir = path.resolve(expandHomePrefix(rawDataDir));
  setOperatorEnv("HOME", resolvedDataDir);

  if (support.hasConfigOption) {
    const hasConfigOverride = Boolean(options.config?.trim()) || Boolean(readOperatorEnv("CONFIG")?.trim());
    if (!hasConfigOverride) {
      const instanceId = resolveToderoInstanceId(options.instance);
      setOperatorEnv("INSTANCE_ID", instanceId);
      setOperatorEnv("CONFIG", resolveDefaultConfigPath(instanceId));
    }
  }

  if (support.hasContextOption) {
    const hasContextOverride = Boolean(options.context?.trim()) || Boolean(readOperatorEnv("CONTEXT")?.trim());
    if (!hasContextOverride) {
      setOperatorEnv("CONTEXT", resolveDefaultContextPath());
    }
  }

  return resolvedDataDir;
}
