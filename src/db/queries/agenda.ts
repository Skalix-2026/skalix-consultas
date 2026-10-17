import { and, asc, eq, gte, lt } from "drizzle-orm";
import { agendamentos, pacientes } from "@/db/schema";
import type { LinhaAgenda } from "@/lib/agenda/dia";

/** Import tardio: evita abrir conexão em testes/ambientes sem DATABASE_URL. */
async function getDb() {
  const { db } = await import("@/db");
  return db;
}

/** Agendamentos de [inicio, fim) da clínica com o paciente, numa única query (join, sem N+1). */
export async function listarAgendaDoDia(clinicaId: string, inicio: Date, fim: Date): Promise<LinhaAgenda[]> {
  const db = await getDb();
  return db.select({
    id: agendamentos.id, atendimento: agendamentos.atendimento, profissional: agendamentos.profissional,
    dataHora: agendamentos.dataHora, status: agendamentos.status,
    pacienteNome: pacientes.nome, pacienteTelefone: pacientes.telefone,
  }).from(agendamentos).innerJoin(pacientes, eq(pacientes.id, agendamentos.pacienteId))
    .where(and(eq(agendamentos.clinicaId, clinicaId), gte(agendamentos.dataHora, inicio), lt(agendamentos.dataHora, fim)))
    .orderBy(asc(agendamentos.dataHora), asc(pacientes.nome))
    .limit(1000);
}
