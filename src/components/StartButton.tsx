"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Trip } from "@/core/types";
import { tripPath } from "@/lib/trip";
import { buttonVariants } from "./ui/button";
import { cn } from "@/lib/utils";

/** Creates a trip, then opens the first step of the wizard. */
export function StartButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "starting" | "failed">("idle");

  async function start() {
    setState("starting");
    try {
      const response = await fetch("/api/trips", { method: "POST" });
      if (!response.ok) throw new Error(`POST /api/trips answered ${response.status}`);
      const trip: Trip = await response.json();
      router.push(tripPath(trip.id, "/setup/guests"));
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        type="button"
        onClick={start}
        disabled={state === "starting"}
        className={cn(
          buttonVariants({ size: "lg" }),
          "h-[61px] cursor-pointer gap-3 rounded-full border border-white/25 bg-white/15 px-16 text-lg font-normal text-white shadow-[0_0_18px_rgb(120_220_190/0.35)] backdrop-blur-md hover:bg-white/25 disabled:opacity-80",
        )}
      >
        {state === "starting" && <LoaderCircle aria-hidden className="size-5 animate-spin" />}
        {state === "starting" ? "Starting" : "Start"}
      </button>
      {state === "failed" && (
        <p role="alert" className="animate-[fade-up_0.4s_ease-out_both] text-base text-rose-200">
          Something went wrong, please try again.
        </p>
      )}
    </div>
  );
}
