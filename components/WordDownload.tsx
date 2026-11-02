"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorText } from "@/lib/format";

/**
 * Writes the Bi-Weekly Business Update for one person and cycle and downloads it as a Word file,
 * in ALG's template. The author's own button includes their drafts; a manager's covers sent reports only.
 */
export default function WordDownload({ cycle, memberId, label = "Download Word report" }: { cycle: number; memberId?: Id<"members">; label?: string }) {
  const write = useAction(api.ai.businessUpdate);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const [update, template, docx] = await Promise.all([
        write({ cycle, memberId }),
        fetch("/templates/business-update.docx").then((r) => {
          if (!r.ok) throw new Error("The Word template didn't load. Refresh and try again.");
          return r.arrayBuffer();
        }),
        import("@/lib/businessUpdateDocx"),
      ]);
      const blob = await docx.buildDocx(template, update);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = docx.fileName(update);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="word-download">
      <button className="btn quiet sm" onClick={run} disabled={busy} aria-busy={busy}>
        {busy ? "Writing the report, about 30 seconds" : label}
      </button>
      {err && <p className="notice error small">{err}</p>}
    </div>
  );
}
