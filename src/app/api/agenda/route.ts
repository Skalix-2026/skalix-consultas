import { NextResponse, type NextRequest } from "next/server";
import { buscarClinicaPadrao } from "@/db/queries/lotes";
import { listarAgendaDoDia } from "@/db/queries/agenda";
import { hojeNoFuso, limitesDoDia, montarAgenda } from "@/lib/agenda/dia";
import { QueryAgenda, RespostaAgenda } from "@/lib/schemas-agenda";

function erro(e: "parametros_invalidos" | "clinica_nao_configurada" | "erro_interno", mensagem: string, status: number) {
  return NextResponse.json<RespostaAgenda>({ ok: false, erro: e, mensagem }, { status });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = QueryAgenda.safeParse({ data: sp.get("data") ?? undefined, profissional: sp.get("profissional") ?? undefined });
  if (!q.success) return erro("parametros_invalidos", "Data inválida. Use o formato aaaa-mm-dd.", 400);
  try {
    const clinica = await buscarClinicaPadrao();
    if (!clinica) return erro("clinica_nao_configurada", "Clínica não configurada.", 503);
    const data = q.data.data ?? hojeNoFuso(clinica.fuso);
    const { inicio, fim } = limitesDoDia(data, clinica.fuso);
    const linhas = await listarAgendaDoDia(clinica.id, inicio, fim);
    return NextResponse.json(RespostaAgenda.parse(montarAgenda(linhas, { data, fuso: clinica.fuso, profissional: q.data.profissional })));
  } catch (e) {
    console.error("[agenda] falha ao listar", (e as Error).name);
    return erro("erro_interno", "Não foi possível carregar a agenda.", 500);
  }
}
