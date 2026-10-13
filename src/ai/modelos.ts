/**
 * IDs de modelo centralizados. Trocar modelo = mudar aqui + rodar `npm run eval` (regra do CLAUDE.md).
 * Todos aceitam `temperature: 0`.
 */

/** Classificação de respostas de pacientes (Haiku por padrão). */
export const MODELO_CLASSIFICACAO = "claude-haiku-4-5";

/** Fallback de mapeamento de colunas Excel/CSV quando a heurística falha. */
export const MODELO_MAPEAMENTO = "claude-haiku-4-5";

/** Extração de agenda em PDF (única tarefa que usa Sonnet; só na primeira leitura do arquivo). */
export const MODELO_EXTRACAO_PDF = "claude-sonnet-4-6";
