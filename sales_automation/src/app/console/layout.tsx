"use client";

import { TrackerProvider, useTracker } from "@/components/tracker-provider";
import { DispositionDialog } from "@/components/disposition-dialog";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
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
