import { z } from "zod";

/** Contratos JSON das rotas /api/lotes* (as rotas só podem exportar handlers, por isso ficam aqui). */

export const StatusLoteSchema = z.enum(["importado", "conferido", "enviando", "concluido"]);

export const LoteSchema = z.object({
  id: z.string(),
  arquivoNome: z.string(),
  totalLinhas: z.number(),
  linhasValidas: z.number(),
  status: StatusLoteSchema,
  criadoEm: z.string(),
  /** Agendamentos do lote por status (inserido, enviado, confirmado...). */
  contagens: z.record(z.string(), z.number()),
});
export type Lote = z.infer<typeof LoteSchema>;

export const RespostaListaLotes = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), lotes: z.array(LoteSchema) }),
  z.object({ ok: z.literal(false), erro: z.string(), mensagem: z.string() }),
]);
export type RespostaListaLotes = z.infer<typeof RespostaListaLotes>;

export const AgendamentoSchema = z.object({
  id: z.string(),
  /** Primeiro nome + inicial ("Maria S."). */
  nome: z.string(),
  /** Mascarado: "(11) 9****-1234". */
  telefone: z.string(),
  atendimento: z.string(),
  profissional: z.string().nullable(),
  dataHora: z.string(),
  status: z.string(),
  /** Status da mensagem de confirmação (pendente|enviada|entregue|lida|falhou) ou null se não houve envio. */
  mensagemStatus: z.string().nullable(),
  erroCodigo: z.number().nullable(),
  erroMensagem: z.string().nullable(),
});

export const RespostaDetalheLote = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), lote: LoteSchema, agendamentos: z.array(AgendamentoSchema) }),
  z.object({
    ok: z.literal(false),
    erro: z.enum(["id_invalido", "lote_nao_encontrado", "erro_interno"]),
    mensagem: z.string(),
  }),
]);
export type RespostaDetalheLote = z.infer<typeof RespostaDetalheLote>;

export type RespostaEnviarLote =
  | { ok: true; loteId: string; status: "enviando" }
  | {
      ok: false;
      erro: "id_invalido" | "entrada_invalida" | "lote_nao_encontrado" | "lote_em_envio" | "fila_indisponivel";
      mensagem: string;
    };
