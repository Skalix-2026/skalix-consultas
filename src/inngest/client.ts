import { Inngest } from "inngest";
import { z } from "zod";

export const inngest = new Inngest({ id: "skalix-consultas" });

// Eventos do sistema: nome + schema dos dados (fonte única; validados com Zod ao entrar na função)
export const Ev = {
  mensagemRecebida: {
    name: "whatsapp/mensagem.recebida" as const,
    data: z.object({
      eventoId: z.string().optional(),
      from: z.string(),
      wamid: z.string(),
      texto: z.string().optional(),
      botao: z.string().optional(),
      timestamp: z.string(),
      phoneNumberId: z.string(),
    }),
  },
  statusAtualizado: {
    name: "whatsapp/status.atualizado" as const,
    data: z.object({
      wamid: z.string(),
      status: z.enum(["sent", "delivered", "read", "failed"]),
      erroCodigo: z.number().optional(),
      erroMensagem: z.string().optional(),
    }),
  },
  enviarLote: {
    name: "lote/enviar" as const,
    data: z.object({ loteId: z.string(), data: z.string() }),
  },
};
