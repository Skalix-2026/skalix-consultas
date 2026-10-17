/** Lógica pura da tela /agenda (sem fuso/servidor: seguro para o bundle do navegador). */

export const INTERVALO_AGENDA_MS = 10_000;
export const HORA_INICIO_PADRAO = 7;
export const HORA_FIM_PADRAO = 19;

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "yyyy-MM-dd" que existe de verdade no calendário (rejeita 2026-02-30). */
export function dataValida(s: string): boolean {
  const m = RE_DATA.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export function partesData(s: string): { y: number; m: number; d: number } {
  const m = RE_DATA.exec(s);
  if (!m) throw new RangeError(`Data inválida: ${s}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Soma dias no calendário (aritmética em UTC: não sofre com horário de verão nem com o fuso do navegador). */
export function somarDias(data: string, dias: number): string {
  const { y, m, d } = partesData(data);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** "quinta-feira, 16 de outubro de 2026". */
export function dataPorExtenso(data: string): string {
  const { y, m, d } = partesData(data);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" })
    .format(new Date(Date.UTC(y, m - 1, d, 12)));
}

// ---- Status ---------------------------------------------------------------

export type GrupoStatus = "aguardando" | "enviado" | "respondido" | "confirmado" | "cancelado" | "sem_resposta" | "excecao";

export type VisualStatus = {
  grupo: GrupoStatus;
  rotulo: string;
  /** Símbolo exibido junto ao texto (a cor nunca é a única pista). */
  icone: string;
  badge: string;
  borda: string;
};

const VISUAL: Record<GrupoStatus, Omit<VisualStatus, "grupo">> = {
  aguardando: { rotulo: "Aguardando envio", icone: "…", badge: "bg-gray-100 text-gray-700", borda: "border-l-gray-400" },
  enviado: { rotulo: "Enviado", icone: "➤", badge: "bg-blue-100 text-blue-800", borda: "border-l-blue-500" },
  respondido: { rotulo: "Respondido", icone: "↩", badge: "bg-sky-100 text-sky-800", borda: "border-l-sky-500" },
  confirmado: { rotulo: "Confirmado", icone: "✓", badge: "bg-green-100 text-green-800", borda: "border-l-green-600" },
  cancelado: { rotulo: "Cancelado", icone: "✕", badge: "bg-rose-100 text-rose-800", borda: "border-l-rose-400" },
  sem_resposta: { rotulo: "Sem resposta", icone: "?", badge: "bg-amber-100 text-amber-800", borda: "border-l-amber-500" },
  excecao: { rotulo: "Precisa de atenção", icone: "!", badge: "bg-red-600 text-white", borda: "border-l-red-600 border-l-8" },
};

/** Ordem da legenda. `respondido` só aparece quando existe (status legado). */
export const GRUPOS_LEGENDA: GrupoStatus[] = ["aguardando", "enviado", "respondido", "confirmado", "cancelado", "sem_resposta", "excecao"];

/**
 * Status do banco -> grupo visual. `inserido` = "aguardando"; `nao_sou_eu` (legado) conta como exceção, pois
 * alguém da recepção precisa tratar; `respondido` (legado) mantém o próprio grupo. Desconhecido cai em "aguardando".
 */
export function grupoDoStatus(status: string): GrupoStatus {
  switch (status) {
    case "inserido": return "aguardando";
    case "enviado": return "enviado";
    case "respondido": return "respondido";
    case "confirmado": return "confirmado";
    case "cancelado": return "cancelado";
    case "sem_resposta": return "sem_resposta";
    case "excecao":
    case "nao_sou_eu": return "excecao";
    default: return "aguardando";
  }
}

export function visualDoStatus(status: string): VisualStatus {
  const grupo = grupoDoStatus(status);
  return { grupo, ...VISUAL[grupo] };
}

export function visualDoGrupo(grupo: GrupoStatus): VisualStatus {
  return { grupo, ...VISUAL[grupo] };
}

/** Soma a contagem por status do banco nos grupos da legenda. */
export function contarPorGrupo(contagem: Record<string, number>): Record<GrupoStatus, number> {
  const r: Record<GrupoStatus, number> = { aguardando: 0, enviado: 0, respondido: 0, confirmado: 0, cancelado: 0, sem_resposta: 0, excecao: 0 };
  for (const [status, n] of Object.entries(contagem)) r[grupoDoStatus(status)] += n;
  return r;
}

// ---- Grade de horários ----------------------------------------------------

export function horaDe(horaLocal: string): number {
  return Number(horaLocal.slice(0, 2));
}

/** Faixa 07h–19h, ampliada se houver agendamento fora dela. */
export function faixaHoras(horasLocais: string[]): { inicio: number; fim: number } {
  let inicio = HORA_INICIO_PADRAO;
  let fim = HORA_FIM_PADRAO;
  for (const h of horasLocais) {
    const n = horaDe(h);
    if (Number.isNaN(n)) continue;
    inicio = Math.min(inicio, n);
    fim = Math.max(fim, n);
  }
  return { inicio, fim };
}

/** Uma entrada por hora da faixa (inclusive as vazias), mantendo a ordem recebida dentro de cada hora. */
export function agruparPorHora<T extends { horaLocal: string }>(itens: T[]): { hora: number; itens: T[] }[] {
  const { inicio, fim } = faixaHoras(itens.map((i) => i.horaLocal));
  const grupos = Array.from({ length: fim - inicio + 1 }, (_, i) => ({ hora: inicio + i, itens: [] as T[] }));
  for (const i of itens) {
    const n = horaDe(i.horaLocal);
    if (!Number.isNaN(n)) grupos[n - inicio].itens.push(i);
  }
  return grupos;
}

export const rotuloHora = (h: number) => `${String(h).padStart(2, "0")}h`;
