import type { ReactNode } from "react";

export const metadata = { title: "unimate admin" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
