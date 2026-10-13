import { z } from "zod";

/** Contrato JSON de POST /api/importar (a rota só pode exportar handlers, por isso fica aqui). */

export const ERROS_IMPORTAR = [
  "arquivo_ausente",        // 400
  "formato_invalido",       // 415
  "arquivo_grande",         // 413
  "sem_clinica",            // 409
  "arquivo_vazio",          // 422
  "arquivo_ilegivel",       // 422
  "pdf_sem_texto",          // 422
  "sem_cabecalho",          // 422
  "mapeamento_falhou",      // 422
  "mapeamento_incompleto",  // 422
  "extracao_falhou",        // 422
  "nenhuma_linha_valida",   // 422
  "erro_interno",           // 500
] as const;

export const LinhaInvalidaExibicao = z.object({
  linha: z.number(),
  motivo: z.string(),
  /** Só via `paraExibicao`: telefone mascarado, nome = primeiro nome + inicial. */
  bruto: z.record(z.string(), z.string()),
});

export const RespostaImportar = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    loteId: z.string(),
    /** true: o mesmo arquivo (hash) já tinha lote; nada foi reprocessado nem chamou IA. */
    reaproveitado: z.boolean(),
    totalLinhas: z.number(),
    /** Linhas válidas lidas (inclui as duplicadas). */
    validas: z.number(),
    /** Válidas que já existiam (mesmo paciente + atendimento + data/hora) e não foram inseridas de novo. */
    duplicadas: z.number(),
    invalidas: z.array(LinhaInvalidaExibicao),
    avisos: z.array(z.string()),
  }),
  z.object({
    ok: z.literal(false),
    erro: z.enum(ERROS_IMPORTAR),
    mensagem: z.string(),
    /** Presentes em `nenhuma_linha_valida`, para a triagem mostrar os motivos. */
    invalidas: z.array(LinhaInvalidaExibicao).optional(),
    avisos: z.array(z.string()).optional(),
  }),
]);
export type RespostaImportar = z.infer<typeof RespostaImportar>;
export type ErroImportar = (typeof ERROS_IMPORTAR)[number];

export const LIMITE_BYTES = 5 * 1024 * 1024;
