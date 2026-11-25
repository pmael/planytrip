import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 text-center text-white">
      <h1 className="text-4xl font-normal sm:text-5xl">We couldn’t find that page</h1>
      <p className="text-xl text-white/65">The trip may have been removed, or the link is wrong.</p>
      <Link
        href="/"
        className="flex h-[61px] items-center rounded-full border border-white/25 bg-white/15 px-12 text-lg shadow-[0_0_18px_rgb(120_220_190/0.35)] backdrop-blur-md transition-colors hover:bg-white/25"
      >
        Back to the start
      </Link>
    </main>
  );
}
