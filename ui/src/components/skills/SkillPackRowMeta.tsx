/**
 * Displays metadata for a skill pack row: version, last changed because line, and reset button.
 * Renders nothing for non-pack skills.
 */

import { useState } from "react";
import { companySkillsApi } from "../../api/companySkills";
import { packRowFacts } from "../../lib/skill-pack-row";
import { Button } from "@/components/ui/button";

export interface SkillPackRowMetaProps {
  /** Any skill row: the id to reset and the metadata the facts are read from. */
  item: { id: string; metadata: Record<string, unknown> | null };
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
        <div className="text-xs text-muted-foreground">
          Version {facts.version}
        </div>
      )}
      {facts.lastChangedBecause && (
        <div className="text-xs text-muted-foreground">
          Last changed because: {facts.lastChangedBecause}
        </div>
      )}
      <div className="flex flex-col items-start gap-2 pt-1">
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
          <span className="text-xs text-destructive">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
