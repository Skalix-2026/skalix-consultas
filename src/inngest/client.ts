import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "skalix-consultas" });

// Nomes de eventos do sistema (fonte única)
export type Eventos = {
  "whatsapp/mensagem.recebida": { data: { eventoId: string; from: string; wamid: string; texto?: string; botao?: string; timestamp: string; phoneNumberId: string } };
  "whatsapp/status.atualizado": { data: { wamid: string; status: "sent" | "delivered" | "read" | "failed"; erroCodigo?: number; erroMensagem?: string } };
  "lote/enviar": { data: { loteId: string; data: string } };
};
