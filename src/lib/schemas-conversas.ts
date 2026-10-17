import { z } from "zod";

/** Contratos JSON das rotas /api/conversas* (as rotas só podem exportar handlers, por isso ficam aqui). */

export const IntencaoSchema = z.enum(["confirmou", "cancelou", "quer_remarcar", "duvida", "nao_sou_eu", "fora_de_escopo"]);
export const StatusAgendamentoSchema = z.enum([
  "inserido", "enviado", "respondido", "confirmado", "cancelado", "sem_resposta", "nao_sou_eu", "excecao",
]);

// ---- GET /api/conversas ---------------------------------------------------

/** Query string: `?excecoesPrimeiro=1&limite=50` (a grafia `exceçõesPrimeiro` também é aceita). */
export const QueryListaConversas = z.object({
  excecoesPrimeiro: z.enum(["1", "0", "true", "false"]).optional().transform((v) => v === "1" || v === "true"),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

export const AgendamentoFocoSchema = z.object({
  id: z.string(),
  atendimento: z.string(),
  dataHora: z.string(),
  status: StatusAgendamentoSchema,
});

export const ConversaResumoSchema = z.object({
  pacienteId: z.string(),
  /** Primeiro nome + inicial ("Maria S."). */
  nome: z.string(),
  /** Mascarado: "(11) 9****-1234". */
  telefone: z.string(),
  ultimaMensagem: z.object({
    /** Trecho de até 80 caracteres. */
    trecho: z.string(),
    direcao: z.enum(["enviada", "recebida"]),
    quando: z.string(),
  }),
  agendamento: AgendamentoFocoSchema.nullable(),
  /** Agendamento em `excecao` ou resposta que precisa de humano e ainda não foi resolvida. */
  temExcecao: z.boolean(),
});
export type ConversaResumo = z.infer<typeof ConversaResumoSchema>;

export const RespostaListaConversas = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), conversas: z.array(ConversaResumoSchema) }),
  z.object({ ok: z.literal(false), erro: z.enum(["parametros_invalidos", "clinica_nao_configurada", "erro_interno"]), mensagem: z.string() }),
]);
export type RespostaListaConversas = z.infer<typeof RespostaListaConversas>;

// ---- GET /api/conversas/[pacienteId] ---------------------------------------

export const EventoHistoricoSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("mensagem_enviada"),
    id: z.string(),
    quando: z.string(),
    /** confirmacao | lembrete_vespera | cobranca_resposta | texto_livre */
    tipoMensagem: z.string(),
    texto: z.string(),
    /** pendente | enviada | entregue | lida | falhou */
    status: z.string(),
    agendamentoId: z.string(),
  }),
  z.object({
    tipo: z.literal("resposta_paciente"),
    id: z.string(),
    quando: z.string(),
    texto: z.string(),
    intencao: IntencaoSchema.nullable(),
    confianca: z.number().nullable(),
    precisaHumano: z.boolean(),
    resolvida: z.boolean(),
    agendamentoId: z.string().nullable(),
  }),
  z.object({
    /** Ação da recepção (confirmar, cancelar, resolver). O texto responder aparece como mensagem_enviada. */
    tipo: z.literal("acao_recepcao"),
    id: z.string(),
    quando: z.string(),
    texto: z.string(),
    intencao: IntencaoSchema.nullable(),
    agendamentoId: z.string().nullable(),
  }),
]);
export type EventoHistorico = z.infer<typeof EventoHistoricoSchema>;

export const AgendamentoPacienteSchema = z.object({
  id: z.string(),
  atendimento: z.string(),
  profissional: z.string().nullable(),
  dataHora: z.string(),
  status: StatusAgendamentoSchema,
});

export const RespostaHistorico = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    paciente: z.object({ id: z.string(), nome: z.string(), telefone: z.string() }),
    /** Ordem cronológica crescente. */
    eventos: z.array(EventoHistoricoSchema),
    agendamentos: z.array(AgendamentoPacienteSchema),
    /** true se há resposta do paciente nas últimas 24 h (a UI pode avisar antes de tentar "responder"). */
    janelaAberta: z.boolean(),
  }),
  z.object({
    ok: z.literal(false),
    erro: z.enum(["id_invalido", "clinica_nao_configurada", "paciente_nao_encontrado", "erro_interno"]),
    mensagem: z.string(),
  }),
]);
export type RespostaHistorico = z.infer<typeof RespostaHistorico>;

// ---- POST /api/conversas/[pacienteId]/acao ---------------------------------

const ChaveIdempotencia = z.uuid().optional();

export const AcaoConversaSchema = z.discriminatedUnion("acao", [
  z.object({
    acao: z.enum(["confirmar", "cancelar", "resolver"]),
    agendamentoId: z.uuid(),
    /** UUID gerado pela UI por clique; repetir a mesma chave não repete o efeito. */
    chaveIdempotencia: ChaveIdempotencia,
  }),
  z.object({
    acao: z.literal("responder"),
    texto: z.string().trim().min(1).max(1000),
    agendamentoId: z.uuid().optional(),
    chaveIdempotencia: ChaveIdempotencia,
  }),
]);
export type AcaoConversa = z.infer<typeof AcaoConversaSchema>;

export const ErroAcao = z.enum([
  "id_invalido", "entrada_invalida", "clinica_nao_configurada", "paciente_nao_encontrado",
  "agendamento_nao_encontrado", "agendamento_de_outro_paciente", "sem_agendamento",
  "fora_da_janela", "envio_nao_configurado", "envio_falhou", "erro_interno",
]);
export type ErroAcao = z.infer<typeof ErroAcao>;

export const RespostaAcao = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    acao: z.enum(["confirmar", "cancelar", "resolver", "responder"]),
    /** true quando a chave de idempotência já havia sido usada: nada foi repetido. */
    duplicada: z.boolean(),
    /** Status do agendamento depois da ação (quando há agendamento). */
    statusAgendamento: StatusAgendamentoSchema.nullable(),
  }),
  z.object({ ok: z.literal(false), erro: ErroAcao, mensagem: z.string() }),
]);
export type RespostaAcao = z.infer<typeof RespostaAcao>;

/** HTTP de cada erro (usado pela rota). */
export const STATUS_HTTP_ERRO: Record<ErroAcao, number> = {
  id_invalido: 400, entrada_invalida: 400, clinica_nao_configurada: 503, paciente_nao_encontrado: 404,
  agendamento_nao_encontrado: 404, agendamento_de_outro_paciente: 403, sem_agendamento: 422,
  fora_da_janela: 409, envio_nao_configurado: 503, envio_falhou: 502, erro_interno: 500,
};
