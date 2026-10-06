import { inngest, Ev } from "./client";

/** Fase 0: só registra. Fase 2: chama o harness de classificação e atualiza o agendamento. */
export const processarMensagemRecebida = inngest.createFunction(
  { id: "processar-mensagem-recebida", retries: 3, triggers: [{ event: Ev.mensagemRecebida.name }] },
  async ({ event, step }) => {
    const data = Ev.mensagemRecebida.data.parse(event.data);
    await step.run("log", async () => {
      console.log("[inngest] mensagem recebida", { from: data.from.slice(-4), texto: data.texto });
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
      console.log("[inngest] status", data);
    });
    // TODO Fase 1: UPDATE mensagens SET status=... WHERE wamid=...
    return { ok: true };
  },
);

/** Envia um lote de confirmações de uma data, com ritmo controlado e idempotência. */
export const enviarLote = inngest.createFunction(
  { id: "enviar-lote", retries: 2, concurrency: [{ limit: 1 }], triggers: [{ event: Ev.enviarLote.name }] },
  async ({ event, step }) => {
    const data = Ev.enviarLote.data.parse(event.data);
    // TODO Fase 1: buscar agendamentos do lote/data sem mensagem 'confirmacao' → sender.sendTemplate → gravar wamid
    await step.run("log", async () => console.log("[inngest] enviar lote", data));
    return { ok: true };
  },
);

export const functions = [processarMensagemRecebida, atualizarStatusMensagem, enviarLote];
