import type { z } from "zod";
import { inngest, Ev } from "./client";
import { mask, sender } from "@/lib/whatsapp";
import { aplicarStatusMensagemReal } from "@/db/queries/status-mensagem";
import { definirStatusLote, buscarClinicaDoLote, buscarIdsParaEnvio, buscarAgendamentosPorIds } from "@/db/queries/lotes";
import { marcarAgendamentoEnviado, marcarMensagemEnviada, marcarMensagemFalhou, reservarMensagem } from "@/db/queries/mensagens";
import { rodarEnviarLote, type DepsLote, type StepLike } from "@/lib/envio/lote";

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

/** Fase 0: só registra. Fase 2: chama o harness de classificação e atualiza o agendamento. */
export const processarMensagemRecebida = inngest.createFunction(
  { id: "processar-mensagem-recebida", retries: 3, triggers: [{ event: Ev.mensagemRecebida.name }] },
  async ({ event, step }) => {
    const data = Ev.mensagemRecebida.data.parse(event.data);
    await step.run("log", async () => {
      console.log("[inngest] mensagem recebida", logMensagemRecebida(data));
    });
    // TODO Fase 2: localizar paciente/agendamento → classificarResposta() → atualizar status ou fila humana
    return { ok: true };
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

export const functions = [processarMensagemRecebida, atualizarStatusMensagem, enviarLote];
