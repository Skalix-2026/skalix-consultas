import { CabecalhoPainel } from "@/components/cabecalho-painel";
import { Importador } from "./importador";

export const metadata = { title: "Importar agenda · Skalix Consultas" };

export default function PaginaImportar() {
  return (
    <>
      <CabecalhoPainel atual="importar" />
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-2xl font-semibold">Importar agenda</h1>
        <p className="mt-1 text-sm text-gray-600">
          Envie a agenda do dia em Excel, CSV ou PDF. Nada é enviado aos pacientes nesta etapa.
        </p>
        <Importador />
      </main>
    </>
  );
}
