import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { agendamentos, clinicas, lotes, mensagens, pacientes } from "@/db/schema";
import type { LinhaAgenda, Mapeamento } from "@/lib/importacao/tipos";

/** Import tardio: evita abrir conexão em testes/ambientes sem DATABASE_URL. */
async function getDb() {
  const { db } = await import("@/db");
  return db;
}

export type StatusLote = "importado" | "conferido" | "enviando" | "concluido";
export type ClinicaBasica = { id: string; fuso: string; phoneNumberId: string; tokenRef: string | null };

const COLS_CLINICA = {
  id: clinicas.id, fuso: clinicas.fuso, phoneNumberId: clinicas.phoneNumberId, tokenRef: clinicas.tokenRef,
};

/** `CLINICA_ID` se existir; senão a primeira clínica (por criação). null se não houver. */
export async function buscarClinicaPadrao(): Promise<ClinicaBasica | null> {
  const db = await getDb();
  const id = process.env.CLINICA_ID;
  const [row] = id
    ? await db.select(COLS_CLINICA).from(clinicas).where(eq(clinicas.id, id)).limit(1)
    : await db.select(COLS_CLINICA).from(clinicas).orderBy(asc(clinicas.criadoEm)).limit(1);
  return row ?? null;
}

export async function buscarClinicaPorId(id: string): Promise<ClinicaBasica | null> {
  const db = await getDb();
  const [row] = await db.select(COLS_CLINICA).from(clinicas).where(eq(clinicas.id, id)).limit(1);
  return row ?? null;
}

export type LoteResumo = {
  id: string; arquivoNome: string; totalLinhas: number; linhasValidas: number; status: StatusLote; criadoEm: Date;
};

/** Lote da clínica já importado com o mesmo hash de arquivo (cache: nunca reprocessar nem chamar IA). */
export async function buscarLotePorHash(clinicaId: string, arquivoHash: string): Promise<LoteResumo | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      id: lotes.id, arquivoNome: lotes.arquivoNome, totalLinhas: lotes.totalLinhas,
      linhasValidas: lotes.linhasValidas, status: lotes.status, criadoEm: lotes.criadoEm,
    })
    .from(lotes)
    .where(and(eq(lotes.clinicaId, clinicaId), sql`${lotes.mapeamentoColunas}->>'arquivoHash' = ${arquivoHash}`))
    .orderBy(asc(lotes.criadoEm))
    .limit(1);
  return row ?? null;
}

export type NovoLote = {
  clinicaId: string;
  arquivoNome: string;
  totalLinhas: number;
  mapeamento: Mapeamento;
  /** Só linhas válidas. Nenhuma coluna extra (CID, CPF...) chega aqui: `LinhaAgenda` não as tem. */
  validas: LinhaAgenda[];
};

const BLOCO = 500;
function blocos<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += BLOCO) out.push(xs.slice(i, i + BLOCO));
  return out;
}

/**
 * Cria lote + pacientes + agendamentos numa transação.
 * Pacientes: upsert por (clinica_id, telefone); o nome da agenda mais recente prevalece.
 * Agendamentos: ON CONFLICT DO NOTHING em `agendamentos_dedup`; o que conflita conta como duplicada.
 */
export async function criarLoteComAgendamentos(
  n: NovoLote,
): Promise<{ loteId: string; inseridas: number; duplicadas: number }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [lote] = await tx.insert(lotes).values({
      clinicaId: n.clinicaId,
      arquivoNome: n.arquivoNome,
      totalLinhas: n.totalLinhas,
      linhasValidas: n.validas.length,
      mapeamentoColunas: n.mapeamento,
      status: "importado",
    }).returning({ id: lotes.id });

    // um paciente por telefone (a última ocorrência no arquivo define o nome)
    const porTelefone = new Map<string, string>();
    for (const l of n.validas) porTelefone.set(l.telefone, l.nome);

    const idPorTelefone = new Map<string, string>();
    for (const bloco of blocos([...porTelefone])) {
      const rows = await tx.insert(pacientes)
        .values(bloco.map(([telefone, nome]) => ({ clinicaId: n.clinicaId, telefone, nome })))
        .onConflictDoUpdate({ target: [pacientes.clinicaId, pacientes.telefone], set: { nome: sql`excluded.nome` } })
        .returning({ id: pacientes.id, telefone: pacientes.telefone });
      for (const r of rows) idPorTelefone.set(r.telefone, r.id);
    }

    let inseridas = 0;
    for (const bloco of blocos(n.validas)) {
      const rows = await tx.insert(agendamentos)
        .values(bloco.map((l) => ({
          clinicaId: n.clinicaId,
          pacienteId: idPorTelefone.get(l.telefone)!,
          loteId: lote.id,
          atendimento: l.atendimento,
          tipo: l.tipo,
          profissional: l.profissional,
          dataHora: new Date(l.dataHora),
          chaveExterna: l.chaveExterna,
          status: "inserido" as const,
        })))
        .onConflictDoNothing({ target: [agendamentos.pacienteId, agendamentos.atendimento, agendamentos.dataHora] })
        .returning({ id: agendamentos.id });
      inseridas += rows.length;
    }
    return { loteId: lote.id, inseridas, duplicadas: n.validas.length - inseridas };
  });
}

// ---------- Leitura para a UI ----------

export type ContagemStatus = Record<string, number>;
export type LoteComContagens = LoteResumo & { clinicaId: string; enviandoDesde: Date | null; contagens: ContagemStatus };

async function contagensPorLote(ids: string[]): Promise<Map<string, ContagemStatus>> {
  const mapa = new Map<string, ContagemStatus>();
  if (ids.length === 0) return mapa;
  const db = await getDb();
  const rows = await db
    .select({ loteId: agendamentos.loteId, status: agendamentos.status, n: sql<number>`count(*)::int` })
    .from(agendamentos).where(inArray(agendamentos.loteId, ids)).groupBy(agendamentos.loteId, agendamentos.status);
  for (const r of rows) {
    if (!r.loteId) continue;
    mapa.set(r.loteId, { ...(mapa.get(r.loteId) ?? {}), [r.status]: r.n });
  }
  return mapa;
}

const COLS_LOTE = {
  id: lotes.id, clinicaId: lotes.clinicaId, arquivoNome: lotes.arquivoNome, totalLinhas: lotes.totalLinhas,
  linhasValidas: lotes.linhasValidas, status: lotes.status, criadoEm: lotes.criadoEm, enviandoDesde: lotes.enviandoDesde,
};

export async function listarLotes(limite = 50): Promise<LoteComContagens[]> {
  const db = await getDb();
  const rows = await db.select(COLS_LOTE).from(lotes).orderBy(desc(lotes.criadoEm)).limit(limite);
  const c = await contagensPorLote(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, contagens: c.get(r.id) ?? {} }));
}

export async function obterLote(id: string): Promise<LoteComContagens | null> {
  const db = await getDb();
  const [r] = await db.select(COLS_LOTE).from(lotes).where(eq(lotes.id, id)).limit(1);
  if (!r) return null;
  const c = await contagensPorLote([id]);
  return { ...r, contagens: c.get(id) ?? {} };
}

export type AgendamentoDoLote = {
  id: string;
  /** Dados completos: a rota mascara/abrevia antes de responder. */
  nome: string;
  telefone: string;
  atendimento: string;
  profissional: string | null;
  dataHora: Date;
  status: string;
  mensagemStatus: string | null;
  erroCodigo: number | null;
  erroMensagem: string | null;
};

export async function listarAgendamentosDoLote(loteId: string): Promise<AgendamentoDoLote[]> {
  const db = await getDb();
  return db
    .select({
      id: agendamentos.id, nome: pacientes.nome, telefone: pacientes.telefone,
      atendimento: agendamentos.atendimento, profissional: agendamentos.profissional,
      dataHora: agendamentos.dataHora, status: agendamentos.status,
      mensagemStatus: mensagens.status, erroCodigo: mensagens.erroCodigo, erroMensagem: mensagens.erroMensagem,
    })
    .from(agendamentos)
    .innerJoin(pacientes, eq(pacientes.id, agendamentos.pacienteId))
    .leftJoin(mensagens, and(eq(mensagens.agendamentoId, agendamentos.id), eq(mensagens.tipo, "confirmacao")))
    .where(eq(agendamentos.loteId, loteId))
    .orderBy(asc(agendamentos.dataHora));
}

// ---------- Status do lote ----------

/**
 * Troca o status só se ainda estiver em `de` (evita corrida entre dois cliques). Retorna se trocou.
 * `enviandoDesde` é gravado ao entrar em "enviando" e zerado ao sair.
 * `enviandoAntesDe`: só troca se o lote está em "enviando" parado desde antes desse instante (retomada de envio travado).
 */
export async function trocarStatusLote(
  id: string, de: StatusLote, para: StatusLote, opcoes: { enviandoAntesDe?: Date } = {},
): Promise<boolean> {
  const db = await getDb();
  const filtros = [eq(lotes.id, id), eq(lotes.status, de)];
  if (opcoes.enviandoAntesDe) {
    filtros.push(sql`(${lotes.enviandoDesde} is null or ${lotes.enviandoDesde} < ${opcoes.enviandoAntesDe})`);
  }
  const rows = await db.update(lotes)
    .set({ status: para, enviandoDesde: para === "enviando" ? new Date() : null })
    .where(and(...filtros)).returning({ id: lotes.id });
  return rows.length > 0;
}

export async function definirStatusLote(id: string, status: StatusLote): Promise<void> {
  const db = await getDb();
  await db.update(lotes).set({ status, enviandoDesde: status === "enviando" ? new Date() : null }).where(eq(lotes.id, id));
}

// ---------- Envio ----------

export type AgendamentoParaEnvio = {
  id: string; nome: string; telefone: string; atendimento: string; profissional: string | null; dataHora: Date;
};

/** Agendamentos do lote ainda "inserido" e no futuro, opcionalmente dentro de [de, ate). */
export async function buscarAgendamentosParaEnvio(
  loteId: string,
  opcoes: { agora: Date; de?: Date; ate?: Date },
): Promise<AgendamentoParaEnvio[]> {
  const db = await getDb();
  const filtros = [
    eq(agendamentos.loteId, loteId),
    eq(agendamentos.status, "inserido"),
    gt(agendamentos.dataHora, opcoes.agora),
  ];
  if (opcoes.de) filtros.push(sql`${agendamentos.dataHora} >= ${opcoes.de}`);
  if (opcoes.ate) filtros.push(sql`${agendamentos.dataHora} < ${opcoes.ate}`);
  return db
    .select({
      id: agendamentos.id, nome: pacientes.nome, telefone: pacientes.telefone, atendimento: agendamentos.atendimento,
      profissional: agendamentos.profissional, dataHora: agendamentos.dataHora,
    })
    .from(agendamentos).innerJoin(pacientes, eq(pacientes.id, agendamentos.pacienteId))
    .where(and(...filtros)).orderBy(asc(agendamentos.dataHora));
}

export async function buscarIdsParaEnvio(
  loteId: string,
  opcoes: { agora: Date; de?: Date; ate?: Date },
): Promise<string[]> {
  return (await buscarAgendamentosParaEnvio(loteId, opcoes)).map((a) => a.id);
}

/** Dados de contato por ids, só os ainda "inserido" e no futuro (reconferido no momento do envio). */
export async function buscarAgendamentosPorIds(ids: string[], agora: Date): Promise<AgendamentoParaEnvio[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  return db
    .select({
      id: agendamentos.id, nome: pacientes.nome, telefone: pacientes.telefone, atendimento: agendamentos.atendimento,
      profissional: agendamentos.profissional, dataHora: agendamentos.dataHora,
    })
    .from(agendamentos).innerJoin(pacientes, eq(pacientes.id, agendamentos.pacienteId))
    .where(and(inArray(agendamentos.id, ids), eq(agendamentos.status, "inserido"), gt(agendamentos.dataHora, agora)))
    .orderBy(asc(agendamentos.dataHora));
}

export async function buscarClinicaDoLote(loteId: string): Promise<ClinicaBasica | null> {
  const db = await getDb();
  const [row] = await db.select(COLS_CLINICA).from(lotes)
    .innerJoin(clinicas, eq(clinicas.id, lotes.clinicaId)).where(eq(lotes.id, loteId)).limit(1);
  return row ?? null;
}
