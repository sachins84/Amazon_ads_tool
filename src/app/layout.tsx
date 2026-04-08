import type { Metadata } from "next";
import "./globals.css";
import { AccountProvider } from "@/lib/account-context";
import { ShimmerStyle } from "@/components/shared/Skeleton";

export const metadata: Metadata = {
  title: "Amazon Ads",
  description: "Amazon Advertising Management Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full" suppressHydrationWarning>
        <AccountProvider>
          <ShimmerStyle />
          {children}
        </AccountProvider>
      </body>
    </html>
  );
}
