/**
 * Cliente da WhatsApp Cloud API (Meta). Única porta de saída de mensagens.
 * Nunca chamar direto de rotas HTTP — sempre dentro de uma função Inngest.
 */
const GRAPH = "https://graph.facebook.com/v25.0";

export type Destinatario = { phoneNumberId: string; token: string; to: string };

export interface Sender {
  sendText(d: Destinatario, body: string): Promise<{ wamid: string }>;
  sendTemplate(d: Destinatario, name: string, params: string[], lang?: string): Promise<{ wamid: string }>;
}

async function post(d: Destinatario, payload: unknown) {
  const res = await fetch(`${GRAPH}/${d.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${d.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: d.to, ...(payload as object) }),
  });
  const json = (await res.json()) as { messages?: { id: string }[]; error?: { code: number; message: string } };
  if (!res.ok || json.error) {
    const e = json.error ?? { code: res.status, message: "erro desconhecido" };
    throw Object.assign(new Error(`WhatsApp ${e.code}: ${e.message}`), { code: e.code });
  }
  return { wamid: json.messages![0].id };
}

/** Sender real (produção). */
export const metaSender: Sender = {
  sendText: (d, body) => post(d, { type: "text", text: { body } }),
  sendTemplate: (d, name, params, lang = "pt_BR") =>
    post(d, {
      type: "template",
      template: {
        name,
        language: { code: lang },
        components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
      },
    }),
};

/**
 * Sender falso para desenvolvimento enquanto a verificação da Meta não sai (erro 130497).
 * Loga só telefone mascarado, nome do template e tamanhos — nunca o corpo nem os parâmetros
 * (que levam nome do paciente, data e médico).
 */
import { randomUUID } from "node:crypto";

export const fakeSender: Sender = {
  async sendText(d, body) {
    const wamid = `fake.${randomUUID()}`;
    console.log("[FAKE] texto", { para: mask(d.to), tamanho: body.length, wamid });
    return { wamid };
  },
  async sendTemplate(d, name, params) {
    const wamid = `fake.${randomUUID()}`;
    console.log("[FAKE] template", { template: name, para: mask(d.to), parametros: params.length, wamid });
    return { wamid };
  },
};

export const sender: Sender = process.env.WHATSAPP_FAKE === "1" ? fakeSender : metaSender;

/** Mascara números de telefone dentro de um texto livre (ex.: mensagem de erro da Meta). */
export function mascararNumerosNoTexto(texto: string) {
  return texto.replace(/\+?\d[\d\s().-]{9,}\d/g, (m) => mask(m));
}

/** (11) 9****-1234 — padrão de exibição em toda a UI e em logs. */
export function mask(e164: string) {
  const d = e164.replace(/\D/g, "");
  const local = d.startsWith("55") ? d.slice(2) : d;
  const ddd = local.slice(0, 2), num = local.slice(2);
  return `(${ddd}) ${num[0]}****-${num.slice(-4)}`;
}
