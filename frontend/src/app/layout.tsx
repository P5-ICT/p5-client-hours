import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Public_Sans } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/lib/auth";
import { StoreProvider } from "@/lib/store";
import "./globals.css";

const publicSans = Public_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-public-sans" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: "P5 Client Hours",
  description:
    "Pillar 5 Group client hours tracker: staff log time per project, managers approve, the client sees the approved hours used in each cycle.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${publicSans.variable} ${plexMono.variable}`}>
      <body>
        <AuthProvider>
          <StoreProvider>
            <AppShell>{children}</AppShell>
          </StoreProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
