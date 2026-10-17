import { and, eq, lt, sql } from "drizzle-orm";
import { eventosWebhook } from "@/db/schema";

/** Import tardio: evita abrir conexão em testes/ambientes sem DATABASE_URL. */
async function getDb() {
  const { db } = await import("@/db");
  return db;
}

export async function salvarEventoWebhook(payload: unknown) {
  const db = await getDb();
  const [row] = await db.insert(eventosWebhook).values({ payload }).returning({ id: eventosWebhook.id });
  return row.id;
}

export async function marcarEventoProcessado(id: string, erro?: string) {
  const db = await getDb();
  await db.update(eventosWebhook).set({ processadoEm: new Date(), erro: erro ?? null }).where(eq(eventosWebhook.id, id));
}

/** Registra um erro SEM marcar como processado: o evento fica elegível a reprocesso futuro. */
export async function marcarEventoComErro(id: string, erro: string) {
  const db = await getDb();
  await db.update(eventosWebhook).set({ erro }).where(eq(eventosWebhook.id, id));
}

const PAYLOAD_ANONIMIZADO = JSON.stringify({ anonimizado: true });

/**
 * Retenção LGPD: UPDATE único (sem loop) que troca o payload bruto (texto e telefone do paciente) por
 * {"anonimizado":true} nos eventos recebidos antes de `corte`. Mantém id, recebido_em, processado_em e erro.
 * O filtro evita reescrever linhas já anonimizadas a cada execução do cron.
 */
export async function anonimizarEventosAnterioresA(corte: Date): Promise<number> {
  const db = await getDb();
  const rows = await db.update(eventosWebhook)
    .set({ payload: sql`${PAYLOAD_ANONIMIZADO}::jsonb` })
    .where(and(lt(eventosWebhook.recebidoEm, corte), sql`${eventosWebhook.payload} <> ${PAYLOAD_ANONIMIZADO}::jsonb`))
    .returning({ id: eventosWebhook.id });
  return rows.length;
}
