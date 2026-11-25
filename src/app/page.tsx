import { Logo } from "@/components/Logo";
import { StartButton } from "@/components/StartButton";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 px-6 text-center">
      <Logo variant="iconStacked" width={320} priority className="animate-[fade-up_0.6s_ease-out_both]" />
      <h1 className="text-4xl font-normal tracking-tight text-white sm:text-[3.4rem]">
        Plan your trip right now
      </h1>
      <StartButton />
    </main>
  );
}
