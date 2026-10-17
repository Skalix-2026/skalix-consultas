import { NextResponse, type NextRequest } from "next/server";
import { buscarClinicaPadrao } from "@/db/queries/lotes";
import { listarConversas } from "@/db/queries/conversas";
import { montarLista } from "@/lib/conversas/lista";
import { QueryListaConversas, RespostaListaConversas } from "@/lib/schemas-conversas";

function erro(e: "parametros_invalidos" | "clinica_nao_configurada" | "erro_interno", mensagem: string, status: number) {
  return NextResponse.json<RespostaListaConversas>({ ok: false, erro: e, mensagem }, { status });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = QueryListaConversas.safeParse({
    excecoesPrimeiro: sp.get("excecoesPrimeiro") ?? sp.get("exceçõesPrimeiro") ?? undefined,
    limite: sp.get("limite") ?? undefined,
  });
  if (!q.success) return erro("parametros_invalidos", "Parâmetros inválidos.", 400);
  try {
    const clinica = await buscarClinicaPadrao();
    if (!clinica) return erro("clinica_nao_configurada", "Clínica não configurada.", 503);
    const linhas = await listarConversas(clinica.id, q.data);
    return NextResponse.json(RespostaListaConversas.parse({ ok: true, conversas: montarLista(linhas, q.data) }));
  } catch (e) {
    console.error("[conversas] falha ao listar", (e as Error).name);
    return erro("erro_interno", "Não foi possível listar as conversas.", 500);
  }
}
