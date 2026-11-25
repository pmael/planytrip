"use client";

import { Download, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** The file name the server suggested, or a plain one. */
function filenameOf(response: Response): string {
  return /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "trip-summary.pdf";
}

/**
 * Downloads the summary as a PDF (use-cases.md C-S8). Making it takes a few seconds, since a browser
 * prints the page, so it says so while it works, and says what went wrong when it cannot.
 */
export function ExportPdfButton({ summaryId }: { summaryId: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch(`/api/summaries/${summaryId}/pdf`);
      if (!response.ok) {
        const body: { message?: string } = await response.json().catch(() => ({}));
        throw new Error(response.status === 503 && body.message ? `The PDF can’t be made right now. ${body.message}` : "Couldn’t make the PDF, please try again.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = Object.assign(document.createElement("a"), { href: url, download: filenameOf(response) });
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn’t make the PDF, please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className={cn(
          "flex h-[50px] cursor-pointer items-center gap-2 rounded-full border border-emerald-200/50 bg-[#3f7a62]/85 px-5 text-lg text-white outline-none transition-[background-color,transform] hover:bg-[#4a8a70] focus-visible:ring-2 focus-visible:ring-emerald-300/60 active:scale-[0.97] disabled:cursor-wait disabled:opacity-80 [&_svg]:size-5 [&_svg]:stroke-[1.6]",
        )}
      >
        {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : <Download aria-hidden />}
        {busy ? "Preparing the PDF…" : "Export PDF"}
      </button>
      {problem && (
        <span role="alert" className="max-w-[420px] text-right text-base text-rose-200">
          {problem}
        </span>
      )}
    </span>
  );
}
