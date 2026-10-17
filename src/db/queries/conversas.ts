import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { agendamentos, mensagens, pacientes, respostas } from "@/db/schema";
import type { LinhaConversa, MensagemHist, RespostaHist } from "@/lib/conversas/lista";
import type { AgendamentoAcao, GravacaoHumana, PacienteAcao } from "@/lib/conversas/acoes";

/** Import tardio: evita abrir conexão em testes/ambientes sem DATABASE_URL. */
async function getDb() {
  const { db } = await import("@/db");
  return db;
}

const STATUS_ABERTOS = ["inserido", "enviado", "respondido", "excecao"] as const;

/**
 * Pacientes COM conversa (mensagem enviada com sucesso ou resposta do paciente), uma linha por paciente,
 * numa única query (CTEs: última atividade, agendamento em foco, exceção). Ordenação/limite no SQL;
 * `montarLista` repete a mesma ordem em memória (ordem estável e testável).
 * Datas saem como epoch em ms (o driver devolve timestamps como string; epoch evita ambiguidade de fuso).
 */
export async function listarConversas(clinicaId: string, o: { excecoesPrimeiro: boolean; limite: number }): Promise<LinhaConversa[]> {
  const db = await getDb();
  const ordem = o.excecoesPrimeiro ? sql`tem_excecao desc, u.quando desc` : sql`u.quando desc`;
  const rows = await db.execute(sql`
    with base as (
      select a.paciente_id, m.corpo::text as texto, 'enviada'::text as direcao, coalesce(m.enviada_em, m.atualizada_em) as quando
      from mensagens m join agendamentos a on a.id = m.agendamento_id
      where a.clinica_id = ${clinicaId} and m.status in ('enviada','entregue','lida') and m.corpo is not null
      union all
      select r.paciente_id, r.texto::text, 'recebida'::text, r.recebida_em
      from respostas r join pacientes p on p.id = r.paciente_id
      where p.clinica_id = ${clinicaId} and r.origem = 'paciente'
    ), ultima as (
      select distinct on (paciente_id) paciente_id, texto, direcao, quando from base order by paciente_id, quando desc
    ), foco as (
      select distinct on (a.paciente_id) a.paciente_id, a.id, a.atendimento, a.data_hora, a.status
      from agendamentos a
      where a.clinica_id = ${clinicaId} and a.paciente_id in (select paciente_id from ultima)
      order by a.paciente_id,
        (a.status in ('inserido','enviado','respondido','excecao') and a.data_hora >= now()) desc,
        case when a.status in ('inserido','enviado','respondido','excecao') and a.data_hora >= now() then a.data_hora end asc,
        a.data_hora desc
    )
    select p.id as paciente_id, p.nome, p.telefone, u.texto, u.direcao,
      (extract(epoch from u.quando) * 1000)::float8 as quando_ms,
      f.id as ag_id, f.atendimento as ag_atendimento, (extract(epoch from f.data_hora) * 1000)::float8 as ag_data_ms, f.status::text as ag_status,
      (exists (select 1 from agendamentos x where x.paciente_id = p.id and x.status = 'excecao')
        or exists (select 1 from respostas r where r.paciente_id = p.id and r.precisa_humano = 1 and r.resolvida_em is null)) as tem_excecao
    from ultima u
    join pacientes p on p.id = u.paciente_id
    left join foco f on f.paciente_id = p.id
    order by ${ordem}
    limit ${o.limite}
  `);
  return (rows as unknown as Record<string, unknown>[]).map((r) => ({
    pacienteId: r.paciente_id as string,
    nome: r.nome as string,
    telefone: r.telefone as string,
    ultimaTexto: (r.texto as string) ?? "",
    ultimaDirecao: r.direcao as "enviada" | "recebida",
    ultimaEm: new Date(Number(r.quando_ms)),
    agId: (r.ag_id as string | null) ?? null,
    agAtendimento: (r.ag_atendimento as string | null) ?? null,
    agDataHora: r.ag_data_ms === null || r.ag_data_ms === undefined ? null : new Date(Number(r.ag_data_ms)),
    agStatus: (r.ag_status as LinhaConversa["agStatus"]) ?? null,
    temExcecao: r.tem_excecao === true,
  }));
}

export async function buscarPacienteDaClinica(pacienteId: string): Promise<(PacienteAcao & { nome: string }) | null> {
  const db = await getDb();
  const [row] = await db.select({ id: pacientes.id, clinicaId: pacientes.clinicaId, telefone: pacientes.telefone, nome: pacientes.nome })
    .from(pacientes).where(eq(pacientes.id, pacienteId)).limit(1);
  return row ?? null;
}

export async function buscarAgendamentoBasico(agendamentoId: string): Promise<AgendamentoAcao | null> {
  const db = await getDb();
  const [row] = await db.select({
    id: agendamentos.id, pacienteId: agendamentos.pacienteId, clinicaId: agendamentos.clinicaId, status: agendamentos.status,
  }).from(agendamentos).where(eq(agendamentos.id, agendamentoId)).limit(1);
  return row ?? null;
}

export async function listarAgendamentosDoPaciente(pacienteId: string) {
  const db = await getDb();
  return db.select({
    id: agendamentos.id, atendimento: agendamentos.atendimento, profissional: agendamentos.profissional,
    dataHora: agendamentos.dataHora, status: agendamentos.status,
  }).from(agendamentos).where(eq(agendamentos.pacienteId, pacienteId)).orderBy(desc(agendamentos.dataHora)).limit(100);
}

/** Aberto futuro mais próximo; senão o último. */
export async function agendamentoEmFoco(pacienteId: string): Promise<{ id: string } | null> {
  const db = await getDb();
  const [aberto] = await db.select({ id: agendamentos.id }).from(agendamentos)
    .where(and(eq(agendamentos.pacienteId, pacienteId), inArray(agendamentos.status, [...STATUS_ABERTOS]), gt(agendamentos.dataHora, new Date())))
    .orderBy(asc(agendamentos.dataHora)).limit(1);
  if (aberto) return aberto;
  const [ultimo] = await db.select({ id: agendamentos.id }).from(agendamentos)
    .where(eq(agendamentos.pacienteId, pacienteId)).orderBy(desc(agendamentos.dataHora)).limit(1);
  return ultimo ?? null;
}

export async function ultimaRespostaDoPacienteEm(pacienteId: string): Promise<Date | null> {
  const db = await getDb();
  const [row] = await db.select({ em: respostas.recebidaEm }).from(respostas)
    .where(and(eq(respostas.pacienteId, pacienteId), eq(respostas.origem, "paciente")))
    .orderBy(desc(respostas.recebidaEm)).limit(1);
  return row?.em ?? null;
}

export async function listarMensagensDoPaciente(pacienteId: string): Promise<MensagemHist[]> {
  const db = await getDb();
  const rows = await db.select({
    id: mensagens.id, agendamentoId: mensagens.agendamentoId, tipo: mensagens.tipo, corpo: mensagens.corpo,
    status: mensagens.status, enviadaEm: mensagens.enviadaEm, atualizadaEm: mensagens.atualizadaEm,
  }).from(mensagens).innerJoin(agendamentos, eq(agendamentos.id, mensagens.agendamentoId))
    .where(eq(agendamentos.pacienteId, pacienteId))
    .orderBy(asc(mensagens.atualizadaEm)).limit(500);
  // confirmação ainda "pendente" (sem corpo) não é mensagem de verdade para a tela
  return rows.filter((m) => m.corpo !== null).map((m) => ({
    id: m.id, agendamentoId: m.agendamentoId, tipo: m.tipo, corpo: m.corpo, status: m.status, quando: m.enviadaEm ?? m.atualizadaEm,
  }));
}

export async function listarRespostasDoPaciente(pacienteId: string): Promise<RespostaHist[]> {
  const db = await getDb();
  const rows = await db.select().from(respostas).where(eq(respostas.pacienteId, pacienteId))
    .orderBy(asc(respostas.recebidaEm)).limit(500);
  return rows.map((r) => ({
    id: r.id, agendamentoId: r.agendamentoId, texto: r.texto, intencao: r.intencao, confianca: r.confianca,
    motivo: r.motivo, origem: r.origem, classificadaPor: r.classificadaPor, precisaHumano: r.precisaHumano,
    resolvidaEm: r.resolvidaEm, quando: r.recebidaEm,
  }));
}

/** Ação humana (confirmar/cancelar/resolver): resposta + status + pendentes resolvidas, numa transação. */
export async function gravarAcaoHumana(d: GravacaoHumana): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const agora = new Date();
    const [novo] = await tx.insert(respostas).values({
      wamid: d.wamid, pacienteId: d.pacienteId, agendamentoId: d.agendamentoId, texto: d.texto,
      intencao: d.intencao, classificadaPor: "humano", origem: "humano", motivo: `acao:${d.acao}`,
      precisaHumano: 0, resolvidaEm: agora,
    }).onConflictDoNothing({ target: respostas.wamid }).returning({ id: respostas.id });
    if (!novo) return false;
    if (d.novoStatus && d.agendamentoId) {
      await tx.update(agendamentos).set({ status: d.novoStatus, atualizadoEm: agora }).where(eq(agendamentos.id, d.agendamentoId));
    }
    if (d.resolverPendentes && d.agendamentoId) {
      await tx.update(respostas).set({ resolvidaEm: agora, precisaHumano: 0 })
        .where(and(eq(respostas.agendamentoId, d.agendamentoId), eq(respostas.precisaHumano, 1), isNull(respostas.resolvidaEm)));
    }
    return true;
  });
}

export async function reservarRespostaHumana(d: { wamid: string; pacienteId: string; agendamentoId: string; texto: string }): Promise<boolean> {
  const db = await getDb();
  const rows = await db.insert(respostas).values({
    wamid: d.wamid, pacienteId: d.pacienteId, agendamentoId: d.agendamentoId, texto: d.texto,
    classificadaPor: "humano", origem: "humano", motivo: "acao:responder", precisaHumano: 0,
  }).onConflictDoNothing({ target: respostas.wamid }).returning({ id: respostas.id });
  return rows.length > 0;
}

export async function liberarRespostaHumana(wamid: string): Promise<void> {
  const db = await getDb();
  await db.delete(respostas).where(and(eq(respostas.wamid, wamid), eq(respostas.origem, "humano")));
}

export async function registrarMensagemTexto(d: {
  agendamentoId: string; corpo: string; wamid: string | null; status: "enviada" | "falhou";
  erroCodigo: number | null; erroMensagem: string | null;
}): Promise<void> {
  const db = await getDb();
  const agora = new Date();
  await db.insert(mensagens).values({
    agendamentoId: d.agendamentoId, tipo: "texto_livre", corpo: d.corpo, wamid: d.wamid, status: d.status,
    erroCodigo: d.erroCodigo, erroMensagem: d.erroMensagem, enviadaEm: d.status === "enviada" ? agora : null, atualizadaEm: agora,
  });
}
