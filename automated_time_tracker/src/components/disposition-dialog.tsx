"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DISPOSITIONS } from "@/lib/config";

/**
 * Shown when a call ends: tag the outcome (letter key or click) + optional note.
 * Radix Dialog handles Esc/overlay dismissal; we add the letter-key shortcuts.
 */
export function DispositionDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (dispositionId: string | null, note: string) => void;
}) {
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setNote("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement === noteRef.current) {
        if (e.key === "Enter") {
          e.preventDefault();
          onSave(null, note);
        }
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        onSave(null, note);
        return;
      }
      const d = DISPOSITIONS.find((x) => x.key === e.key.toLowerCase());
      if (d) {
        e.preventDefault();
        onSave(d.id, note);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, note, onSave]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>How did the call end?</DialogTitle>
          <DialogDescription>
            Tag the outcome — press its key or click.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {DISPOSITIONS.map((d) => (
            <Button
              key={d.id}
              variant="outline"
              onClick={() => onSave(d.id, note)}
              className="h-auto justify-between px-3 py-2.5 font-normal"
            >
              <span>{d.label}</span>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {d.key}
              </kbd>
            </Button>
          ))}
        </div>
        <Input
          ref={noteRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note (company, name, next step)…"
        />
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Back
          </Button>
          <Button onClick={() => onSave(null, note)}>Save without tag</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
