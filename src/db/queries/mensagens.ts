import { and, eq, sql } from "drizzle-orm";
import { agendamentos, mensagens } from "@/db/schema";

/** Import tardio: evita abrir conexão em testes/ambientes sem DATABASE_URL. */
async function getDb() {
  const { db } = await import("@/db");
  return db;
}

/**
 * Reserva a mensagem (agendamento_id, tipo) ANTES de enviar: INSERT ... ON CONFLICT DO NOTHING RETURNING.
 * Retorna o id se este chamador reservou; null se já existia (enviada, em andamento ou falhou) → não enviar.
 */
export async function reservarMensagem(agendamentoId: string, tipo: "confirmacao"): Promise<string | null> {
  const db = await getDb();
  const rows = await db.insert(mensagens)
    .values({ agendamentoId, tipo, status: "pendente" })
    // índice único parcial (tipo <> texto_livre): o ON CONFLICT precisa repetir o predicado
    .onConflictDoNothing({ target: [mensagens.agendamentoId, mensagens.tipo], where: sql`tipo <> 'texto_livre'` })
    .returning({ id: mensagens.id });
  return rows[0]?.id ?? null;
}

export async function marcarMensagemEnviada(id: string, d: { wamid: string; corpo: string }): Promise<void> {
  const db = await getDb();
  const agora = new Date();
  await db.update(mensagens)
    .set({ status: "enviada", wamid: d.wamid, corpo: d.corpo, enviadaEm: agora, atualizadaEm: agora, erroCodigo: null, erroMensagem: null })
    .where(eq(mensagens.id, id));
}

export async function marcarMensagemFalhou(
  id: string,
  d: { erroCodigo: number | null; erroMensagem: string },
): Promise<void> {
  const db = await getDb();
  await db.update(mensagens)
    .set({ status: "falhou", erroCodigo: d.erroCodigo, erroMensagem: d.erroMensagem.slice(0, 500), atualizadaEm: new Date() })
    .where(eq(mensagens.id, id));
}

/** Agendamento "inserido" → "enviado" (só sai de "inserido": nunca regride uma resposta já recebida). */
export async function marcarAgendamentoEnviado(agendamentoId: string): Promise<void> {
  const db = await getDb();
  await db.update(agendamentos).set({ status: "enviado", atualizadoEm: new Date() })
    .where(and(eq(agendamentos.id, agendamentoId), eq(agendamentos.status, "inserido")));
}
