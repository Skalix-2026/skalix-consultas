import type { Campo, Mapeamento } from "./tipos";
import { FORMATOS_DATA } from "./tipos";

type FormatoData = (typeof FORMATOS_DATA)[number];

/** Sem acento, minúsculo, pontuação vira espaço: "DATA/HORA" → "data hora". */
export function normalizarCabecalho(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Sinônimos já normalizados. Comparação EXATA com o cabeçalho normalizado (não por substring),
 * para não confundir "Data de nascimento" com "Data". O que não casar aqui vai para o fallback (Haiku).
 * Ordem importa: data_hora é testado antes de data/hora.
 */
const SINONIMOS: [Campo, string[]][] = [
  ["data_hora", ["data hora", "datahora", "data e hora", "data horario", "data e horario", "dt hora"]],
  ["nome", ["nome", "paciente", "nome do paciente", "nome paciente", "nome completo", "nome do cliente", "beneficiario", "nome beneficiario"]],
  ["telefone", ["telefone", "celular", "fone", "tel", "telefone celular", "celular paciente", "telefone do paciente", "whatsapp", "telefone 1", "fone celular", "cel"]],
  ["atendimento", ["atendimento", "procedimento", "exame", "exames", "consulta", "tipo de atendimento", "especialidade", "descricao", "descricao do procedimento", "procedimentos"]],
  ["profissional", ["profissional", "medico", "medica", "medico a", "doutor", "dr", "prestador", "executante", "medico responsavel", "nome do medico"]],
  ["data", ["data", "data consulta", "data da consulta", "data do atendimento", "data atendimento", "data agendamento", "data do agendamento", "dt", "dt atendimento", "data exame", "data do exame"]],
  ["hora", ["hora", "horario", "hr", "hora consulta", "hora do atendimento", "hora atendimento", "hora agendamento", "horario agendamento"]],
  ["tipo", ["tipo", "tipo agendamento", "tipo de agendamento", "categoria"]],
  ["chave_externa", ["id", "codigo", "cod", "id agendamento", "codigo agendamento", "cod agendamento", "n agendamento", "numero agendamento", "protocolo"]],
];

const INDICE = new Map<string, Campo>();
for (const [campo, lista] of SINONIMOS) for (const s of lista) if (!INDICE.has(s)) INDICE.set(s, campo);

const RE_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})/;
const RE_TRACO = /^(\d{1,2})-(\d{1,2})-(\d{4})/;
const RE_BARRA = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/;
const RE_SERIAL = /^\d{4,6}(\.\d+)?$/;

export type AnaliseFormatoData = {
  formato: FormatoData | null;
  /** true se dia e mês não puderam ser distinguidos (todos os valores com ambos ≤ 12): assumido dd/MM. */
  ambiguo: boolean;
};

/**
 * Deduz o formato de data olhando TODOS os valores da coluna (passe todas as linhas, não uma amostra:
 * um único "13/10" no fim do arquivo é o que desambigua dd/MM de MM/dd).
 * Ambíguo (ex.: só 05/06/2026) → dd/MM/yyyy (Brasil) com `ambiguo: true` para a triagem avisar.
 */
export function analisarFormatoData(valores: string[]): AnaliseFormatoData {
  const v = valores.map((x) => (x ?? "").trim()).filter(Boolean);
  if (v.length === 0) return { formato: null, ambiguo: false };
  if (v.every((x) => RE_SERIAL.test(x))) return { formato: "serial_excel", ambiguo: false };
  if (v.every((x) => RE_ISO.test(x))) return { formato: "yyyy-MM-dd", ambiguo: false };
  for (const [re, formato] of [[RE_TRACO, "dd-MM-yyyy"], [RE_BARRA, "dd/MM/yyyy"]] as const) {
    if (!v.every((x) => re.test(x))) continue;
    let primeiroMaior12 = false, segundoMaior12 = false;
    for (const x of v) {
      const m = re.exec(x)!;
      if (Number(m[1]) > 12) primeiroMaior12 = true;
      if (Number(m[2]) > 12) segundoMaior12 = true;
    }
    if (re === RE_BARRA && segundoMaior12 && !primeiroMaior12) return { formato: "MM/dd/yyyy", ambiguo: false };
    return { formato, ambiguo: !primeiroMaior12 && !segundoMaior12 };
  }
  return { formato: null, ambiguo: false };
}

/** Atalho compatível: só o formato. Use `analisarFormatoData` quando precisar saber se foi ambíguo. */
export function detectarFormatoData(valores: string[]): FormatoData | null {
  return analisarFormatoData(valores).formato;
}

const temHorario = (x: string) => /[T\s]\d{1,2}[:h]\d{2}/i.test(x.trim());

/**
 * Mapeia cabeçalhos → campos canônicos por sinônimos, sem IA.
 * `linhas` = TODAS as linhas do arquivo (o formato de data é decidido sobre todas).
 * Retorna null se faltar nome, telefone, atendimento ou data (data+hora ou data_hora).
 * `formatoDataAmbiguo: true` → assumido dd/MM; a triagem deve pedir confirmação.
 */
export function mapearPorHeuristica(
  cabecalhos: string[],
  linhas: Record<string, string>[],
): Omit<Mapeamento, "arquivoHash"> | null {
  const colunas: Partial<Record<Campo, string>> = {};
  for (const cab of cabecalhos) {
    const campo = INDICE.get(normalizarCabecalho(cab));
    if (campo && !colunas[campo]) colunas[campo] = cab;
  }

  // Só "Data" mas os valores trazem horário → é data_hora.
  if (!colunas.data_hora && colunas.data && !colunas.hora) {
    const valores = linhas.map((l) => l[colunas.data!] ?? "").filter(Boolean);
    if (valores.length > 0 && valores.every((x) => temHorario(x) || /^\d+\.\d+$/.test(x))) {
      colunas.data_hora = colunas.data;
      delete colunas.data;
    }
  }

  const temData = Boolean(colunas.data_hora) || Boolean(colunas.data && colunas.hora);
  if (!colunas.nome || !colunas.telefone || !colunas.atendimento || !temData) return null;

  const colunaData = colunas.data_hora ?? colunas.data!;
  const { formato, ambiguo } = analisarFormatoData(linhas.map((l) => l[colunaData] ?? ""));

  return { colunas, formatoData: formato, origem: "heuristica", ...(ambiguo ? { formatoDataAmbiguo: true } : {}) };
}
