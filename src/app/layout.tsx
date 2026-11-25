import type { Metadata } from "next";
import { Varela_Round } from "next/font/google";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import "./globals.css";

const varelaRound = Varela_Round({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: { default: "PlanyTrip", template: "%s · PlanyTrip" },
  description: "Plan a group trip where everyone fits the budget.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${varelaRound.variable} dark h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <AnimatedBackground />
        {children}
      </body>
    </html>
  );
}
