import { z } from "zod";

/**
 * Contrato da importação de agendas (compartilhado entre parser, harnesses de IA e rota).
 * Padrão Aurian: nome, telefone, atendimento, profissional, data, hora.
 */

/** Campos canônicos que procuramos em qualquer arquivo de agenda. */
export const CAMPOS = [
  "nome", "telefone", "atendimento", "profissional", "data", "hora",
  "data_hora",      // quando data e hora vêm na mesma coluna
  "tipo",           // exame | consulta | procedimento (opcional)
  "chave_externa",  // id do agendamento no sistema da clínica (opcional)
] as const;
export const Campo = z.enum(CAMPOS);
export type Campo = z.infer<typeof Campo>;

export const FORMATOS_DATA = ["dd/MM/yyyy", "yyyy-MM-dd", "MM/dd/yyyy", "dd-MM-yyyy", "serial_excel"] as const;

/** Como as colunas do arquivo se ligam aos campos canônicos. Gravado em `lotes.mapeamento_colunas`. */
export const Mapeamento = z.object({
  colunas: z.partialRecord(Campo, z.string()),       // campo canônico → nome exato do cabeçalho no arquivo
  formatoData: z.enum(FORMATOS_DATA).nullable(),
  origem: z.enum(["heuristica", "haiku", "sonnet_pdf"]),
  arquivoHash: z.string(),                           // sha256 do arquivo: chave do cache, nunca reprocessar
  confianca: z.number().min(0).max(1).nullable().optional(), // só quando a IA mapeou; < 0.85 → confirmar na triagem
  /** true quando nenhuma data do arquivo desambigua dia/mês (todos ≤ 12): assumido dd/MM, a triagem deve avisar. */
  formatoDataAmbiguo: z.boolean().optional(),
});
export type Mapeamento = z.infer<typeof Mapeamento>;

/** Uma linha de agenda já normalizada, pronta para virar paciente + agendamento. */
export const LinhaAgenda = z.object({
  nome: z.string().min(2),
  telefone: z.string().regex(/^55\d{10,11}$/),       // E.164 sem "+"
  atendimento: z.string().min(1),
  profissional: z.string().nullable(),
  dataHora: z.string().datetime({ offset: true }),   // ISO com o offset do fuso da clínica naquela data (-03:00, -04:00...)
  tipo: z.string().nullable(),
  chaveExterna: z.string().nullable(),
});
export type LinhaAgenda = z.infer<typeof LinhaAgenda>;

/**
 * Linha rejeitada na importação.
 *
 * `bruto` contém SÓ as colunas mapeadas (chave = campo canônico, valor = texto original da célula).
 * Colunas não mapeadas (Observações, CID, CPF, Convênio...) nunca saem de `aplicarMapeamento`.
 * Mesmo assim traz nome e telefone completos, portanto:
 * - só pode ir à UI (ou a log) depois de passar por `paraExibicao` (telefone mascarado, nome = primeiro nome + inicial);
 * - nunca é persistido com colunas extras.
 */
export type LinhaInvalida = { linha: number; bruto: Partial<Record<Campo, string>>; motivo: string };

/** Resultado da leitura de um arquivo: linhas válidas + inválidas com motivo (para a tela de triagem). */
export type ResultadoImportacao = {
  mapeamento: Mapeamento;
  validas: { linha: number; dados: LinhaAgenda }[];
  /** `bruto` de cada inválida só vai à UI via `paraExibicao` (ver `LinhaInvalida`). */
  invalidas: LinhaInvalida[];
  /** Avisos gerais para a triagem (ex.: formato de data ambíguo). Não bloqueiam a importação. */
  avisos: string[];
};
