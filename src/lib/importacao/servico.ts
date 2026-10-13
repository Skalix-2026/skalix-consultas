import type { CacheIA } from "@/ai/cache";
import type { mapearColunas as MapearColunas, ResultadoMapeamento } from "@/ai/harness/mapear-colunas";
import { SemCabecalhoError } from "@/ai/harness/mapear-colunas";
import type { extrairAgendaPdf as ExtrairAgendaPdf, ResultadoPdf } from "@/ai/harness/extrair-agenda-pdf";
import type { LoteResumo, NovoLote } from "@/db/queries/lotes";
import type { ErroImportar, RespostaImportar } from "@/lib/schemas-importar";
import { LIMITE_BYTES } from "@/lib/schemas-importar";
import { hashArquivo, lerArquivo } from "./ler-arquivo";
import { mapearPorHeuristica } from "./heuristica";
import { aplicarMapeamento, paraExibicao } from "./normalizar";
import type { Mapeamento } from "./tipos";

/**
 * Pipeline de importação: arquivo -> mapeamento -> linhas válidas/inválidas -> lote.
 * Banco e IA entram por `DepsImportacao` (testes não tocam banco nem Anthropic).
 *
 * Custo de IA: no máximo UMA chamada por arquivo (Haiku para mapear OU Sonnet para PDF), e nenhuma se o
 * hash do arquivo já tem lote. Nada de IA em loop.
 */

export const EXTENSOES = ["xlsx", "xls", "csv", "pdf"] as const;
export const LIMITE_INVALIDAS_NA_RESPOSTA = 200;
const CONFIANCA_MINIMA = 0.85;

export function extensaoSuportada(nome: string): boolean {
  const i = nome.lastIndexOf(".");
  const ext = i < 0 ? "" : nome.slice(i + 1).toLowerCase();
  return (EXTENSOES as readonly string[]).includes(ext);
}

export type DepsImportacao = {
  buscarLotePorHash(clinicaId: string, hash: string): Promise<LoteResumo | null>;
  criarLote(n: NovoLote): Promise<{ loteId: string; inseridas: number; duplicadas: number }>;
  mapearColunas: typeof MapearColunas;
  extrairAgendaPdf: typeof ExtrairAgendaPdf;
  extrairTextoPdf(buffer: Buffer): Promise<string>;
  agora?: () => Date;
};

export type ResultadoServico = { status: number; corpo: RespostaImportar };

type Invalidas = Extract<RespostaImportar, { ok: true }>["invalidas"];

const falha = (
  status: number,
  erro: ErroImportar,
  mensagem: string,
  extra: { invalidas?: Invalidas; avisos?: string[] } = {},
): ResultadoServico => ({ status, corpo: { ok: false, erro, mensagem, ...extra } });

/** Cache só de memória: a deduplicação real é por hash em `lotes` (checada antes de qualquer IA). */
const semCache = <T>(): CacheIA<T> => ({ get: async () => null, set: async () => {} });

const temColunasObrigatorias = (m: Mapeamento) =>
  Boolean(
    m.colunas.nome && m.colunas.telefone && m.colunas.atendimento &&
      (m.colunas.data_hora || (m.colunas.data && m.colunas.hora)),
  );

export async function importarAgenda(
  deps: DepsImportacao,
  entrada: { buffer: Buffer; nomeArquivo: string; clinica: { id: string; fuso: string } },
): Promise<ResultadoServico> {
  const { buffer, nomeArquivo, clinica } = entrada;
  if (buffer.length > LIMITE_BYTES) return falha(413, "arquivo_grande", "Arquivo acima de 5 MB.");
  if (!extensaoSuportada(nomeArquivo)) {
    return falha(415, "formato_invalido", "Formato não suportado. Envie .xlsx, .xls, .csv ou .pdf.");
  }

  // 1) Cache por hash: mesmo arquivo da mesma clínica -> lote existente, sem reprocessar nem chamar IA.
  const arquivoHash = hashArquivo(buffer);
  const existente = await deps.buscarLotePorHash(clinica.id, arquivoHash);
  if (existente) {
    if (existente.linhasValidas === 0) {
      // arquivo já analisado e sem nenhuma linha válida: mesma resposta, sem reprocessar nem pagar IA de novo
      return falha(422, "nenhuma_linha_valida", "Este arquivo já foi analisado e não tem nenhuma linha válida. Corrija o arquivo e envie de novo.", {
        invalidas: [], avisos: ["Os motivos das linhas inválidas não são guardados; corrija o arquivo para ver a nova análise."],
      });
    }
    return {
      status: 200,
      corpo: {
        ok: true, loteId: existente.id, reaproveitado: true,
        totalLinhas: existente.totalLinhas, validas: existente.linhasValidas, duplicadas: 0, invalidas: [],
        avisos: ["Este arquivo já foi importado: reaproveitamos o lote existente."],
      },
    };
  }

  const agora = deps.agora?.() ?? new Date();
  let linhas: Record<string, string>[];
  let mapeamento: Mapeamento;
  const avisos: string[] = [];

  if (nomeArquivo.toLowerCase().endsWith(".pdf")) {
    // 2a) PDF: texto local + Sonnet (uma chamada)
    let texto: string;
    try { texto = await deps.extrairTextoPdf(buffer); }
    catch { return falha(422, "arquivo_ilegivel", "Não foi possível ler o PDF."); }
    if (!texto.trim()) {
      return falha(422, "pdf_sem_texto", "O PDF não tem texto selecionável (parece escaneado). Envie Excel/CSV ou um PDF digital.");
    }
    try {
      const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: clinica.fuso }).format(agora); // yyyy-MM-dd
      const r: ResultadoPdf = await deps.extrairAgendaPdf(
        { arquivoHash, texto, dataReferencia: hoje },
        semCache<ResultadoPdf>(),
      );
      linhas = r.linhas;
      mapeamento = r.mapeamento;
      avisos.push(...r.avisos);
    } catch (e) {
      console.error("[importar] extração do PDF falhou", { erro: (e as Error).name });
      return falha(422, "extracao_falhou", "Não foi possível extrair a agenda do PDF. Se for muito grande, divida o arquivo; ou envie Excel/CSV.");
    }
  } else {
    // 2b) Planilha/CSV: heurística; Haiku só se ela falhar
    let tabela;
    try { tabela = lerArquivo(buffer, nomeArquivo); }
    catch { return falha(422, "arquivo_ilegivel", "Não foi possível ler o arquivo."); }
    if (tabela.cabecalhos.length === 0 || tabela.linhas.length === 0) {
      return falha(422, "arquivo_vazio", "O arquivo não tem linhas de agenda.");
    }
    linhas = tabela.linhas;
    const heuristica = mapearPorHeuristica(tabela.cabecalhos, tabela.linhas);
    if (heuristica) {
      mapeamento = { ...heuristica, arquivoHash };
    } else {
      try {
        const r: ResultadoMapeamento = await deps.mapearColunas(
          { arquivoHash, cabecalhos: tabela.cabecalhos, amostra: tabela.linhas.slice(0, 3) },
          semCache<ResultadoMapeamento>(),
        );
        mapeamento = r;
        if (r.confianca < CONFIANCA_MINIMA) {
          avisos.push("O mapeamento das colunas tem baixa confiança: confira as linhas na triagem antes de enviar.");
        }
      } catch (e) {
        if (e instanceof SemCabecalhoError) {
          return falha(422, "sem_cabecalho", "A primeira linha do arquivo parece dado, não cabeçalho. Adicione uma linha de cabeçalho (Nome, Telefone, Atendimento, Data, Hora).");
        }
        console.error("[importar] mapeamento falhou", { erro: (e as Error).name });
        return falha(422, "mapeamento_falhou", "Não foi possível identificar as colunas do arquivo.");
      }
      if (!temColunasObrigatorias(mapeamento)) {
        return falha(422, "mapeamento_incompleto", "Não foi possível identificar nome, telefone, atendimento e data/hora no arquivo.");
      }
    }
  }

  // 3) Normaliza com o fuso da clínica
  const r = aplicarMapeamento(linhas, mapeamento, { fuso: clinica.fuso, agora });
  avisos.push(...r.avisos);
  const invalidas = r.invalidas.slice(0, LIMITE_INVALIDAS_NA_RESPOSTA).map((i) => ({
    linha: i.linha, motivo: i.motivo, bruto: paraExibicao(i) as Record<string, string>,
  }));
  if (r.invalidas.length > invalidas.length) {
    avisos.push(`Mostrando as primeiras ${invalidas.length} de ${r.invalidas.length} linhas inválidas.`);
  }
  if (r.validas.length === 0) {
    // grava o lote vazio só para guardar o hash: o mesmo arquivo não paga IA de novo
    await deps.criarLote({
      clinicaId: clinica.id, arquivoNome: nomeArquivo.slice(0, 255), totalLinhas: linhas.length, mapeamento: r.mapeamento, validas: [],
    });
    return falha(422, "nenhuma_linha_valida", "Nenhuma linha válida no arquivo. Veja os motivos na lista.", { invalidas, avisos });
  }

  // 4) Persiste (transação): só as linhas válidas
  const { loteId, duplicadas } = await deps.criarLote({
    clinicaId: clinica.id,
    arquivoNome: nomeArquivo.slice(0, 255),
    totalLinhas: linhas.length,
    mapeamento: r.mapeamento,
    validas: r.validas.map((v) => v.dados),
  });
  if (duplicadas > 0) avisos.push(`${duplicadas} agendamento(s) já existiam e não foram inseridos de novo.`);

  return {
    status: 200,
    corpo: {
      ok: true, loteId, reaproveitado: false,
      totalLinhas: linhas.length, validas: r.validas.length, duplicadas, invalidas, avisos,
    },
  };
}
