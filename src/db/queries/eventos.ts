import { db } from "@/db";
import { eventosWebhook } from "@/db/schema";

export async function salvarEventoWebhook(payload: unknown) {
  const [row] = await db.insert(eventosWebhook).values({ payload }).returning({ id: eventosWebhook.id });
  return row.id;
}
