import { createHash } from "node:crypto";
// SheetJS 0.20.x instalado do CDN oficial (cdn.sheetjs.com): o pacote "xlsx" do npm parou na 0.18.5 com CVEs
// abertas, e exceljs não lê .xls legado, que clínicas ainda exportam.
import * as XLSX from "xlsx";
import Papa from "papaparse";

export type ArquivoTabular = {
  cabecalhos: string[];
  linhas: Record<string, string>[];
  /** sha256 hex do buffer original — chave do cache do mapeamento. */
  hash: string;
};

export class FormatoNaoSuportadoError extends Error {
  constructor(nome: string) {
    super(`Formato de arquivo não suportado: ${nome}. Envie .xlsx, .xls, .csv ou .pdf.`);
    this.name = "FormatoNaoSuportadoError";
  }
}

export function hashArquivo(buffer: Buffer | Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function extensao(nome: string): string {
  const i = nome.lastIndexOf(".");
  return i < 0 ? "" : nome.slice(i + 1).toLowerCase();
}

/** Lê planilha (.xlsx/.xls) ou CSV. PDF usa `extrairTextoPdf`. */
export function lerArquivo(buffer: Buffer, nomeArquivo: string): ArquivoTabular {
  const ext = extensao(nomeArquivo);
  const hash = hashArquivo(buffer);
  if (ext === "xlsx" || ext === "xls") return { ...lerPlanilha(buffer), hash };
  if (ext === "csv" || ext === "txt") return { ...lerCsv(buffer), hash };
  throw new FormatoNaoSuportadoError(nomeArquivo);
}

// ---------- CSV ----------

function decodificarTexto(buffer: Buffer): string {
  let texto = new TextDecoder("utf-8").decode(buffer);
  // exportações antigas costumam vir em Windows-1252; o UTF-8 inválido vira U+FFFD
  if (texto.includes("�")) texto = new TextDecoder("windows-1252").decode(buffer);
  return texto.replace(/^﻿/, "");
}

function lerCsv(buffer: Buffer): Omit<ArquivoTabular, "hash"> {
  const texto = decodificarTexto(buffer);
  const r = Papa.parse<string[]>(texto, {
    delimiter: "", // auto-detecção entre , ; \t |
    skipEmptyLines: "greedy",
  });
  return montarTabela(r.data);
}

// ---------- Planilha ----------

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Dia 0 de cada sistema de datas do Excel. 1900: 1899-12-30 (já absorve o falso 29/02/1900). 1904: 1904-01-01. */
const EPOCA_1900 = Date.UTC(1899, 11, 30);
const EPOCA_1904 = Date.UTC(1904, 0, 1);

/**
 * Converte célula numérica com formato de data/hora em texto ISO-like, sem passar por fuso.
 * Fração que arredonda para 1440 min (ex.: 23:59:59.9) vira 00:00 do dia seguinte.
 * `date1904`: pasta de trabalho no sistema de datas 1904 (Excel antigo de Mac).
 */
export function celulaDataParaTexto(serial: number, date1904 = false): string {
  let dias = Math.floor(serial);
  const temFracao = serial !== dias;
  let minutosTotais = Math.round((serial - dias) * 24 * 60);
  if (dias === 0) {
    // célula só de horário (0.xxx nos dois sistemas): não há dia para avançar, 23:59:59.x fica 23:59
    const m = Math.min(minutosTotais, 1439);
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  }
  if (minutosTotais >= 1440) { dias += 1; minutosTotais -= 1440; }
  const hora = `${pad(Math.floor(minutosTotais / 60))}:${pad(minutosTotais % 60)}`;
  const d = new Date((date1904 ? EPOCA_1904 : EPOCA_1900) + dias * 86_400_000);
  const data = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return temFracao ? `${data} ${hora}` : data;
}

function celulaParaTexto(cell: XLSX.CellObject | undefined, date1904: boolean): string {
  if (!cell || cell.v === undefined || cell.v === null) return "";
  if (cell.t === "n" && typeof cell.v === "number") {
    if (cell.z && XLSX.SSF.is_date(cell.z)) return celulaDataParaTexto(cell.v, date1904);
    return Number.isInteger(cell.v) ? cell.v.toFixed(0) : String(cell.v);
  }
  if (cell.t === "b") return cell.v ? "VERDADEIRO" : "FALSO";
  if (cell.t === "e") return "";
  return String(cell.v).trim();
}

function lerPlanilha(buffer: Buffer): Omit<ArquivoTabular, "hash"> {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false, cellNF: true });
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904);
  const nomeAba = wb.SheetNames[0];
  const ws = nomeAba ? wb.Sheets[nomeAba] : undefined;
  if (!ws || !ws["!ref"]) return { cabecalhos: [], linhas: [] };
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const matriz: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const linha: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) linha.push(celulaParaTexto(ws[XLSX.utils.encode_cell({ r, c })], date1904));
    matriz.push(linha);
  }
  return montarTabela(matriz);
}

// ---------- comum ----------

/** Primeira linha não vazia vira cabeçalho; linhas totalmente vazias são descartadas. */
function montarTabela(matriz: string[][]): Omit<ArquivoTabular, "hash"> {
  const limpa = matriz.map((l) => l.map((v) => (v ?? "").toString().trim()));
  const iCab = limpa.findIndex((l) => l.some((v) => v !== ""));
  if (iCab < 0) return { cabecalhos: [], linhas: [] };

  const vistos = new Map<string, number>();
  const cabecalhos = limpa[iCab].map((h, i) => {
    const base = h || `coluna_${i + 1}`;
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });

  const linhas: Record<string, string>[] = [];
  for (const l of limpa.slice(iCab + 1)) {
    if (!l.some((v) => v !== "")) continue;
    const obj: Record<string, string> = {};
    cabecalhos.forEach((h, i) => { obj[h] = l[i] ?? ""; });
    linhas.push(obj);
  }
  return { cabecalhos, linhas };
}

// ---------- PDF ----------

/** Só extrai o texto do PDF (todas as páginas). A interpretação fica com o harness de IA. */
export async function extrairTextoPdf(buffer: Buffer | Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}
