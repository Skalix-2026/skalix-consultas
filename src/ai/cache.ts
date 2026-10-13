/**
 * Cache OBRIGATÓRIO dos harnesses de importação (mapear-colunas, extrair-agenda-pdf), chaveado pelo sha256 do arquivo.
 * Implementação fica com o chamador (ex.: `lotes.mapeamento_colunas`). Regras:
 * - `get` retornou valor → o harness devolve sem chamar o modelo (nunca reprocessar o mesmo arquivo);
 * - `get` lançou erro → o erro sobe e o modelo NÃO é chamado (não pagar às cegas);
 * - `set` só é chamado em sucesso; falha no `set` vira aviso no log e o resultado (já pago) é devolvido mesmo assim.
 */
export type CacheIA<T> = {
  get(hash: string): Promise<T | null>;
  set(hash: string, valor: T): Promise<void>;
};

/** sha256 em hex. */
export const REGEX_SHA256 = /^[0-9a-f]{64}$/i;

/** Grava no cache sem derrubar o harness (a chamada já foi paga; quem chama ainda recebe o resultado). */
export async function gravarNoCache<T>(cache: CacheIA<T>, hash: string, valor: T, tarefa: string): Promise<void> {
  try {
    await cache.set(hash, valor);
  } catch (err) {
    console.warn(`[ia] ${tarefa}: falha ao gravar cache (${(err as Error).name}); o resultado foi devolvido, grave-o de novo`);
  }
}
