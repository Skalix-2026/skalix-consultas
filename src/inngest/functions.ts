import type { z } from "zod";
import { inngest, Ev } from "./client";
import { mask, sender } from "@/lib/whatsapp";
import { aplicarStatusMensagemReal } from "@/db/queries/status-mensagem";
import { definirStatusLote, renovarEnvioLote, buscarClinicaDoLote, buscarIdsParaEnvio, buscarAgendamentosPorIds } from "@/db/queries/lotes";
import { marcarAgendamentoEnviado, marcarMensagemEnviada, marcarMensagemFalhou, reservarMensagem } from "@/db/queries/mensagens";
import { rodarEnviarLote, type DepsLote, type StepLike } from "@/lib/envio/lote";
import { buscarConhecimento } from "@/db/queries/conhecimento";
import { classificarResposta } from "@/ai/harness/classificar-resposta";
import { rodarProcessarResposta, type DepsResposta } from "@/lib/resposta/processar";
import {
  localizarPaciente, buscarTokenRef, listarAgendamentosAbertos, registrarResposta, registrarSemPaciente, gravarDecisao,
  reservarRespostaAutomatica, carregarCorpoPendente, marcarFalhaClassificacao,
} from "@/db/queries/respostas";

/*
 * Logs: só ids técnicos (wamid, status, loteId), telefone mascarado e tamanho do texto.
 * Nunca o conteúdo da mensagem nem o payload inteiro do evento (dados de paciente).
 */

export function logMensagemRecebida(data: z.infer<typeof Ev.mensagemRecebida.data>) {
  return {
    wamid: data.wamid,
    de: mask(data.from),
    tamanho: data.texto?.length ?? 0,
    temBotao: data.botao !== undefined,
  };
}

export function logStatusAtualizado(data: z.infer<typeof Ev.statusAtualizado.data>) {
  return { wamid: data.wamid, status: data.status, erroCodigo: data.erroCodigo };
}

export function logEnviarLote(data: z.infer<typeof Ev.enviarLote.data>) {
  return { loteId: data.loteId };
}

/** Dependências reais do processamento da resposta (banco + IA + sender; FakeSender com WHATSAPP_FAKE=1). */
const depsResposta = (): DepsResposta => ({
  sender,
  agora: () => new Date(),
  localizarPaciente,
  buscarTokenRef,
  listarAgendamentosAbertos,
  registrarResposta,
  registrarSemPaciente,
  buscarConhecimento,
  classificar: (entrada) => classificarResposta(entrada),
  gravarDecisao,
  reservarRespostaAutomatica,
  carregarCorpoPendente,
  marcarMensagemEnviada,
  marcarMensagemFalhou,
});

/**
 * Resposta do paciente → status do agendamento (Haiku classifica; o código decide). Idempotente por wamid:
 * retry do Inngest ou reentrega da Meta não reclassifica nem reenvia (ver src/lib/resposta/processar.ts).
 */
export const processarResposta = inngest.createFunction(
  {
    id: "processar-resposta", retries: 3, triggers: [{ event: Ev.mensagemRecebida.name }],
    // IA fora do ar / saída inválida após todos os retries: resposta e agendamento vão para a fila humana
    onFailure: async ({ event }) => {
      const original = Ev.mensagemRecebida.data.safeParse((event.data as { event?: { data?: unknown } }).event?.data);
      if (!original.success) return;
      await marcarFalhaClassificacao(original.data.wamid);
      console.error("[inngest] classificação falhou; resposta enviada à fila humana", { wamid: original.data.wamid });
    },
  },
  async ({ event, step }) => {
    const data = Ev.mensagemRecebida.data.parse(event.data);
    console.log("[inngest] mensagem recebida", logMensagemRecebida(data));
    return rodarProcessarResposta({ run: (id, fn) => step.run(id, fn) as Promise<never> }, data, depsResposta());
  },
);

/** Atualiza status da mensagem (enviada/entregue/lida/falhou). */
export const atualizarStatusMensagem = inngest.createFunction(
  { id: "atualizar-status-mensagem", retries: 3, triggers: [{ event: Ev.statusAtualizado.name }] },
  async ({ event, step }) => {
    const data = Ev.statusAtualizado.data.parse(event.data);
    await step.run("log", async () => {
      console.log("[inngest] status", logStatusAtualizado(data));
    });
    const resultado = await step.run("aplicar", () => aplicarStatusMensagemReal(data));
    // wamid ainda não gravado (status chegou antes): falhar para o Inngest tentar de novo, em vez de perder o status
    if (resultado === "desconhecido") throw new Error("wamid desconhecido; nova tentativa");
    return { ok: true, resultado };
  },
);

/** Dependências reais do envio de lote (banco + sender; FakeSender quando WHATSAPP_FAKE=1). */
const depsLote = (): DepsLote => ({
  sender,
  agora: () => new Date(),
  carregarClinicaDoLote: buscarClinicaDoLote,
  listarIdsParaEnvio: buscarIdsParaEnvio,
  carregarAgendamentos: buscarAgendamentosPorIds,
  definirStatusLote,
  renovarEnvioLote,
  reservarMensagem,
  marcarMensagemEnviada,
  marcarMensagemFalhou,
  marcarAgendamentoEnviado,
});

/**
 * Envia as confirmações de um lote em blocos pequenos, com pausa entre eles e idempotência por
 * (agendamento_id, tipo) em `mensagens`: reexecutar (retry do Inngest ou novo disparo) nunca envia duas vezes.
 */
export const enviarLote = inngest.createFunction(
  {
    id: "enviar-lote", retries: 2, concurrency: [{ limit: 1 }], triggers: [{ event: Ev.enviarLote.name }],
    // falha definitiva: não deixa o lote preso em "enviando" (só ids no log; nada de dados de paciente)
    onFailure: async ({ event }) => {
      const original = Ev.enviarLote.data.safeParse((event.data as { event?: { data?: unknown } }).event?.data);
      if (!original.success) return;
      await definirStatusLote(original.data.loteId, "importado");
      console.error("[inngest] envio do lote falhou; lote devolvido a 'importado'", { loteId: original.data.loteId });
    },
  },
  async ({ event, step }) => {
    const data = Ev.enviarLote.data.parse(event.data);
    console.log("[inngest] enviar lote", logEnviarLote(data));
    const passos: StepLike = {
      run: (id, fn) => step.run(id, fn) as Promise<never>,
      sleep: (id, duracao) => step.sleep(id, duracao),
    };
    return rodarEnviarLote(passos, data, depsLote());
  },
);

export const functions = [processarResposta, atualizarStatusMensagem, enviarLote];
