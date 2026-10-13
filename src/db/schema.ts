import {
  pgTable, uuid, text, timestamp, integer, numeric, jsonb, pgEnum, uniqueIndex, index,
} from "drizzle-orm/pg-core";

// ---- Enums --------------------------------------------------------------
export const statusAgendamento = pgEnum("status_agendamento", [
  "inserido", "enviado", "respondido", "confirmado", "cancelado", "sem_resposta", "nao_sou_eu",
]);
export const tipoMensagem = pgEnum("tipo_mensagem", [
  "confirmacao", "lembrete_vespera", "cobranca_resposta", "texto_livre",
]);
export const statusMensagem = pgEnum("status_mensagem", [
  "pendente", "enviada", "entregue", "lida", "falhou",
]);
export const intencao = pgEnum("intencao", [
  "confirmou", "cancelou", "quer_remarcar", "duvida", "nao_sou_eu", "fora_de_escopo",
]);
export const statusLote = pgEnum("status_lote", ["importado", "conferido", "enviando", "concluido"]);

// ---- Clínicas / unidades (multiunidade e multi-WABA desde o início) ------
export const clinicas = pgTable("clinicas", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),                 // "Clínica Aurora · Unidade Centro"
  cnpj: text("cnpj"),
  wabaId: text("waba_id").notNull(),
  phoneNumberId: text("phone_number_id").notNull(),
  tokenRef: text("token_ref"),                  // nome da env var que guarda o token (nunca o token)
  regras: jsonb("regras").$type<{ prazoCancelamentoHoras?: number; preparos?: Record<string, string> }>(),
  fuso: text("fuso").default("America/Sao_Paulo").notNull(), // IANA; MT/MS/RO/RR/AM = -04:00, AC = -05:00
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
});

// ---- Pacientes -----------------------------------------------------------
export const pacientes = pgTable("pacientes", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicaId: uuid("clinica_id").references(() => clinicas.id).notNull(),
  nome: text("nome").notNull(),
  telefone: text("telefone").notNull(),         // E.164: 5511999990000
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
}, (t) => [uniqueIndex("pacientes_clinica_telefone").on(t.clinicaId, t.telefone)]);

// ---- Lotes de importação -------------------------------------------------
export const lotes = pgTable("lotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicaId: uuid("clinica_id").references(() => clinicas.id).notNull(),
  arquivoNome: text("arquivo_nome").notNull(),
  arquivoUrl: text("arquivo_url"),
  totalLinhas: integer("total_linhas").default(0).notNull(),
  linhasValidas: integer("linhas_validas").default(0).notNull(),
  status: statusLote("status").default("importado").notNull(),
  mapeamentoColunas: jsonb("mapeamento_colunas"), // como a IA mapeou as colunas do arquivo
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
});

// ---- Agendamentos --------------------------------------------------------
export const agendamentos = pgTable("agendamentos", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicaId: uuid("clinica_id").references(() => clinicas.id).notNull(),
  pacienteId: uuid("paciente_id").references(() => pacientes.id).notNull(),
  loteId: uuid("lote_id").references(() => lotes.id),
  atendimento: text("atendimento").notNull(),   // "Ultrassonografia de Joelho", "Cardiologia"
  tipo: text("tipo"),                           // exame | consulta | procedimento
  profissional: text("profissional"),
  dataHora: timestamp("data_hora", { withTimezone: true }).notNull(),
  status: statusAgendamento("status").default("inserido").notNull(),
  chaveExterna: text("chave_externa"),          // id no sistema da clínica, se houver
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
  atualizadoEm: timestamp("atualizado_em").defaultNow().notNull(),
}, (t) => [
  index("agendamentos_clinica_data").on(t.clinicaId, t.dataHora),
  uniqueIndex("agendamentos_dedup").on(t.pacienteId, t.atendimento, t.dataHora),
]);

// ---- Mensagens enviadas (idempotência: 1 por agendamento+tipo) -----------
export const mensagens = pgTable("mensagens", {
  id: uuid("id").primaryKey().defaultRandom(),
  agendamentoId: uuid("agendamento_id").references(() => agendamentos.id).notNull(),
  tipo: tipoMensagem("tipo").notNull(),
  wamid: text("wamid"),                         // id da Meta
  templateNome: text("template_nome"),
  corpo: text("corpo"),
  status: statusMensagem("status").default("pendente").notNull(),
  erroCodigo: integer("erro_codigo"),
  erroMensagem: text("erro_mensagem"),
  enviadaEm: timestamp("enviada_em"),
  atualizadaEm: timestamp("atualizada_em").defaultNow().notNull(),
}, (t) => [uniqueIndex("mensagens_idempotencia").on(t.agendamentoId, t.tipo)]);

// ---- Respostas do paciente + classificação da IA -------------------------
export const respostas = pgTable("respostas", {
  id: uuid("id").primaryKey().defaultRandom(),
  agendamentoId: uuid("agendamento_id").references(() => agendamentos.id),
  pacienteId: uuid("paciente_id").references(() => pacientes.id).notNull(),
  wamid: text("wamid").notNull().unique(),
  texto: text("texto").notNull(),
  intencao: intencao("intencao"),
  confianca: numeric("confianca", { precision: 4, scale: 3 }),
  motivo: text("motivo"),
  classificadaPor: text("classificada_por"),     // "haiku" | "sonnet" | "humano"
  precisaHumano: integer("precisa_humano").default(0).notNull(), // 0/1
  resolvidaEm: timestamp("resolvida_em"),
  recebidaEm: timestamp("recebida_em").defaultNow().notNull(),
});

// ---- Eventos brutos do webhook (auditoria) --------------------------------
export const eventosWebhook = pgTable("eventos_webhook", {
  id: uuid("id").primaryKey().defaultRandom(),
  payload: jsonb("payload").notNull(),
  processadoEm: timestamp("processado_em"),
  erro: text("erro"),
  recebidoEm: timestamp("recebido_em").defaultNow().notNull(),
});

// ---- Base de conhecimento para o RAG (regras, FAQ, exemplos) ------------
export const conhecimento = pgTable("conhecimento", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicaId: uuid("clinica_id").references(() => clinicas.id),
  tipo: text("tipo").notNull(),                 // regra | faq | exemplo_classificado
  conteudo: text("conteudo").notNull(),
  // embedding vector(1024) — adicionar via migração SQL com pgvector
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
});
