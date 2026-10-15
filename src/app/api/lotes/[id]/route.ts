import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { listarAgendamentosDoLote, obterLote } from "@/db/queries/lotes";
import { abreviarNome, mascararTelefoneExibicao } from "@/lib/importacao/normalizar";
import { RespostaDetalheLote } from "@/lib/schemas-lotes";

const Id = z.uuid();

function erro(e: "id_invalido" | "lote_nao_encontrado" | "erro_interno", mensagem: string, status: number) {
  return NextResponse.json<RespostaDetalheLote>({ ok: false, erro: e, mensagem }, { status });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = Id.safeParse((await ctx.params).id);
  if (!id.success) return erro("id_invalido", "Identificador de lote inválido.", 400);
  try {
    const lote = await obterLote(id.data);
    if (!lote) return erro("lote_nao_encontrado", "Lote não encontrado.", 404);
    const ags = await listarAgendamentosDoLote(id.data);
    const body = RespostaDetalheLote.parse({
      ok: true,
      lote: {
        id: lote.id, arquivoNome: lote.arquivoNome, totalLinhas: lote.totalLinhas, linhasValidas: lote.linhasValidas,
        status: lote.status, criadoEm: lote.criadoEm.toISOString(), enviandoDesde: lote.enviandoDesde?.toISOString() ?? null, contagens: lote.contagens,
      },
      agendamentos: ags.map((a) => ({
        id: a.id,
        nome: abreviarNome(a.nome),
        telefone: mascararTelefoneExibicao(a.telefone),
        atendimento: a.atendimento,
        profissional: a.profissional,
        dataHora: a.dataHora.toISOString(),
        status: a.status,
        mensagemStatus: a.mensagemStatus,
        erroCodigo: a.erroCodigo,
        erroMensagem: a.erroMensagem,
      })),
    });
    return NextResponse.json(body);
  } catch (e) {
    console.error("[lotes] falha ao detalhar", { id: id.data, erro: (e as Error).name });
    return erro("erro_interno", "Não foi possível carregar o lote.", 500);
  }
}
