import { createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type DialogContextValue = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const DialogContext = createContext<DialogContextValue | null>(null);

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
};

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  return (
    <DialogContext.Provider value={{ open, onOpenChange }}>
      {children}
    </DialogContext.Provider>
  );
}

const useDialogContext = () => {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error("Dialog components must be used within a Dialog");
  }
  return context;
};

export function DialogTrigger({ children }: { children: React.ReactNode }) {
  const { onOpenChange } = useDialogContext();
  return (
    <button type="button" onClick={() => onOpenChange(true)}>
      {children}
    </button>
  );
}

export function DialogContent({ children }: { children: React.ReactNode }) {
  const { open, onOpenChange } = useDialogContext();
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) {
      setPortalTarget(null);
      return;
    }

    const element = document.createElement("div");
    document.body.appendChild(element);
    setPortalTarget(element);
    return () => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
      setPortalTarget(null);
    };
  }, [open]);

  if (!open || !portalTarget) {
    return null;
  }

  const node = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur">
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-card p-6 shadow-xl">
        <button
          type="button"
          className="absolute right-4 top-4 text-sm text-muted-foreground"
          onClick={() => onOpenChange(false)}
        >
          Close
        </button>
        {children}
      </div>
    </div>
  );

  return createPortal(node, portalTarget);
}

export function DialogHeader({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 space-y-1">{children}</div>;
}

export function DialogTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-semibold text-foreground">{children}</h2>;
}

export function DialogDescription({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 flex flex-wrap justify-end gap-3">{children}</div>
  );
}

export function DialogClose({ children }: { children: React.ReactNode }) {
  const { onOpenChange } = useDialogContext();
  return (
    <button
      type="button"
      onClick={() => onOpenChange(false)}
      className="text-sm text-muted-foreground"
    >
      {children}
    </button>
  );
}
