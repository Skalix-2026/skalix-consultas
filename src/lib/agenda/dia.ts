import { abreviarNome, mascararTelefoneExibicao, offsetDoFuso } from "@/lib/importacao/normalizar";
import type { RespostaAgenda } from "@/lib/schemas-agenda";
import { partesData, somarDias } from "@/lib/ui/agenda";

/** Lado servidor da agenda: dia no fuso da clínica -> intervalo UTC, hora local e montagem da resposta. */

/** "yyyy-MM-dd" de hoje no fuso. Lança RangeError se o fuso não existir. */
export function hojeNoFuso(fuso: string, agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

function meiaNoite(data: string, fuso: string): Date {
  const p = partesData(data);
  return new Date(`${data}T00:00:00${offsetDoFuso(fuso, p, { hh: 0, mm: 0 })}`);
}

/** [inicio, fim) do dia local em UTC, com o offset real do fuso naquele dia (dia de 23/25 h incluso). */
export function limitesDoDia(data: string, fuso: string): { inicio: Date; fim: Date } {
  return { inicio: meiaNoite(data, fuso), fim: meiaNoite(somarDias(data, 1), fuso) };
}

const formatadores = new Map<string, Intl.DateTimeFormat>();
export function horaLocal(instante: Date, fuso: string): string {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatadores.set(fuso, f);
  }
  return f.format(instante);
}

export type LinhaAgenda = {
  id: string; atendimento: string; profissional: string | null; dataHora: Date;
  status: string; pacienteNome: string; pacienteTelefone: string;
};

type Ok = Extract<RespostaAgenda, { ok: true }>;

/** Filtra por profissional, ordena por horário, mascara telefone e abrevia nome. `profissionais` vem do dia inteiro. */
export function montarAgenda(linhas: LinhaAgenda[], o: { data: string; fuso: string; profissional?: string }): Ok {
  const profissionais = [...new Set(linhas.map((l) => l.profissional?.trim()).filter((p): p is string => !!p))]
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  const filtradas = o.profissional ? linhas.filter((l) => (l.profissional?.trim() ?? "") === o.profissional) : linhas;
  const ordenadas = [...filtradas].sort((a, b) => a.dataHora.getTime() - b.dataHora.getTime() || a.pacienteNome.localeCompare(b.pacienteNome, "pt-BR"));
  const contagemPorStatus: Record<string, number> = {};
  for (const l of ordenadas) contagemPorStatus[l.status] = (contagemPorStatus[l.status] ?? 0) + 1;
  return {
    ok: true,
    data: o.data,
    profissionais,
    agendamentos: ordenadas.map((l) => ({
      id: l.id,
      horaLocal: horaLocal(l.dataHora, o.fuso),
      dataHora: l.dataHora.toISOString(),
      atendimento: l.atendimento,
      profissional: l.profissional?.trim() || null,
      status: l.status as Ok["agendamentos"][number]["status"],
      pacienteNome: abreviarNome(l.pacienteNome),
      telefone: mascararTelefoneExibicao(l.pacienteTelefone),
    })),
    contagemPorStatus,
  };
}
