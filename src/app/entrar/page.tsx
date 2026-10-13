import type { Metadata } from "next";
import { FormEntrar } from "./form-entrar";

export const metadata: Metadata = { title: "Entrar · Skalix Consultas" };

export default async function Entrar({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const de = typeof sp.de === "string" ? sp.de : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">Skalix Consultas</h1>
        <p className="mt-1 text-sm text-gray-600">Digite a senha do painel para continuar.</p>
        <FormEntrar de={de} />
      </div>
    </main>
  );
}
