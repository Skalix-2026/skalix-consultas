import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buscarClinicaPadrao } from "@/db/queries/lotes";
import {
  agendamentoEmFoco, buscarAgendamentoBasico, buscarPacienteDaClinica, gravarAcaoHumana, liberarRespostaHumana,
  registrarMensagemTexto, reservarRespostaHumana, ultimaRespostaDoPacienteEm,
} from "@/db/queries/conversas";
import { executarAcao, type DepsAcoes } from "@/lib/conversas/acoes";
import { AcaoConversaSchema, RespostaAcao, STATUS_HTTP_ERRO, type ErroAcao } from "@/lib/schemas-conversas";
import { sender } from "@/lib/whatsapp";

const Id = z.uuid();

function erro(e: ErroAcao, mensagem: string) {
  return NextResponse.json<RespostaAcao>({ ok: false, erro: e, mensagem }, { status: STATUS_HTTP_ERRO[e] });
}

const deps: DepsAcoes = {
  sender,
  agora: () => new Date(),
  buscarClinica: async () => {
    const c = await buscarClinicaPadrao();
    return c ? { id: c.id, phoneNumberId: c.phoneNumberId, tokenRef: c.tokenRef } : null;
  },
  buscarPaciente: buscarPacienteDaClinica,
  buscarAgendamento: buscarAgendamentoBasico,
  agendamentoEmFoco,
  ultimaRespostaDoPacienteEm,
  gravarAcaoHumana,
  reservarRespostaHumana,
  liberarRespostaHumana,
  registrarMensagemTexto,
};

/**
 * Ações da recepção. `responder` envia 1 texto livre por clique, de forma síncrona, de propósito:
 * é uma ação humana, não um lote (ver docs/decisoes.md, 2026-10-16). O texto nunca é logado.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ pacienteId: string }> }) {
  const id = Id.safeParse((await ctx.params).pacienteId);
  if (!id.success) return erro("id_invalido", "Identificador de paciente inválido.");

  let json: unknown;
  try { json = await req.json(); } catch { return erro("entrada_invalida", "Corpo da requisição inválido."); }
  const entrada = AcaoConversaSchema.safeParse(json);
  if (!entrada.success) return erro("entrada_invalida", "Dados da ação inválidos.");

  // a chave também pode vir no header (a UI escolhe um dos dois)
  const chaveHeader = z.uuid().safeParse(req.headers.get("idempotency-key") ?? undefined);
  const dados = { ...entrada.data, chaveIdempotencia: entrada.data.chaveIdempotencia ?? (chaveHeader.success ? chaveHeader.data : undefined) };

  try {
    const r = await executarAcao(deps, id.data, dados);
    return NextResponse.json(RespostaAcao.parse(r), { status: r.ok ? 200 : STATUS_HTTP_ERRO[r.erro] });
  } catch (e) {
    console.error("[conversas] falha na ação", { id: id.data, acao: dados.acao, erro: (e as Error).name });
    return erro("erro_interno", "Não foi possível executar a ação.");
  }
}
