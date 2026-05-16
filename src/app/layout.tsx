import type { Metadata } from "next";
import "./globals.css";
import { AccountProvider } from "@/lib/account-context";
import { ThemeProvider } from "@/lib/theme";
import { ShimmerStyle } from "@/components/shared/Skeleton";

export const metadata: Metadata = {
  title: "Amazon Ads",
  description: "Amazon Advertising Management Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" data-theme="dark">
      <body className="min-h-full" suppressHydrationWarning>
        <ThemeProvider>
          <AccountProvider>
            <ShimmerStyle />
            {children}
          </AccountProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
