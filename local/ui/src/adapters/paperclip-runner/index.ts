import { buildToderoRunnerConfig, parseCodexStdoutLine } from "@todero/adapter-codex-local/ui";
import { CodexLocalConfigFields } from "../codex-local/config-fields";
import type { UIAdapterModule } from "../types";

export const toderoRunnerUIAdapter: UIAdapterModule = {
  type: "paperclip_runner",
  label: "Todero Runner",
  parseStdoutLine: parseCodexStdoutLine,
  ConfigFields: CodexLocalConfigFields,
  buildAdapterConfig: buildToderoRunnerConfig,
};
