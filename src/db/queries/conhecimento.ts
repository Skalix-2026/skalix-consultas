import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { conhecimento } from "@/db/schema";
import type { LinhaConhecimento } from "@/ai/rag/contexto-clinica";

/** Import tardio: evita abrir conexão em testes/ambientes sem DATABASE_URL. */
async function getDb() {
  const { db } = await import("@/db");
  return db;
}

/**
 * Conhecimento da clínica + globais (clinica_id NULL), só os tipos usados no prompt. Sem embeddings: uma query,
 * ordenada por criado_em. O corte (8 regras / 10 exemplos) é feito em `montarContexto`; o LIMIT aqui só protege
 * contra tabelas enormes.
 */
export async function buscarConhecimento(clinicaId: string): Promise<LinhaConhecimento[]> {
  const db = await getDb();
  return db
    .select({ tipo: conhecimento.tipo, conteudo: conhecimento.conteudo, criadoEm: conhecimento.criadoEm })
    .from(conhecimento)
    .where(and(
      or(eq(conhecimento.clinicaId, clinicaId), isNull(conhecimento.clinicaId)),
      inArray(conhecimento.tipo, ["regra", "faq", "exemplo_classificado"]),
    ))
    .orderBy(asc(conhecimento.criadoEm))
    .limit(200);
}
