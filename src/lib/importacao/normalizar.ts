import { normalizarTelefone } from "../telefone";
import { mask } from "../whatsapp";
import {
  CAMPOS, LinhaAgenda, Mapeamento,
  type Campo, type FORMATOS_DATA, type LinhaInvalida, type ResultadoImportacao,
} from "./tipos";

type FormatoData = (typeof FORMATOS_DATA)[number];

type Data = { y: number; m: number; d: number };
type Hora = { hh: number; mm: number };

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function dataValida({ y, m, d }: Data): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function ano(s: string): number {
  const n = Number(s);
  return s.length === 2 ? 2000 + n : n;
}

/**
 * Converte serial do Excel (dias desde 1899-12-30, fração = horário).
 * Fração que arredonda para 1440 min vira 00:00 do dia seguinte.
 */
function deSerial(v: number): { data: Data; hora: Hora | null } {
  let dias = Math.floor(v);
  const temFracao = v !== dias;
  let minutos = Math.round((v - dias) * 1440);
  if (minutos >= 1440) { dias += 1; minutos -= 1440; }
  const dt = new Date(Date.UTC(1899, 11, 30) + dias * 86_400_000);
  return {
    data: { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() },
    hora: temFracao ? { hh: Math.floor(minutos / 60), mm: minutos % 60 } : null,
  };
}

// ---------- Hora ----------

/** `invalida`: não é um horário. `formato`: começa como horário mas tem sufixo que não reconhecemos. */
export type LeituraHora = { ok: true; hora: Hora } | { ok: false; erro: "invalida" | "formato" };

const RE_HORA = /^(\d{1,2})\s*[:hH]\s*(\d{2})?(?::\d{2})?\s*(.*)$/;
/** Sufixos neutros comuns em agendas brasileiras: "08:00h", "9h45min". */
const RE_SUFIXO_NEUTRO = /^(?:h|hs|hrs|min)$/i;
const RE_AMPM = /^([ap])\.?\s*m\.?$/i;
/** "08:00 - 08:30", "8h às 8h30", "08:00–08:30": fica o início. */
const RE_INTERVALO = /^(.+?)\s*(?:[-–—]|\s(?:a|às|as|até|ate)\s)\s*(\d.*)$/i;

function lerHoraSimples(s: string): LeituraHora {
  const m = RE_HORA.exec(s.trim());
  if (!m) return { ok: false, erro: "invalida" };
  let hh = Number(m[1]);
  const mm = Number(m[2] ?? 0);
  const sufixo = m[3].trim();
  if (mm > 59) return { ok: false, erro: "invalida" };
  if (sufixo === "" || RE_SUFIXO_NEUTRO.test(sufixo)) {
    return hh > 23 ? { ok: false, erro: "invalida" } : { ok: true, hora: { hh, mm } };
  }
  const ap = RE_AMPM.exec(sufixo);
  if (!ap) return { ok: false, erro: "formato" };
  if (hh < 1 || hh > 12) return { ok: false, erro: "invalida" };
  const pm = ap[1].toLowerCase() === "p";
  if (hh === 12) hh = pm ? 12 : 0; // 12 AM = 00, 12 PM = 12
  else if (pm) hh += 12;
  return { ok: true, hora: { hh, mm } };
}

/** Lê um horário. Aceita "08:00", "8h", "9h45", "08:00:00", "2:30 PM", "08:00 - 08:30" (início) e fração de dia. */
export function analisarHora(bruto: string): LeituraHora {
  const s = bruto.trim();
  if (!s) return { ok: false, erro: "invalida" };
  if (/^0?\.\d+$/.test(s)) { // fração de dia (célula de horário exportada como número)
    const min = Math.min(Math.round(Number(s) * 1440), 1439); // sem dia para avançar: 23:59:59.x fica 23:59
    return { ok: true, hora: { hh: Math.floor(min / 60), mm: min % 60 } };
  }
  const intervalo = RE_INTERVALO.exec(s);
  if (intervalo) {
    const inicio = lerHoraSimples(intervalo[1]);
    const fim = lerHoraSimples(intervalo[2]);
    if (!inicio.ok) return inicio;
    return fim.ok ? inicio : { ok: false, erro: "formato" };
  }
  return lerHoraSimples(s);
}

export function parseHora(bruto: string): Hora | null {
  const r = analisarHora(bruto);
  return r.ok ? r.hora : null;
}

// ---------- Data ----------

type LeituraDataHora =
  | { ok: true; data: Data; hora: Hora | null }
  | { ok: false; erro: "data" | "hora_invalida" | "hora_formato" };

function lerDataHora(bruto: string, formato: FormatoData | null): LeituraDataHora {
  const s = bruto.trim();
  if (!s) return { ok: false, erro: "data" };

  if (/^\d+(\.\d+)?$/.test(s)) {
    const v = Number(s);
    if (formato === "serial_excel" || (v > 20000 && v < 80000)) {
      const r = deSerial(v);
      return dataValida(r.data) ? { ok: true, ...r } : { ok: false, erro: "data" };
    }
    return { ok: false, erro: "data" };
  }

  let data: Data;
  let resto: string;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/.exec(s))) {
    data = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
    // ISO pode trazer offset colado ao horário ("T08:00:00-03:00"); o fuso que vale é o da clínica
    resto = m[4].replace(/(?<=\d)(Z|[+-]\d{2}:?\d{2})$/, "");
  } else if ((m = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})(.*)$/.exec(s))) {
    const a = Number(m[1]), b = Number(m[3]);
    const mesPrimeiro = formato === "MM/dd/yyyy";
    data = mesPrimeiro ? { y: ano(m[4]), m: a, d: b } : { y: ano(m[4]), m: b, d: a };
    resto = m[5];
  } else {
    return { ok: false, erro: "data" };
  }
  if (!dataValida(data)) return { ok: false, erro: "data" };

  resto = resto.replace(/^[T\s,-]+/, "").trim();
  if (!resto) return { ok: true, data, hora: null };
  const h = analisarHora(resto);
  if (h.ok) return { ok: true, data, hora: h.hora };
  return { ok: false, erro: h.erro === "formato" ? "hora_formato" : "hora_invalida" };
}

/** Lê a data (e o horário, se vier na mesma célula). Valores ISO são aceitos sempre (vêm de células de data). */
export function parseDataHora(bruto: string, formato: FormatoData | null): { data: Data; hora: Hora | null } | null {
  const r = lerDataHora(bruto, formato);
  return r.ok ? { data: r.data, hora: r.hora } : null;
}

// ---------- Fuso ----------

const formatadores = new Map<string, Intl.DateTimeFormat>();

/** Lança RangeError se o fuso IANA não existir. */
function formatador(fuso: string): Intl.DateTimeFormat {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatadores.set(fuso, f);
  }
  return f;
}

/** Data e hora de parede no fuso, para um instante (ms desde epoch). */
function paredeNoFuso(instante: number, fuso: string) {
  const p: Record<string, number> = {};
  for (const { type, value } of formatador(fuso).formatToParts(new Date(instante))) {
    if (type !== "literal") p[type] = Number(value);
  }
  return { y: p.year, m: p.month, d: p.day, hh: p.hour, mm: p.minute, ss: p.second };
}

function offsetMinutosNoInstante(instante: number, fuso: string): number {
  const t = Math.floor(instante / 1000) * 1000;
  const w = paredeNoFuso(t, fuso);
  return Math.round((Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm, w.ss) - t) / 60_000);
}

/**
 * Offset ("-03:00") do fuso IANA para a data/hora de parede informada, calculado pelo Intl (sem tabela fixa),
 * então continua certo se algum estado voltar a ter horário de verão.
 */
export function offsetDoFuso(fuso: string, data: Data, hora: Hora): string {
  const parede = Date.UTC(data.y, data.m - 1, data.d, hora.hh, hora.mm);
  let off = offsetMinutosNoInstante(parede, fuso);
  off = offsetMinutosNoInstante(parede - off * 60_000, fuso); // segunda passada acerta perto de transições
  const sinal = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return `${sinal}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function montarIso(data: Data, hora: Hora, fuso: string): string {
  return `${pad(data.y, 4)}-${pad(data.m)}-${pad(data.d)}T${pad(hora.hh)}:${pad(hora.mm)}:00${offsetDoFuso(fuso, data, hora)}`;
}

const chaveData = ({ y, m, d }: Data) => y * 10_000 + m * 100 + d;

// ---------- Exibição (LGPD) ----------

const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e", "di", "du"]);

/** "Aurora Bittencourt Lago" → "Aurora B."; "Maria da Silva" → "Maria S."; nome único fica como está. */
export function abreviarNome(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "";
  const sobrenome = partes.slice(1).find((p) => !PARTICULAS.has(p.toLowerCase()));
  return sobrenome ? `${partes[0]} ${sobrenome[0].toUpperCase()}.` : partes[0];
}

/** Telefone normalizável → "(11) 9****-1234"; senão só os 4 últimos dígitos: "****-1234". */
export function mascararTelefoneExibicao(bruto: string): string {
  if (!bruto.trim()) return "";
  const e164 = normalizarTelefone(bruto);
  if (e164) return mask(e164);
  const d = bruto.replace(/\D/g, "");
  return d.length >= 4 ? `****-${d.slice(-4)}` : "****";
}

/**
 * Única forma de levar o `bruto` de uma linha inválida à UI: telefone mascarado e nome reduzido
 * a primeiro nome + inicial. Os demais campos canônicos seguem como vieram.
 */
export function paraExibicao(invalida: LinhaInvalida): Partial<Record<Campo, string>> {
  const out: Partial<Record<Campo, string>> = { ...invalida.bruto };
  if (out.telefone !== undefined) out.telefone = mascararTelefoneExibicao(out.telefone);
  if (out.nome !== undefined) out.nome = abreviarNome(out.nome);
  return out;
}

// ---------- Aplicação do mapeamento ----------

export type OpcoesImportacao = {
  /** Fuso IANA da clínica (`clinicas.fuso`), ex.: "America/Sao_Paulo", "America/Manaus". */
  fuso: string;
  /** Instante de referência para "data no passado". Padrão: agora. Injetável em testes. */
  agora?: Date;
};

export const AVISO_DATA_AMBIGUA =
  "Nenhuma data do arquivo tem dia maior que 12: assumimos dia/mês (dd/MM). Confira algumas linhas antes de enviar.";

const vazioParaNull = (s: string) => (s ? s : null);

/**
 * Aplica o mapeamento às linhas brutas e separa válidas/inválidas (motivo em português, para a triagem).
 * `linha` = número da linha na planilha, assumindo cabeçalho na linha 1.
 * Inválidas carregam só as colunas mapeadas (ver `LinhaInvalida`); colunas extras nunca saem daqui.
 */
export function aplicarMapeamento(
  linhas: Record<string, string>[],
  mapeamento: Mapeamento,
  opcoes: OpcoesImportacao,
): ResultadoImportacao {
  const map = Mapeamento.parse(mapeamento);
  const { fuso } = opcoes;
  try {
    formatador(fuso);
  } catch {
    throw new Error(`Fuso inválido: ${fuso}`);
  }
  const agora = opcoes.agora ?? new Date();
  const hojeW = paredeNoFuso(agora.getTime(), fuso);
  const hoje = chaveData({ y: hojeW.y, m: hojeW.m, d: hojeW.d });

  const col = (l: Record<string, string>, campo: Campo) => {
    const nome = map.colunas[campo];
    return nome ? (l[nome] ?? "").toString().trim() : "";
  };
  /** Só os campos mapeados (campo canônico → texto original da célula, sem espaços nas bordas). */
  const soMapeadas = (l: Record<string, string>): Partial<Record<Campo, string>> => {
    const out: Partial<Record<Campo, string>> = {};
    for (const campo of CAMPOS) if (map.colunas[campo]) out[campo] = col(l, campo);
    return out;
  };

  const resultado: ResultadoImportacao = {
    mapeamento: map,
    validas: [],
    invalidas: [],
    avisos: map.formatoDataAmbiguo ? [AVISO_DATA_AMBIGUA] : [],
  };

  linhas.forEach((original, i) => {
    const linha = i + 2;
    const motivos: string[] = [];

    const nome = col(original, "nome").replace(/\s+/g, " ");
    if (!nome) motivos.push("Nome vazio");
    else if (nome.length < 2) motivos.push("Nome muito curto");

    const telBruto = col(original, "telefone");
    const telefone = telBruto ? normalizarTelefone(telBruto) : null;
    if (!telBruto) motivos.push("Telefone vazio");
    else if (!telefone) motivos.push("Telefone inválido ou sem DDD");

    const atendimento = col(original, "atendimento");
    if (!atendimento) motivos.push("Atendimento vazio");

    let dataHora: string | null = null;
    const usaDataHora = Boolean(map.colunas.data_hora);
    const valorData = usaDataHora ? col(original, "data_hora") : col(original, "data");
    const valorHora = col(original, "hora");
    if (!valorData) {
      motivos.push(usaDataHora ? "Data/hora vazia" : "Data vazia");
    } else {
      const lida = lerDataHora(valorData, map.formatoData);
      if (!lida.ok) {
        if (lida.erro === "hora_formato") motivos.push("Hora em formato não reconhecido");
        else motivos.push(usaDataHora ? "Data/hora inválida" : "Data inválida");
      } else if (chaveData(lida.data) < hoje) {
        motivos.push("Data no passado");
      } else {
        let hora = lida.hora;
        if (!hora) {
          if (!valorHora) motivos.push("Hora vazia");
          else {
            const h = analisarHora(valorHora);
            if (h.ok) hora = h.hora;
            else motivos.push(h.erro === "formato" ? "Hora em formato não reconhecido" : "Hora inválida");
          }
        }
        if (hora) dataHora = montarIso(lida.data, hora, fuso);
      }
    }

    if (motivos.length > 0) {
      resultado.invalidas.push({ linha, bruto: soMapeadas(original), motivo: motivos.join("; ") });
      return;
    }

    const parsed = LinhaAgenda.safeParse({
      nome,
      telefone,
      atendimento,
      profissional: vazioParaNull(col(original, "profissional")),
      dataHora,
      tipo: vazioParaNull(col(original, "tipo")),
      chaveExterna: vazioParaNull(col(original, "chave_externa")),
    });
    if (parsed.success) resultado.validas.push({ linha, dados: parsed.data });
    else resultado.invalidas.push({
      linha,
      bruto: soMapeadas(original),
      motivo: `Dados inválidos: ${parsed.error.issues.map((x) => x.path.join(".")).join(", ")}`,
    });
  });

  return resultado;
}
