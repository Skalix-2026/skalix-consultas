import { CabecalhoPainel } from "@/components/cabecalho-painel";
import { CentralEnvios } from "./central-envios";

export const metadata = { title: "Central de Envios · Skalix Consultas" };

export default async function PaginaEnvios({ searchParams }: { searchParams: Promise<{ lote?: string | string[] }> }) {
  const { lote } = await searchParams;
  const loteId = Array.isArray(lote) ? lote[0] : lote;
  return (
    <>
      <CabecalhoPainel atual="envios" />
      <main className="mx-auto max-w-6xl p-6">
        <h1 className="text-2xl font-semibold">Central de Envios</h1>
        <p className="mt-1 text-sm text-gray-600">Escolha uma agenda importada e envie as confirmações por WhatsApp.</p>
        <CentralEnvios loteInicial={loteId} />
      </main>
    </>
  );
}
