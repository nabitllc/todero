/**
 * Legacy notice text that must be preserved byte-for-byte for dedupe matching.
 * This file is not scanned by the recovery-copy gauntlet check. Tasks that
 * already carry old-wording notices must still be recognized by the dedupe
 * matcher so they don't get duplicate notices.
 */

// Wording used before the plain-language rewrite. Tasks that already carry a
// notice were saved with this exact text, so the "post this notice once" guard
// and the body matcher must keep recognizing it — otherwise every one of those
// tasks gets a second, duplicate notice in its thread.
export const LEGACY_SUCCESSFUL_RUN_HANDOFF_REQUIRED_NOTICE_BODY =
  "Todero needs a disposition before this issue can continue.";

export const LEGACY_SUCCESSFUL_RUN_HANDOFF_NOTICE_PREFIXES = [
  LEGACY_SUCCESSFUL_RUN_HANDOFF_REQUIRED_NOTICE_BODY,
  "## This issue still needs a next step",
  "## Successful run missing issue disposition",
] as const;
