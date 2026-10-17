import { randomUUID } from "node:crypto";
import type { Sender } from "@/lib/whatsapp";
import { mascararNumerosNoTexto, mask } from "@/lib/whatsapp";
import { resolverToken } from "@/lib/envio/confirmacao";
import type { AcaoConversa, ErroAcao, RespostaAcao } from "@/lib/schemas-conversas";

/** Janela de atendimento da Meta: texto livre só dentro de 24 h da última mensagem do paciente. */
export const JANELA_MS = 24 * 60 * 60 * 1000;

type StatusAg = "inserido" | "enviado" | "respondido" | "confirmado" | "cancelado" | "sem_resposta" | "nao_sou_eu" | "excecao";

export type PacienteAcao = { id: string; clinicaId: string; telefone: string };
export type AgendamentoAcao = { id: string; pacienteId: string; clinicaId: string; status: StatusAg };
export type ClinicaAcao = { id: string; phoneNumberId: string; tokenRef: string | null };

export type GravacaoHumana = {
  wamid: string; pacienteId: string; agendamentoId: string | null; texto: string;
  /** Gravado em `respostas.motivo` como `acao:<acao>`. */
  acao: "confirmar" | "cancelar" | "resolver";
  intencao: "confirmou" | "cancelou" | null;
  /** Novo status do agendamento (null = não altera). */
  novoStatus: StatusAg | null;
  /** Marca as respostas pendentes do agendamento como resolvidas. */
  resolverPendentes: boolean;
};

export interface DepsAcoes {
  sender: Sender;
  env?: Record<string, string | undefined>;
  agora: () => Date;
  buscarClinica(): Promise<ClinicaAcao | null>;
  buscarPaciente(pacienteId: string): Promise<PacienteAcao | null>;
  buscarAgendamento(agendamentoId: string): Promise<AgendamentoAcao | null>;
  /** Agendamento em foco do paciente (aberto mais próximo, senão o último). */
  agendamentoEmFoco(pacienteId: string): Promise<{ id: string } | null>;
  /** Quando o paciente (origem "paciente") escreveu pela última vez. */
  ultimaRespostaDoPacienteEm(pacienteId: string): Promise<Date | null>;
  /**
   * Transação: INSERT em `respostas` (origem humano) ON CONFLICT (wamid) DO NOTHING; se inseriu, aplica
   * o novo status e resolve as pendentes. Retorna false se o wamid já existia (ação repetida).
   */
  gravarAcaoHumana(d: GravacaoHumana): Promise<boolean>;
  /** Reserva (claim) em `respostas` para o envio; false se a chave já foi usada. */
  reservarRespostaHumana(d: { wamid: string; pacienteId: string; agendamentoId: string; texto: string }): Promise<boolean>;
  liberarRespostaHumana(wamid: string): Promise<void>;
  registrarMensagemTexto(d: {
    agendamentoId: string; corpo: string; wamid: string | null; status: "enviada" | "falhou";
    erroCodigo: number | null; erroMensagem: string | null;
  }): Promise<void>;
}

const erro = (e: ErroAcao, mensagem: string): RespostaAcao => ({ ok: false, erro: e, mensagem });

const TEXTO_ACAO = {
  confirmar: "Confirmado pela recepção",
  cancelar: "Cancelado pela recepção",
  resolver: "Marcado como resolvido pela recepção",
} as const;

/**
 * Ações humanas da tela Conversas. Toda ação grava em `respostas` com origem "humano".
 * Idempotência: wamid sintético `humano.<chaveIdempotencia>`; a mesma chave devolve `duplicada: true`.
 * Nunca loga o texto da mensagem.
 */
export async function executarAcao(deps: DepsAcoes, pacienteId: string, entrada: AcaoConversa): Promise<RespostaAcao> {
  const clinica = await deps.buscarClinica();
  if (!clinica) return erro("clinica_nao_configurada", "Clínica não configurada.");

  const paciente = await deps.buscarPaciente(pacienteId);
  if (!paciente || paciente.clinicaId !== clinica.id) return erro("paciente_nao_encontrado", "Paciente não encontrado.");

  let agendamento: AgendamentoAcao | null = null;
  const agId = entrada.agendamentoId;
  if (agId) {
    agendamento = await deps.buscarAgendamento(agId);
    if (!agendamento) return erro("agendamento_nao_encontrado", "Agendamento não encontrado.");
    if (agendamento.pacienteId !== paciente.id || agendamento.clinicaId !== clinica.id) {
      return erro("agendamento_de_outro_paciente", "Agendamento não pertence a este paciente.");
    }
  }

  const wamid = `humano.${entrada.chaveIdempotencia ?? randomUUID()}`;

  if (entrada.acao !== "responder") {
    const ag = agendamento!;
    const novoStatus: StatusAg | null =
      entrada.acao === "confirmar" ? "confirmado"
      : entrada.acao === "cancelar" ? "cancelado"
      : ag.status === "excecao" ? "enviado" : null; // resolver: só sai de excecao
    const gravou = await deps.gravarAcaoHumana({
      wamid, pacienteId: paciente.id, agendamentoId: ag.id, texto: TEXTO_ACAO[entrada.acao], acao: entrada.acao,
      intencao: entrada.acao === "confirmar" ? "confirmou" : entrada.acao === "cancelar" ? "cancelou" : null,
      novoStatus, resolverPendentes: true,
    });
    return { ok: true, acao: entrada.acao, duplicada: !gravou, statusAgendamento: novoStatus ?? ag.status };
  }

  // ---- responder: texto livre, 1 mensagem por clique ----
  if (!agendamento) {
    const foco = await deps.agendamentoEmFoco(paciente.id);
    if (!foco) return erro("sem_agendamento", "Paciente sem agendamento para vincular a mensagem.");
    agendamento = await deps.buscarAgendamento(foco.id);
    if (!agendamento) return erro("sem_agendamento", "Paciente sem agendamento para vincular a mensagem.");
  }

  const ultima = await deps.ultimaRespostaDoPacienteEm(paciente.id);
  if (!ultima || deps.agora().getTime() - ultima.getTime() > JANELA_MS) {
    return erro("fora_da_janela", "Passaram mais de 24 h desde a última mensagem do paciente: o WhatsApp não permite texto livre.");
  }

  const env = deps.env ?? process.env;
  const token = env.WHATSAPP_FAKE === "1" ? "fake" : resolverToken(clinica.tokenRef, env);
  if (!token) return erro("envio_nao_configurado", "Token do WhatsApp não configurado.");

  const reservou = await deps.reservarRespostaHumana({ wamid, pacienteId: paciente.id, agendamentoId: agendamento.id, texto: entrada.texto });
  if (!reservou) return { ok: true, acao: "responder", duplicada: true, statusAgendamento: agendamento.status };

  let wamidMeta: string;
  try {
    ({ wamid: wamidMeta } = await deps.sender.sendText(
      { phoneNumberId: clinica.phoneNumberId, token, to: paciente.telefone }, entrada.texto));
  } catch (e) {
    const codigo = (e as { code?: unknown } | null)?.code;
    const msg = mascararNumerosNoTexto((e as Error)?.message ?? "erro desconhecido");
    console.error("[conversas] envio falhou", { agendamentoId: agendamento.id, para: mask(paciente.telefone), erroCodigo: typeof codigo === "number" ? codigo : null });
    try {
      await deps.registrarMensagemTexto({
        agendamentoId: agendamento.id, corpo: entrada.texto, wamid: null, status: "falhou",
        erroCodigo: typeof codigo === "number" ? codigo : null, erroMensagem: msg.slice(0, 500),
      });
      // libera a chave: o texto não foi enviado, então "tentar de novo" com a mesma chave é seguro
      await deps.liberarRespostaHumana(wamid);
    } catch (e2) {
      console.error("[conversas] não gravou a falha", { erro: (e2 as Error).name });
    }
    return erro("envio_falhou", "Não foi possível enviar a mensagem pelo WhatsApp.");
  }

  // Já foi enviada: falha ao gravar o histórico não vira erro (nunca reenviar); o wamid vai ao log para reconciliar.
  try {
    await deps.registrarMensagemTexto({
      agendamentoId: agendamento.id, corpo: entrada.texto, wamid: wamidMeta, status: "enviada", erroCodigo: null, erroMensagem: null,
    });
  } catch (e) {
    console.error("[conversas] enviada mas NÃO gravou a mensagem", { agendamentoId: agendamento.id, wamid: wamidMeta, erro: (e as Error).name });
  }
  return { ok: true, acao: "responder", duplicada: false, statusAgendamento: agendamento.status };
}
