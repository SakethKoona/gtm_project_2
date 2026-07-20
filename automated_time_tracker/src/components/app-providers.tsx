"use client";

import { TrackerProvider, useTracker } from "./tracker-provider";
import { DispositionDialog } from "./disposition-dialog";

/** Wraps the app in the tracker context + hosts the end-call dialog globally. */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <TrackerProvider>
      {children}
      <DispositionHost />
    </TrackerProvider>
  );
}

function DispositionHost() {
  const t = useTracker();
  return (
    <DispositionDialog
      open={t.endCallOpen}
      onOpenChange={t.setEndCallOpen}
      onSave={(d, note) => {
        t.commitCall(d, note);
        t.setEndCallOpen(false);
      }}
    />
  );
}
