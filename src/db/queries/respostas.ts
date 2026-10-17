import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { agendamentos, clinicas, mensagens, pacientes, respostas } from "@/db/schema";
import { marcarEventoProcessado } from "@/db/queries/eventos";
import type { AgendamentoAberto, DecisaoGravada, PacienteLocalizado } from "@/lib/resposta/processar";

/** Import tardio: evita abrir conexão em testes/ambientes sem DATABASE_URL. */
async function getDb() {
  const { db } = await import("@/db");
  return db;
}

/** Paciente com esse telefone na clínica dona do `phoneNumberId` (o mesmo telefone pode existir em várias clínicas). */
export async function localizarPaciente(phoneNumberId: string, telefones: string[]): Promise<PacienteLocalizado | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      pacienteId: pacientes.id, nome: pacientes.nome,
      clinicaId: clinicas.id, clinicaNome: clinicas.nome, fuso: clinicas.fuso,
      phoneNumberId: clinicas.phoneNumberId, tokenRef: clinicas.tokenRef,
      regras: clinicas.regras,
    })
    .from(pacientes)
    .innerJoin(clinicas, eq(clinicas.id, pacientes.clinicaId))
    .where(and(eq(clinicas.phoneNumberId, phoneNumberId), inArray(pacientes.telefone, telefones)))
    .orderBy(asc(pacientes.criadoEm))
    .limit(1);
  return row ?? null;
}

export async function buscarTokenRef(phoneNumberId: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db.select({ tokenRef: clinicas.tokenRef }).from(clinicas)
    .where(eq(clinicas.phoneNumberId, phoneNumberId)).limit(1);
  return row?.tokenRef ?? null;
}

/** Futuros em `inserido`/`enviado`, do mais próximo ao mais distante. */
export async function listarAgendamentosAbertos(pacienteId: string, agora: Date): Promise<AgendamentoAberto[]> {
  const db = await getDb();
  return db
    .select({ id: agendamentos.id, atendimento: agendamentos.atendimento, dataHora: agendamentos.dataHora, status: agendamentos.status })
    .from(agendamentos)
    .where(and(
      eq(agendamentos.pacienteId, pacienteId),
      inArray(agendamentos.status, ["inserido", "enviado"]),
      gt(agendamentos.dataHora, agora),
    ))
    .orderBy(asc(agendamentos.dataHora))
    .limit(10);
}

/**
 * Grava a resposta ANTES da IA: INSERT ... ON CONFLICT (wamid) DO NOTHING RETURNING.
 * Se o wamid já existia, `jaProcessada` diz se a decisão já foi tomada (classificada, sem agendamento
 * ou sem texto); uma resposta gravada mas ainda não decidida (crash) volta como `false` e é processada uma vez.
 */
export async function registrarResposta(d: {
  wamid: string; pacienteId: string; agendamentoId: string | null; texto: string; precisaHumano: boolean;
}): Promise<{ id: string; jaProcessada: boolean }> {
  const db = await getDb();
  const [novo] = await db.insert(respostas)
    .values({
      wamid: d.wamid, pacienteId: d.pacienteId, agendamentoId: d.agendamentoId, texto: d.texto,
      precisaHumano: d.precisaHumano ? 1 : 0, origem: "paciente",
    })
    .onConflictDoNothing({ target: respostas.wamid })
    .returning({ id: respostas.id });
  if (novo) return { id: novo.id, jaProcessada: false };

  const [existente] = await db.select({
    id: respostas.id, intencao: respostas.intencao, agendamentoId: respostas.agendamentoId, classificadaPor: respostas.classificadaPor,
  }).from(respostas).where(eq(respostas.wamid, d.wamid)).limit(1);
  return {
    id: existente.id,
    jaProcessada: existente.intencao !== null || existente.agendamentoId === null || existente.classificadaPor !== null,
  };
}

/** Sem paciente não há o que gravar em `respostas`: registra o aviso no evento bruto (se o webhook o salvou). */
export async function registrarSemPaciente(eventoId: string | undefined): Promise<void> {
  if (eventoId) await marcarEventoProcessado(eventoId, "paciente_nao_localizado");
}

/**
 * Classificação na resposta + status do agendamento, na mesma transação. O status só muda se o agendamento ainda
 * estiver aberto (inserido/enviado/excecao): se a recepção decidiu enquanto a IA classificava, a decisão da IA
 * fica em `respostas` mas não sobrescreve. Devolve se o status foi aplicado.
 */
export async function gravarDecisao(d: DecisaoGravada): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.update(respostas).set({
      intencao: d.intencao, confianca: d.confianca === null ? null : d.confianca.toFixed(3), motivo: d.motivo,
      classificadaPor: d.classificadaPor, precisaHumano: d.precisaHumano ? 1 : 0,
    }).where(eq(respostas.id, d.respostaId));
    const aplicados = await tx.update(agendamentos).set({ status: d.novoStatus, atualizadoEm: new Date() })
      .where(and(eq(agendamentos.id, d.agendamentoId), inArray(agendamentos.status, ["inserido", "enviado", "excecao"])))
      .returning({ id: agendamentos.id });
    return aplicados.length > 0;
  });
}

/** Texto automático como `texto_livre` pendente; unique em `resposta_a_wamid` → null se já reservado. */
export async function reservarRespostaAutomatica(agendamentoId: string, wamidResposta: string, corpo: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.insert(mensagens)
    .values({ agendamentoId, tipo: "texto_livre", respostaAWamid: wamidResposta, corpo, status: "pendente" })
    .onConflictDoNothing({ target: mensagens.respostaAWamid, where: sql`resposta_a_wamid IS NOT NULL` })
    .returning({ id: mensagens.id });
  return rows[0]?.id ?? null;
}

export async function carregarCorpoPendente(mensagemId: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db.select({ corpo: mensagens.corpo }).from(mensagens)
    .where(and(eq(mensagens.id, mensagemId), eq(mensagens.status, "pendente"), isNull(mensagens.wamid))).limit(1);
  return row?.corpo ?? null;
}

/** Falha definitiva da classificação (IA fora do ar, saída inválida): resposta e agendamento vão para a fila humana. */
export async function marcarFalhaClassificacao(wamid: string): Promise<void> {
  const db = await getDb();
  const [r] = await db.update(respostas).set({ precisaHumano: 1 }).where(eq(respostas.wamid, wamid))
    .returning({ agendamentoId: respostas.agendamentoId, intencao: respostas.intencao });
  if (r?.agendamentoId && r.intencao === null) {
    await db.update(agendamentos).set({ status: "excecao", atualizadoEm: new Date() })
      .where(and(eq(agendamentos.id, r.agendamentoId), inArray(agendamentos.status, ["inserido", "enviado"])));
  }
}
