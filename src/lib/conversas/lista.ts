import { abreviarNome, mascararTelefoneExibicao } from "@/lib/importacao/normalizar";
import { mascararNumerosNoTexto } from "@/lib/whatsapp";
import type { ConversaResumo, EventoHistorico } from "@/lib/schemas-conversas";

type StatusAg = ConversaResumo["agendamento"] extends infer A ? (A extends { status: infer S } ? S : never) : never;

/** Linha crua vinda da query da lista (uma por paciente com conversa). */
export type LinhaConversa = {
  pacienteId: string; nome: string; telefone: string;
  ultimaTexto: string; ultimaDirecao: "enviada" | "recebida"; ultimaEm: Date;
  agId: string | null; agAtendimento: string | null; agDataHora: Date | null; agStatus: StatusAg | null;
  temExcecao: boolean;
};

export const TRECHO_MAX = 80;

export function trecho(texto: string): string {
  const limpo = mascararNumerosNoTexto(texto.replace(/\s+/g, " ").trim());
  return limpo.length <= TRECHO_MAX ? limpo : `${limpo.slice(0, TRECHO_MAX - 1)}…`;
}

/** Mascara, abrevia, ordena (exceções primeiro, depois última atividade desc) e limita. */
export function montarLista(linhas: LinhaConversa[], opcoes: { excecoesPrimeiro: boolean; limite: number }): ConversaResumo[] {
  const ordenadas = [...linhas].sort((a, b) => {
    if (opcoes.excecoesPrimeiro && a.temExcecao !== b.temExcecao) return a.temExcecao ? -1 : 1;
    return b.ultimaEm.getTime() - a.ultimaEm.getTime();
  });
  return ordenadas.slice(0, opcoes.limite).map((l) => ({
    pacienteId: l.pacienteId,
    nome: abreviarNome(l.nome),
    telefone: mascararTelefoneExibicao(l.telefone),
    ultimaMensagem: { trecho: trecho(l.ultimaTexto), direcao: l.ultimaDirecao, quando: l.ultimaEm.toISOString() },
    agendamento: l.agId && l.agAtendimento && l.agDataHora && l.agStatus
      ? { id: l.agId, atendimento: l.agAtendimento, dataHora: l.agDataHora.toISOString(), status: l.agStatus }
      : null,
    temExcecao: l.temExcecao,
  }));
}

export type MensagemHist = {
  id: string; agendamentoId: string; tipo: string; corpo: string | null; status: string; quando: Date;
};
export type RespostaHist = {
  id: string; agendamentoId: string | null; texto: string; intencao: EventoHistorico extends infer E ? (E extends { intencao: infer I } ? I : never) : never;
  confianca: string | null; motivo: string | null; origem: string; classificadaPor: string | null; precisaHumano: number; resolvidaEm: Date | null; quando: Date;
};

/**
 * Histórico unificado em ordem cronológica. Respostas "humano" com texto enviado ao paciente já aparecem como
 * mensagem enviada (tabela `mensagens`; `respostas.motivo = "acao:responder"`), então só confirmar/cancelar/resolver viram
 * evento da recepção.
 */
export function montarHistorico(mensagens: MensagemHist[], respostas: RespostaHist[]): EventoHistorico[] {
  const evs: { t: number; ev: EventoHistorico }[] = [];
  for (const m of mensagens) {
    evs.push({
      t: m.quando.getTime(),
      ev: {
        tipo: "mensagem_enviada", id: m.id, quando: m.quando.toISOString(), tipoMensagem: m.tipo,
        texto: mascararNumerosNoTexto(m.corpo ?? ""), status: m.status, agendamentoId: m.agendamentoId,
      },
    });
  }
  for (const r of respostas) {
    if (r.origem === "humano") {
      if (r.motivo === "acao:responder") continue; // já aparece como mensagem enviada
      evs.push({
        t: r.quando.getTime(),
        ev: { tipo: "acao_recepcao", id: r.id, quando: r.quando.toISOString(), texto: r.texto, intencao: r.intencao, agendamentoId: r.agendamentoId },
      });
    } else {
      evs.push({
        t: r.quando.getTime(),
        ev: {
          tipo: "resposta_paciente", id: r.id, quando: r.quando.toISOString(), texto: mascararNumerosNoTexto(r.texto),
          intencao: r.intencao, confianca: r.confianca === null ? null : Number(r.confianca),
          precisaHumano: r.precisaHumano === 1, resolvida: r.resolvidaEm !== null, agendamentoId: r.agendamentoId,
        },
      });
    }
  }
  return evs.sort((a, b) => a.t - b.t).map((e) => e.ev);
}
