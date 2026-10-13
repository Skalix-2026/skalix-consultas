import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { mascararNumerosNoTexto } from "@/lib/whatsapp";
import { mensagens } from "@/db/schema";

export type StatusMensagem = "pendente" | "enviada" | "entregue" | "lida" | "falhou";
export type StatusMeta = "sent" | "delivered" | "read" | "failed";
export type DadosStatus = { wamid: string; status: StatusMeta; erroCodigo?: number; erroMensagem?: string };

const DESTINO: Record<StatusMeta, StatusMensagem> = {
  sent: "enviada", delivered: "entregue", read: "lida", failed: "falhou",
};
const POSICAO: Record<"pendente" | "enviada" | "entregue" | "lida", number> = {
  pendente: 0, enviada: 1, entregue: 2, lida: 3,
};

/**
 * Decide o próximo status sem regredir (a Meta pode entregar eventos fora de ordem).
 * Devolve null quando o evento deve ser ignorado.
 * - sent/delivered/read só avançam (read nunca volta a delivered; eventos repetidos não mudam nada);
 * - failed só vale enquanto a mensagem não foi entregue/lida;
 * - "falhou" é terminal: um sent/delivered atrasado não a ressuscita.
 */
export function proximoStatus(atual: StatusMensagem, evento: StatusMeta): StatusMensagem | null {
  const novo = DESTINO[evento];
  if (atual === "falhou") return null;
  if (novo === "falhou") return atual === "entregue" || atual === "lida" ? null : "falhou";
  return POSICAO[novo] > POSICAO[atual] ? novo : null;
}

export type ResultadoStatus = "atualizado" | "ignorado" | "desconhecido";

/**
 * UPDATE em `mensagens` por wamid. Wamid desconhecido → "desconhecido" (log, sem erro).
 * O UPDATE só acontece se o status ainda for o lido (otimista): duas entregas simultâneas não regridem.
 */
export async function aplicarStatusMensagem(db: Db, data: DadosStatus): Promise<ResultadoStatus> {
  const [atual] = await db
    .select({ id: mensagens.id, status: mensagens.status })
    .from(mensagens).where(eq(mensagens.wamid, data.wamid)).limit(1);
  if (!atual) {
    console.warn("[status] wamid desconhecido, ignorado", { wamid: data.wamid, status: data.status });
    return "desconhecido";
  }
  const novo = proximoStatus(atual.status, data.status);
  if (!novo) return "ignorado";

  const rows = await db.update(mensagens)
    .set({
      status: novo,
      atualizadaEm: new Date(),
      ...(novo === "falhou"
        ? { erroCodigo: data.erroCodigo ?? null, erroMensagem: mascararNumerosNoTexto(data.erroMensagem ?? "").slice(0, 500) || null }
        : {}),
    })
    .where(and(eq(mensagens.id, atual.id), eq(mensagens.status, atual.status)))
    .returning({ id: mensagens.id });
  return rows.length > 0 ? "atualizado" : "ignorado";
}

/** Atalho com o banco real (import tardio). */
export async function aplicarStatusMensagemReal(data: DadosStatus): Promise<ResultadoStatus> {
  const { db } = await import("@/db");
  return aplicarStatusMensagem(db, data);
}
