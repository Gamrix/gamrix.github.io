import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  CorePlanSchema,
  type CorePlan,
} from "@/scripts/projects/zoneshift/model";

interface ImportExportProps {
  onImport: (plan: CorePlan) => void;
  onReset: () => void;
  exportPlan: () => string;
  className?: string;
}

const encodePlanForHash = (planJson: string) => {
  if (typeof window === "undefined") {
    return "";
  }
  return window.btoa(unescape(encodeURIComponent(planJson)));
};

const decodePlanFromHash = (): CorePlan | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const hash = window.location.hash.replace(/^#/, "");
  const match = hash.match(/plan=([^&]+)/);
  if (!match) {
    return null;
  }
  try {
    const decoded = decodeURIComponent(escape(window.atob(match[1])));
    return CorePlanSchema.parse(JSON.parse(decoded));
  } catch (error) {
    console.error("Failed to decode plan hash", error);
    return null;
  }
};

export function ImportExport({
  onImport,
  onReset,
  exportPlan,
  className,
}: ImportExportProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const triggerFileDialog = () => fileInputRef.current?.click();

  const handleExport = async () => {
    const json = exportPlan();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
        setStatus("Plan copied to clipboard");
        return;
      }
    } catch (error) {
      console.error("Clipboard export failed", error);
    }
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "zoneshift-plan.json";
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Download started");
  };

  const handleShare = () => {
    const json = exportPlan();
    const encoded = encodePlanForHash(json);
    if (!encoded) {
      setStatus("Unable to create share link");
      return;
    }
    window.location.hash = `plan=${encoded}`;
    setStatus("Updated URL hash with plan payload");
  };

  const handleImportFile: React.ChangeEventHandler<HTMLInputElement> = async (
    event
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const parsed = CorePlanSchema.parse(JSON.parse(text));
      onImport(parsed);
      setStatus(`Imported plan from ${file.name}`);
    } catch (error) {
      console.error("Failed to import plan", error);
      setStatus("Import failed");
    } finally {
      event.target.value = "";
    }
  };

  const containerClass = className
    ? `flex flex-col gap-1 ${className}`
    : "flex flex-col gap-1";

  return (
    <div className={containerClass}>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={handleExport}>
          Export JSON
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={triggerFileDialog}
        >
          Import JSON
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={handleShare}>
          Share via hash
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            const plan = decodePlanFromHash();
            if (plan) {
              onImport(plan);
              setStatus("Imported plan from URL hash");
            } else {
              setStatus("No plan hash detected");
            }
          }}
        >
          Load from hash
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onReset}>
          Reset plan
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        onChange={handleImportFile}
        className="hidden"
      />
      {status ? (
        <p className="text-xs text-muted-foreground leading-tight">{status}</p>
      ) : null}
    </div>
  );
}
