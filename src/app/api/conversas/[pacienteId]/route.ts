import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buscarClinicaPadrao } from "@/db/queries/lotes";
import {
  buscarPacienteDaClinica, listarAgendamentosDoPaciente, listarMensagensDoPaciente, listarRespostasDoPaciente,
} from "@/db/queries/conversas";
import { JANELA_MS } from "@/lib/conversas/acoes";
import { montarHistorico } from "@/lib/conversas/lista";
import { abreviarNome, mascararTelefoneExibicao } from "@/lib/importacao/normalizar";
import { RespostaHistorico } from "@/lib/schemas-conversas";

const Id = z.uuid();

type Erro = Extract<RespostaHistorico, { ok: false }>["erro"];
function erro(e: Erro, mensagem: string, status: number) {
  return NextResponse.json<RespostaHistorico>({ ok: false, erro: e, mensagem }, { status });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ pacienteId: string }> }) {
  const id = Id.safeParse((await ctx.params).pacienteId);
  if (!id.success) return erro("id_invalido", "Identificador de paciente inválido.", 400);
  try {
    const clinica = await buscarClinicaPadrao();
    if (!clinica) return erro("clinica_nao_configurada", "Clínica não configurada.", 503);
    const paciente = await buscarPacienteDaClinica(id.data);
    if (!paciente || paciente.clinicaId !== clinica.id) return erro("paciente_nao_encontrado", "Paciente não encontrado.", 404);

    const [msgs, resps, ags] = await Promise.all([
      listarMensagensDoPaciente(id.data), listarRespostasDoPaciente(id.data), listarAgendamentosDoPaciente(id.data),
    ]);
    const ultimaDoPaciente = resps.filter((r) => r.origem === "paciente").at(-1)?.quando;
    const body = RespostaHistorico.parse({
      ok: true,
      paciente: { id: paciente.id, nome: abreviarNome(paciente.nome), telefone: mascararTelefoneExibicao(paciente.telefone) },
      eventos: montarHistorico(msgs, resps),
      agendamentos: ags.map((a) => ({
        id: a.id, atendimento: a.atendimento, profissional: a.profissional, dataHora: a.dataHora.toISOString(), status: a.status,
      })),
      janelaAberta: !!ultimaDoPaciente && Date.now() - ultimaDoPaciente.getTime() <= JANELA_MS,
    });
    return NextResponse.json(body);
  } catch (e) {
    console.error("[conversas] falha ao carregar histórico", { id: id.data, erro: (e as Error).name });
    return erro("erro_interno", "Não foi possível carregar a conversa.", 500);
  }
}
