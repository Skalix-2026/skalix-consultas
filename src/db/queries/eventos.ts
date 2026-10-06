import { eq } from "drizzle-orm";
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
