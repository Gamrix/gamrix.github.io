import { Button } from "@/components/ui/button";

type TzToggleProps = {
  displayZone: "home" | "target";
  homeZone: string;
  targetZone: string;
  onChange: (mode: "home" | "target") => void;
};

export function TzToggle({
  displayZone,
  homeZone,
  targetZone,
  onChange,
}: TzToggleProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card/70 p-2 text-xs text-muted-foreground shadow-sm">
      <span className="uppercase tracking-[0.18em]">Display zone</span>
      <div className="flex gap-2">
        <Button
          type="button"
          variant={displayZone === "target" ? "default" : "outline"}
          size="sm"
          onClick={() => onChange("target")}
          aria-pressed={displayZone === "target"}
          aria-label={targetZone}
        >
          Target
          <span
            className="ml-2 text-[10px] text-muted-foreground"
            aria-hidden="true"
          >
            {targetZone}
          </span>
        </Button>
        <Button
          type="button"
          variant={displayZone === "home" ? "default" : "outline"}
          size="sm"
          onClick={() => onChange("home")}
          aria-pressed={displayZone === "home"}
          aria-label={homeZone}
        >
          Home
          <span
            className="ml-2 text-[10px] text-muted-foreground"
            aria-hidden="true"
          >
            {homeZone}
          </span>
        </Button>
      </div>
    </div>
  );
}
