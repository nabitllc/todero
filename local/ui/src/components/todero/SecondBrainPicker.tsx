import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { RECOMMENDED_VAULT_REPO_PAGE_URL, toderoVaultApi, type VaultSource } from "@/api/vault";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SecondBrainPickerProps = {
  mode: "onboarding" | "settings";
  onSaved?: (source: VaultSource) => void;
  onBack?: () => void;
};

function folderFromPickerFiles(files: FileList | null): string | null {
  const file = files?.[0] as (File & { path?: string; webkitRelativePath?: string }) | undefined;
  if (!file) return null;
  const abs = typeof file.path === "string" ? file.path.trim() : "";
  if (!abs) return null;
  const rel = typeof file.webkitRelativePath === "string" ? file.webkitRelativePath.trim() : "";
  const absNorm = abs.replaceAll("\\", "/");
  const relNorm = rel.replaceAll("\\", "/");
  if (relNorm && absNorm.endsWith(relNorm)) {
    const cut = abs.length - rel.length;
    const prefix = abs.slice(0, Math.max(0, cut)).replace(/[\\/]+$/, "");
    return prefix || null;
  }
  const idx = Math.max(abs.lastIndexOf("/"), abs.lastIndexOf("\\"));
  return idx > 0 ? abs.slice(0, idx) : abs;
}

export function SecondBrainPicker({ mode, onSaved, onBack }: SecondBrainPickerProps) {
  const [source, setSource] = useState<VaultSource>("recommended");
  const [personalPath, setPersonalPath] = useState("");
  const [recommendedExists, setRecommendedExists] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [ensuring, setEnsuring] = useState(false);
  const [ensureFailed, setEnsureFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ensureRecommendedClone(): Promise<boolean> {
    setEnsuring(true);
    setEnsureFailed(false);
    setError(null);
    try {
      const ensured = await toderoVaultApi.ensureRecommended();
      setRecommendedExists(ensured.recommendedExists);
      if (!ensured.recommendedExists) {
        setEnsureFailed(true);
        setError("Recommended Second Brain is missing. It is not attached.");
        return false;
      }
      return true;
    } catch (err) {
      setRecommendedExists(false);
      setEnsureFailed(true);
      setError(err instanceof Error ? err.message : "Failed to clone Recommended Second Brain");
      return false;
    } finally {
      setEnsuring(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await toderoVaultApi.get();
        if (cancelled) return;
        setRecommendedExists(res.recommendedExists);
        const nextSource = res.settings?.source ?? "recommended";
        if (res.settings) {
          setSource(res.settings.source);
          if (res.settings.source === "personal" && res.settings.path) {
            setPersonalPath(res.settings.path);
          }
        }
        if (nextSource === "recommended") {
          await ensureRecommendedClone();
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Second Brain settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const recommendedReady = recommendedExists === true && !ensureFailed;
  const recommendedMissing = recommendedExists === false;
  const continueBlocked =
    saving ||
    ensuring ||
    (source === "personal" && !personalPath.trim()) ||
    (source === "recommended" && !recommendedReady);

  async function persist(next: VaultSource) {
    if (next === "recommended" && !recommendedReady) {
      setError(error ?? "Recommended Second Brain is missing. It is not attached.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await toderoVaultApi.save({
        source: next,
        path: next === "personal" ? personalPath : null,
      });
      onSaved?.(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save Second Brain";
      setError(message);
      if (next === "recommended") {
        setRecommendedExists(false);
        setEnsureFailed(true);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">
        {ensuring ? "Cloning Recommended Second Brain..." : "Loading Second Brain..."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Second Brain</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Read-only vault. Recommended clones the public Todero Brain into an app-owned folder, then attaches it.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <button
          type="button"
          className={cn(
            "rounded-md border p-3 text-left text-sm transition-colors",
            source === "recommended" ? "border-foreground bg-accent" : "border-border hover:bg-accent/50",
          )}
          onClick={() => {
            setSource("recommended");
            if (!recommendedReady) void ensureRecommendedClone();
          }}
        >
          <div className="font-medium">Recommended</div>
          <div className="text-xs text-muted-foreground mt-1 break-all">
            {RECOMMENDED_VAULT_REPO_PAGE_URL}
            {recommendedMissing || ensureFailed ? " — missing" : null}
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
          <div className="text-xs text-muted-foreground mt-1">Folder on this computer.</div>
        </button>
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
      </div>

      {source === "personal" ? (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="todero-personal-vault-path">
            Folder on this computer.
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="todero-personal-vault-path"
              value={personalPath}
              onChange={(e) => setPersonalPath(e.target.value)}
              placeholder="Absolute path to a vault folder"
              aria-label="Personal Second Brain folder path"
              autoFocus
            />
            <label className="relative inline-flex h-9 shrink-0 cursor-pointer items-center rounded-md border border-border px-3 text-sm">
              Browse
              <input
                type="file"
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label="Browse for a folder on this computer"
                multiple
                ref={(el) => {
                  if (!el) return;
                  el.setAttribute("webkitdirectory", "");
                  el.setAttribute("directory", "");
                }}
                onChange={(e) => {
                  const picked = folderFromPickerFiles(e.target.files);
                  if (picked) setPersonalPath(picked);
                }}
              />
            </label>
          </div>
        </div>
      ) : null}

      {source === "recommended" && (recommendedMissing || ensureFailed) ? (
        <p className="text-xs text-destructive">
          Recommended Second Brain is missing. It is not attached.
        </p>
      ) : null}

      {ensuring ? (
        <p className="text-xs text-muted-foreground">Cloning Recommended Second Brain...</p>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex items-center justify-between gap-2">
        {mode === "onboarding" && onBack ? (
          <Button size="sm" variant="ghost" disabled={saving || ensuring} onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            Back
          </Button>
        ) : (
          <span />
        )}
        <Button
          size="sm"
          disabled={continueBlocked}
          onClick={() => void persist(source)}
        >
          {saving ? "Saving..." : mode === "onboarding" ? "Continue" : "Save"}
        </Button>
      </div>
    </div>
  );
}
