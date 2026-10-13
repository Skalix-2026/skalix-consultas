/**
 * Cria a clínica inicial (idempotente): se já existir uma clínica com o mesmo phone_number_id, só a mostra.
 * Uso: npm run db:seed   (ou: npx tsx scripts/seed-clinica.ts)
 *
 * Lê do .env: WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_WABA_ID (obrigatórios) e, opcionais,
 * SEED_CLINICA_NOME e SEED_CLINICA_FUSO (padrão America/Sao_Paulo). O token NÃO é gravado:
 * `token_ref` guarda só o nome da variável (WHATSAPP_TOKEN).
 * Depois de rodar, opcionalmente defina CLINICA_ID=<id impresso> no .env.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";

async function main() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const wabaId = process.env.WHATSAPP_WABA_ID;
  if (!phoneNumberId || !wabaId) throw new Error("Defina WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_WABA_ID no .env");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não definida no .env");

  // import tardio: o dotenv precisa ter rodado antes de src/db ler DATABASE_URL
  const { db } = await import("../src/db");
  const { clinicas } = await import("../src/db/schema");

  const [existente] = await db.select({ id: clinicas.id, nome: clinicas.nome }).from(clinicas)
    .where(eq(clinicas.phoneNumberId, phoneNumberId)).limit(1);
  if (existente) {
    console.log(`Clínica já existe: ${existente.nome} (id ${existente.id}). Nada a fazer.`);
    process.exit(0);
  }

  const [nova] = await db.insert(clinicas).values({
    nome: process.env.SEED_CLINICA_NOME ?? "Clínica Skalix (piloto)",
    wabaId,
    phoneNumberId,
    tokenRef: "WHATSAPP_TOKEN",
    fuso: process.env.SEED_CLINICA_FUSO ?? "America/Sao_Paulo",
  }).returning({ id: clinicas.id, nome: clinicas.nome });
  console.log(`Clínica criada: ${nova.nome} (id ${nova.id}).`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Falha no seed:", (e as Error).message);
  process.exit(1);
});
