import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Skalix Consultas",
  description: "Confirmação de consultas médicas por WhatsApp",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
