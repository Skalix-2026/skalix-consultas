import { inngest } from "./client";

/** Fase 0: só registra. Fase 2: chama o harness de classificação e atualiza o agendamento. */
export const processarMensagemRecebida = inngest.createFunction(
  { id: "processar-mensagem-recebida", retries: 3 },
  { event: "whatsapp/mensagem.recebida" },
  async ({ event, step }) => {
    await step.run("log", async () => {
      console.log("[inngest] mensagem recebida", { from: event.data.from.slice(-4), texto: event.data.texto });
    });
    // TODO Fase 2: localizar paciente/agendamento → classificarResposta() → atualizar status ou fila humana
    return { ok: true };
  },
);

/** Atualiza status da mensagem (enviada/entregue/lida/falhou). */
export const atualizarStatusMensagem = inngest.createFunction(
  { id: "atualizar-status-mensagem", retries: 3 },
  { event: "whatsapp/status.atualizado" },
  async ({ event, step }) => {
    await step.run("log", async () => {
      console.log("[inngest] status", event.data);
    });
    // TODO Fase 1: UPDATE mensagens SET status=... WHERE wamid=...
    return { ok: true };
  },
);

/** Envia um lote de confirmações de uma data, com ritmo controlado e idempotência. */
export const enviarLote = inngest.createFunction(
  { id: "enviar-lote", concurrency: 1, retries: 2 },
  { event: "lote/enviar" },
  async ({ event, step }) => {
    // TODO Fase 1: buscar agendamentos do lote/data sem mensagem 'confirmacao' → sender.sendTemplate → gravar wamid
    await step.run("log", async () => console.log("[inngest] enviar lote", event.data));
    return { ok: true };
  },
);

export const functions = [processarMensagemRecebida, atualizarStatusMensagem, enviarLote];
