import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { toderoVaultApi, type VaultSource } from "@/api/vault";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SecondBrainPickerProps = {
  mode: "onboarding" | "settings";
  onSaved?: (source: VaultSource) => void;
  onBack?: () => void;
};

export function SecondBrainPicker({ mode, onSaved, onBack }: SecondBrainPickerProps) {
  const [source, setSource] = useState<VaultSource>("recommended");
  const [personalPath, setPersonalPath] = useState("");
  const [recommendedPath, setRecommendedPath] = useState("");
  const [recommendedExists, setRecommendedExists] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    toderoVaultApi
      .get()
      .then((res) => {
        if (cancelled) return;
        setRecommendedPath(res.recommendedPath);
        setRecommendedExists(res.recommendedExists);
        if (res.settings) {
          setSource(res.settings.source === "none" && mode === "onboarding" ? "recommended" : res.settings.source);
          if (res.settings.source === "personal" && res.settings.path) {
            setPersonalPath(res.settings.path);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Second Brain settings");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  async function persist(next: VaultSource) {
    setSaving(true);
    setError(null);
    try {
      await toderoVaultApi.save({
        source: next,
        path: next === "personal" ? personalPath : null,
      });
      onSaved?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save Second Brain");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading Second Brain...</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Second Brain</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Read-only vault. Todero will not create or write this folder.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <button
          type="button"
          className={cn(
            "rounded-md border p-3 text-left text-sm transition-colors",
            source === "recommended" ? "border-foreground bg-accent" : "border-border hover:bg-accent/50",
          )}
          onClick={() => setSource("recommended")}
        >
          <div className="font-medium">Recommended</div>
          <div className="text-xs text-muted-foreground mt-1 break-all">
            {recommendedPath || "TODERO_VAULT_DIR or recommended default"}
            {recommendedExists === false ? " — folder not found (still allowed)" : null}
          </div>
        </button>
        <button
          type="button"
          className={cn(
            "rounded-md border p-3 text-left text-sm transition-colors",
            source === "personal" ? "border-foreground bg-accent" : "border-border hover:bg-accent/50",
          )}
          onClick={() => setSource("personal")}
        >
          <div className="font-medium">Personal</div>
          <div className="text-xs text-muted-foreground mt-1">Use a folder you already have.</div>
        </button>
        {mode === "settings" ? (
          <button
            type="button"
            className={cn(
              "rounded-md border p-3 text-left text-sm transition-colors",
              source === "none" ? "border-foreground bg-accent" : "border-border hover:bg-accent/50",
            )}
            onClick={() => setSource("none")}
          >
            <div className="font-medium">None</div>
            <div className="text-xs text-muted-foreground mt-1">No Second Brain attached.</div>
          </button>
        ) : null}
      </div>

      {source === "personal" ? (
        <Input
          value={personalPath}
          onChange={(e) => setPersonalPath(e.target.value)}
          placeholder="/absolute/path/to/your/vault"
          autoFocus
        />
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex items-center justify-between gap-2">
        {mode === "onboarding" && onBack ? (
          <Button size="sm" variant="ghost" disabled={saving} onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            Back
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {mode === "onboarding" ? (
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => { void persist("none"); }}>
              None
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={saving || (source === "personal" && !personalPath.trim())}
            onClick={() => void persist(source)}
          >
            {saving ? "Saving..." : mode === "onboarding" ? "Continue" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}