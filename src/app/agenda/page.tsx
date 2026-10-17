import { CabecalhoPainel } from "@/components/cabecalho-painel";
import { dataValida } from "@/lib/ui/agenda";
import { Agenda } from "./agenda";

export const metadata = { title: "Agenda · Skalix Consultas" };

type Param = string | string[] | undefined;
const primeiro = (p: Param) => (Array.isArray(p) ? p[0] : p);

export default async function PaginaAgenda({ searchParams }: { searchParams: Promise<{ data?: Param; profissional?: Param }> }) {
  const sp = await searchParams;
  const data = primeiro(sp.data);
  const profissional = primeiro(sp.profissional)?.trim();
  return (
    <>
      <CabecalhoPainel atual="agenda" />
      <main className="mx-auto max-w-6xl p-6">
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <p className="mt-1 text-sm text-gray-600">Veja as consultas do dia e como cada paciente respondeu.</p>
        <Agenda data={data && dataValida(data) ? data : undefined} profissional={profissional || undefined} />
      </main>
    </>
  );
}
