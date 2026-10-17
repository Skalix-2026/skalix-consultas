import { z } from "zod";
import { Saida } from "../harness/classificar-resposta";

/**
 * RAG leve (sem pgvector): monta o contexto da clínica para o harness de classificação.
 * Função pura — sem banco, sem IA. Quem busca as linhas é `db/queries/conhecimento.ts`.
 *
 * Formato de `conhecimento.conteudo` por tipo:
 *  - `regra` e `faq`: texto livre (uma regra/pergunta-e-resposta por linha da tabela).
 *  - `exemplo_classificado`: JSON `{"texto":"...","intencao":"confirmou|cancelou|..."}`.
 *    Linha com JSON inválido ou intenção fora do enum é ignorada (nunca derruba a classificação).
 *
 * O conteúdo é tratado como DADO: o SYSTEM do harness manda ignorar instruções dentro de REGRAS/EXEMPLOS.
 * Aqui só higienizamos: quebras de linha viram espaço, telefones são removidos e o tamanho é limitado.
 */

export const MAX_REGRAS = 8;
export const MAX_EXEMPLOS = 10;
export const MAX_CARACTERES_ITEM = 300;

export type RegrasClinica = { prazoCancelamentoHoras?: number; preparos?: Record<string, string> };
export type LinhaConhecimento = { tipo: string; conteudo: string; criadoEm?: Date | string | null };
export type ContextoClinica = { regras: string[]; exemplos: { texto: string; intencao: string }[] };

const ExemploJson = z.object({ texto: z.string().min(1), intencao: Saida.shape.intencao });

/** Minúsculas, sem acento, espaços colapsados. */
export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Uma linha só, sem telefones (sequências de 8+ dígitos, com ou sem máscara), truncada. */
export function higienizar(s: string): string {
  const limpo = s
    .replace(/\+?\(?\d[\d\s().-]*\d/g, (m) => (m.replace(/\D/g, "").length >= 8 ? "[telefone removido]" : m))
    .replace(/\s+/g, " ")
    .trim();
  return limpo.length > MAX_CARACTERES_ITEM ? `${limpo.slice(0, MAX_CARACTERES_ITEM - 1)}…` : limpo;
}

function tempo(d: Date | string | null | undefined): number {
  if (!d) return 0;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Ordenação determinística: criadoEm crescente; empate pelo conteúdo. */
function ordenar(linhas: LinhaConhecimento[]): LinhaConhecimento[] {
  return [...linhas].sort((a, b) => tempo(a.criadoEm) - tempo(b.criadoEm) || a.conteudo.localeCompare(b.conteudo));
}

/** Preparo só do atendimento em questão: includes nos dois sentidos após normalizar. */
function preparosCasados(preparos: Record<string, string>, atendimento: string): string[] {
  const alvo = normalizar(atendimento);
  if (!alvo) return [];
  return Object.entries(preparos)
    .filter(([chave, texto]) => {
      const k = normalizar(chave);
      return k !== "" && typeof texto === "string" && texto.trim() !== "" && (alvo.includes(k) || k.includes(alvo));
    })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([chave, texto]) => `Preparo para ${chave}: ${texto}`);
}

export function montarContexto(d: {
  regras?: RegrasClinica | null;
  conhecimento: LinhaConhecimento[];
  atendimento: string;
}): ContextoClinica {
  const regras: string[] = [];

  const prazo = d.regras?.prazoCancelamentoHoras;
  if (typeof prazo === "number" && Number.isFinite(prazo) && prazo > 0) {
    regras.push(`Cancelamento até ${Math.round(prazo)} horas antes da consulta.`);
  }
  if (d.regras?.preparos && typeof d.regras.preparos === "object") {
    regras.push(...preparosCasados(d.regras.preparos, d.atendimento));
  }

  const ordenadas = ordenar(d.conhecimento);
  for (const l of ordenadas) {
    if (l.tipo === "regra" || l.tipo === "faq") regras.push(l.conteudo);
  }

  const exemplos: ContextoClinica["exemplos"] = [];
  for (const l of ordenadas) {
    if (l.tipo !== "exemplo_classificado") continue;
    let bruto: unknown;
    try { bruto = JSON.parse(l.conteudo); } catch { continue; }
    const ok = ExemploJson.safeParse(bruto);
    if (!ok.success) continue;
    const texto = higienizar(ok.data.texto);
    if (texto) exemplos.push({ texto, intencao: ok.data.intencao });
  }

  return {
    regras: regras.map(higienizar).filter(Boolean).slice(0, MAX_REGRAS),
    exemplos: exemplos.slice(0, MAX_EXEMPLOS),
  };
}
