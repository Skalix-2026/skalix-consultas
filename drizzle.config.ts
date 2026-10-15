import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/**
 * O drizzle-kit usa prepared statements ao ler o esquema, e o pooler do Supabase em modo transação
 * (porta 6543, usada pelo app) embaralha as respostas -> "TypeError ... reading 'replace'" em checkValue.
 * Para migrações usamos o modo sessão do MESMO pooler (porta 5432). Para outra URL, defina DATABASE_URL_MIGRACAO.
 * Ver docs/decisoes.md (2026-10-14).
 */
function urlMigracao(): string {
  const explicita = process.env.DATABASE_URL_MIGRACAO;
  if (explicita) return explicita;
  const url = process.env.DATABASE_URL;
  if (!url) return ""; // db:generate não precisa de banco; push/studio falham com erro claro do próprio kit
  const u = new URL(url);
  if (u.hostname.endsWith(".pooler.supabase.com") && u.port === "6543") u.port = "5432";
  return u.toString();
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["public"], // nunca tocar nos schemas internos do Supabase (auth, storage, realtime, vault)
  dbCredentials: { url: urlMigracao() },
});
