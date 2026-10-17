import { CabecalhoPainel } from "@/components/cabecalho-painel";
import { Conversas } from "./conversas";

export const metadata = { title: "Conversas · Skalix Consultas" };

export default function PaginaConversas() {
  return (
    <>
      <CabecalhoPainel atual="conversas" />
      <main className="mx-auto max-w-6xl p-6">
        <h1 className="text-2xl font-semibold">Conversas</h1>
        <p className="mt-1 text-sm text-gray-600">Acompanhe as respostas dos pacientes e resolva o que precisa de atenção.</p>
        <Conversas />
      </main>
    </>
  );
}
