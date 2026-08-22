import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { zhCN } from "@clerk/localizations";
import "./globals.css";

import { AdminAccessProvider } from "@/components/moments/auth-controls";
import { MomentsToolbar } from "@/components/moments/moments-toolbar";
import { SiteSettingsProvider } from "@/components/moments/site-settings";
import { SystemThemeListener } from "@/components/moments/system-theme";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

const inter = Inter({ subsets: ["latin"], display: "swap" });
const systemThemeScript = `(() => {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  document.documentElement.classList.toggle('dark', query.matches);
})();`;

export const metadata: Metadata = {
  title: {
    default: "Moments",
    template: "%s · Moments",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-CN"
      className={`${inter.className} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: systemThemeScript }} />
      </head>
      <body className="min-h-full bg-background text-base leading-6 text-foreground">
        <ClerkProvider localization={zhCN}>
          <AdminAccessProvider>
            <SiteSettingsProvider>
              <SystemThemeListener />
              <TooltipProvider>
                {children}
                <MomentsToolbar />
              </TooltipProvider>
              <Toaster />
            </SiteSettingsProvider>
          </AdminAccessProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
