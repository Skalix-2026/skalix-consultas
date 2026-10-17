import { z } from "zod";
import { StatusAgendamentoSchema } from "@/lib/schemas-conversas";
import { dataValida } from "@/lib/ui/agenda";

/** Contrato JSON de GET /api/agenda (as rotas só podem exportar handlers, por isso fica aqui). */

/** `?data=yyyy-MM-dd&profissional=Dra. Ana` (ambos opcionais; sem data = hoje no fuso da clínica). */
export const QueryAgenda = z.object({
  data: z.string().refine(dataValida, "data inválida").optional(),
  profissional: z.string().trim().max(120).optional().transform((v) => (v ? v : undefined)),
});
export type QueryAgenda = z.infer<typeof QueryAgenda>;

export const AgendamentoDoDiaSchema = z.object({
  id: z.string(),
  /** Hora local da clínica, "HH:mm". */
  horaLocal: z.string().regex(/^\d{2}:\d{2}$/),
  dataHora: z.string(),
  atendimento: z.string(),
  profissional: z.string().nullable(),
  status: StatusAgendamentoSchema,
  /** Primeiro nome + inicial ("Maria S."). */
  pacienteNome: z.string(),
  /** Mascarado: "(11) 9****-1234". */
  telefone: z.string(),
});
export type AgendamentoDoDia = z.infer<typeof AgendamentoDoDiaSchema>;

export const RespostaAgenda = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    data: z.string(),
    /** Distintos do dia inteiro (não do filtro), em ordem alfabética. */
    profissionais: z.array(z.string()),
    agendamentos: z.array(AgendamentoDoDiaSchema),
    /** Contagem do que está sendo mostrado (já com o filtro de profissional). */
    contagemPorStatus: z.record(z.string(), z.number()),
  }),
  z.object({ ok: z.literal(false), erro: z.enum(["parametros_invalidos", "clinica_nao_configurada", "erro_interno"]), mensagem: z.string() }),
]);
export type RespostaAgenda = z.infer<typeof RespostaAgenda>;
