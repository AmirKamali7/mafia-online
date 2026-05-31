import type { Metadata } from "next";
        import "@/app/globals.css";

export const metadata: Metadata = {
  title: "مافیا آنلاین",
  description: "بازی مافیا آنلاین با دوستان",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fa" dir="rtl">
      <body className="min-h-screen bg-gray-950 text-white font-persian">
        {children}
      </body>
    </html>
  );
}
