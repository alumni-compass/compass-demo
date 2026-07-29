import type { Metadata, Viewport } from "next";

import "../index.css";

import Providers from "@/components/providers";
import SiteFooter from "@/components/site-footer";
import SiteHeader from "@/components/site-header";
import { getToken } from "@/lib/auth-server";
import { RITAA } from "@/lib/site";

/**
 * Typography is Times New Roman throughout — see the font stack in index.css.
 *
 * It is a system font, so there is deliberately no next/font import here and no
 * webfont request at all: nothing to download, nothing to lay out twice, and no
 * flash of unstyled text.
 */

/**
 * Next supplies `width=device-width, initial-scale=1` by default, so this export
 * exists for the theme colour — it tints the browser chrome on Android and iOS,
 * which is the difference between the portal looking installed and looking like a
 * web page in a frame.
 */
export const viewport: Viewport = {
  themeColor: "#14192b",
};

export const metadata: Metadata = {
  title: {
    default: `${RITAA.shortName} — ${RITAA.name}`,
    template: `%s · ${RITAA.shortName}`,
  },
  description: RITAA.vision,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const token = await getToken();
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <Providers initialToken={token}>
          <a
            href="#main"
            className="font-mono sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:bg-ink focus:px-4 focus:py-2 focus:text-[0.75rem] focus:uppercase focus:tracking-[0.12em] focus:text-bone"
          >
            Skip to content
          </a>
          <div className="flex min-h-svh flex-col">
            <SiteHeader />
            <main id="main" className="flex-1">
              {children}
            </main>
            <SiteFooter />
          </div>
        </Providers>
      </body>
    </html>
  );
}
