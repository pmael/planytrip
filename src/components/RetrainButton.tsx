"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";

/** "Réentraîner": trains the price model on the prices seen so far, then shows what it did. It takes a few seconds. */
export function RetrainButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [, startTransition] = useTransition();

  async function retrain() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/price-model/train", { method: "POST" });
      const body = (await response.json()) as { ok: boolean; error?: string; log?: string };
      setMessage(body.ok ? { ok: true, text: "Modèle entraîné." } : { ok: false, text: body.error ?? "L'entraînement a échoué" });
      if (body.ok) startTransition(() => router.refresh());
    } catch {
      setMessage({ ok: false, text: "L'application ne répond pas" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-4", className)}>
      <button
        type="button"
        onClick={retrain}
        disabled={busy}
        className="flex h-[54px] cursor-pointer items-center gap-2.5 rounded-full border border-white/25 bg-white/[0.14] px-6 text-xl text-white outline-none transition-[background-color,transform] hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-emerald-300/60 active:scale-[0.97] disabled:cursor-wait disabled:opacity-60 [&_svg]:size-5 [&_svg]:stroke-[1.6]"
      >
        <RefreshCw aria-hidden className={cn(busy && "animate-spin")} />
        {busy ? "Entraînement…" : "Réentraîner"}
      </button>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={cn("text-lg", message.ok ? "text-emerald-200" : "text-rose-200")}>
          {message.text}
        </p>
      )}
    </div>
  );
}
