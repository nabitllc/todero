/**
 * Displays metadata for a skill pack row: version, last changed because line, and reset button.
 * Renders nothing for non-pack skills.
 */

import { useState } from "react";
import type { CompanySkillListItem } from "@todero/shared";
import { companySkillsApi } from "../../api/companySkills";
import { packRowFacts } from "../../lib/skill-pack-row";
import { Button } from "@/components/ui/button";
import { cn } from "../../lib/utils";

export interface SkillPackRowMetaProps {
  item: CompanySkillListItem;
  companyId: string;
  onReset?: () => void;
}

export function SkillPackRowMeta({ item, companyId, onReset }: SkillPackRowMetaProps) {
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const facts = packRowFacts(item);

  if (!facts.isPack) {
    return null;
  }

  const handleReset = async () => {
    setIsResetting(true);
    setError(null);
    try {
      await companySkillsApi.resetToOriginal(companyId, item.id);
      onReset?.();
    } catch (err) {
      setError("Could not reset this skill.");
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="space-y-1">
      {facts.version && (
        <div className="text-xs text-(color:--text-muted)">
          Version {facts.version}
        </div>
      )}
      {facts.lastChangedBecause && (
        <div className="text-xs text-(color:--text-muted)">
          Last changed because: {facts.lastChangedBecause}
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleReset}
          disabled={isResetting}
          className="text-xs h-7 px-2"
        >
          {isResetting ? "Resetting..." : "Reset to the original"}
        </Button>
        {error && (
          <span className="text-xs text-(color:--text-error)">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
