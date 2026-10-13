import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { Campo, CAMPOS, FORMATOS_DATA, Mapeamento } from "@/lib/importacao/tipos";
import { MODELO_MAPEAMENTO } from "../modelos";
import { registrarUso } from "../custo";
import { extrairJson, textoDaResposta } from "../json";
import { REGEX_CPF, REGEX_SEQUENCIA_LONGA, REGEX_TELEFONE_BR, mascararCabecalho, mascararValor } from "../privacidade";
import { type CacheIA, REGEX_SHA256, gravarNoCache } from "../cache";

/**
 * Harness: mapear colunas de Excel/CSV para os campos canônicos — FALLBACK quando a heurística de sinônimos falha.
 * Entrada validada → cache → cabeçalho parece dado? (SemCabecalhoError) → só a FORMA dos valores → Haiku
 * → saída validada → mapeamento. O modelo NÃO escreve no banco.
 *
 * Cache OBRIGATÓRIO (`cache`, chave = `arquivoHash`): hit → devolve sem chamar o modelo; `set` só em sucesso.
 * `SemCabecalhoError` → o chamador manda o arquivo à triagem (mapeamento manual); o modelo não foi chamado.
 * `confianca < 0.85` → o chamador deve pedir confirmação do mapeamento na tela de triagem.
 */

const TAREFA = "mapear-colunas";

export const Entrada = z.object({
  arquivoHash: z.string().regex(REGEX_SHA256, "arquivoHash deve ser o sha256 (hex) do arquivo"),
  cabecalhos: z.array(z.string().min(1).max(200)).min(1).max(40),
  amostra: z.array(z.record(z.string(), z.string())).max(3),
});
export type Entrada = z.input<typeof Entrada>;

export const Saida = z.object({
  colunas: z.partialRecord(Campo, z.string()),
  formatoData: z.enum(FORMATOS_DATA).nullable(),
  confianca: z.number().min(0).max(1),
});
export type Saida = z.infer<typeof Saida>;

/** Pronto para gravar em `lotes.mapeamento_colunas` (já traz `arquivoHash`). */
export const ResultadoMapeamento = Mapeamento.extend({ confianca: z.number().min(0).max(1) });
export type ResultadoMapeamento = z.infer<typeof ResultadoMapeamento>;

/**
 * O arquivo não tem linha de cabeçalho (a 1ª linha parece dado de paciente). Lançado ANTES de chamar o modelo.
 * Carrega só os índices (base 0) das colunas suspeitas — nunca o conteúdo.
 */
export class SemCabecalhoError extends Error {
  readonly indices: number[];
  constructor(indices: number[]) {
    super(
      `${TAREFA}: a 1ª linha parece dado, não cabeçalho (colunas ${indices.map((i) => i + 1).join(", ")}); mapear na triagem`,
    );
    this.name = "SemCabecalhoError";
    this.indices = indices;
  }
}

/** Palavras típicas de cabeçalho de agenda (sem acento, minúsculas). */
const PALAVRAS_CABECALHO = new Set([
  "nome", "paciente", "pacientes", "cliente", "beneficiario", "data", "dia", "dt", "hora", "horario", "hr", "inicio", "fim",
  "fone", "telefone", "tel", "celular", "cel", "whatsapp", "whats", "contato", "email",
  "medico", "medica", "profissional", "prestador", "doutor", "responsavel", "especialidade",
  "exame", "exames", "procedimento", "atendimento", "servico", "tipo", "convenio", "plano",
  "codigo", "cod", "id", "agenda", "agendamento", "marcacao", "status", "situacao", "observacao", "obs",
  "unidade", "sala", "local", "setor", "recurso", "prontuario", "cpf", "idade", "nascimento", "sexo", "valor",
  "descricao", "numero", "turno", "periodo",
]);
/** Prefixos longos (curtos como "cel"/"tel" casariam nomes próprios como "Celso" ou "Telma"). */
const PREFIXOS_CABECALHO = ["telefone", "celular", "agend", "proced", "atendim", "profission", "observ", "especialid", "nascim"];

const TEM_DATA = /\d{1,4}[/.-]\d{1,2}[/.-]\d{2,4}/;
const TEM_HORA = /(?<!\d)\d{1,2}[:h]\d{2}(?!\d)/;
const SO_NUMERO_LONGO = /^\s*\d{5,}(?:[.,]\d+)?\s*$/; // serial de data do Excel, id
const semG = (r: RegExp) => new RegExp(r.source, r.flags.replace("g", ""));
const TESTES_DE_DADO = [semG(REGEX_TELEFONE_BR), semG(REGEX_CPF), semG(REGEX_SEQUENCIA_LONGA), TEM_DATA, TEM_HORA, SO_NUMERO_LONGO, /@/];

/**
 * Cabeçalho que parece dado de paciente: telefone, data, hora, CPF, e-mail, número longo, ou 2+ palavras com
 * inicial maiúscula sem nenhuma palavra típica de cabeçalho ("Maria Souza", "Dr. João Pereira").
 */
export function cabecalhoPareceDado(cabecalho: string): boolean {
  if (TESTES_DE_DADO.some((r) => r.test(cabecalho))) return true;
  const normalizadas = cabecalho
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  const temPalavraChave = normalizadas.some(
    (p) => PALAVRAS_CABECALHO.has(p) || PREFIXOS_CABECALHO.some((pre) => p.startsWith(pre)),
  );
  const maiusculas = cabecalho.split(/[\s_]+/).filter((p) => /^[^\p{L}]*\p{Lu}/u.test(p)).length;
  return !temPalavraChave && maiusculas >= 2;
}

const SYSTEM = `Você mapeia colunas de planilhas de agenda de clínicas para campos canônicos.

Campos possíveis:
- nome: nome do paciente
- telefone: celular/telefone do paciente
- atendimento: consulta, exame ou procedimento agendado
- profissional: médico/profissional que atende
- data: data do agendamento
- hora: hora do agendamento
- data_hora: data e hora na MESMA coluna (use no lugar de data/hora)
- tipo: categoria (exame | consulta | procedimento)
- chave_externa: código/id do agendamento no sistema da clínica

Os valores da amostra mostram só a FORMA do dado: todo dígito aparece como 9 (telefone (99) 99999-9999,
data 99/99/9999, hora 99:99), e-mails como [email], textos só com a primeira palavra ou [texto].

Regras:
- Use o texto EXATO do cabeçalho, copiado da lista CABEÇALHOS. Nunca invente cabeçalho.
- Omita campos sem coluna correspondente.
- formatoData: um de ${FORMATOS_DATA.join(", ")}; null se não houver coluna de data. Números como 99999 (5 dígitos) são serial_excel.
- confianca entre 0 e 1; use < 0.85 se houver ambiguidade real.

Responda SOMENTE com JSON válido no formato:
{"colunas": {"nome": "...", "telefone": "..."}, "formatoData": "dd/MM/yyyy", "confianca": 0.0}`;

export async function mapearColunas(
  input: Entrada,
  cache: CacheIA<ResultadoMapeamento>,
  client: Anthropic = new Anthropic(),
): Promise<ResultadoMapeamento> {
  const e = Entrada.parse(input);
  const modelo = MODELO_MAPEAMENTO;

  const emCache = await cache.get(e.arquivoHash);
  if (emCache !== null) return ResultadoMapeamento.parse(emCache); // nunca reprocessar o mesmo arquivo

  // Arquivo sem linha de cabeçalho: a 1ª linha seria dado de paciente → não chama o modelo.
  const suspeitos = e.cabecalhos.flatMap((h, i) => (cabecalhoPareceDado(h) ? [i] : []));
  if (suspeitos.length) throw new SemCabecalhoError(suspeitos);

  // Cabeçalhos também vão só na forma (dígitos → 9, e-mail → [email]); guardamos o original para devolver.
  const paraOriginal = new Map<string, string>();
  const cabecalhosPrompt = e.cabecalhos.map((h) => {
    const forma = mascararCabecalho(h);
    let p = forma;
    for (let i = 2; paraOriginal.has(p); i++) p = `${forma} #${i}`;
    paraOriginal.set(p, h);
    return p;
  });

  const amostraPrompt = e.amostra.map((linha) =>
    Object.fromEntries(e.cabecalhos.map((h, i) => [cabecalhosPrompt[i], mascararValor(linha[h] ?? "")])),
  );

  const user = [
    `CABEÇALHOS: ${JSON.stringify(cabecalhosPrompt)}`,
    amostraPrompt.length
      ? `AMOSTRA (mascarada):\n${amostraPrompt.map((l) => JSON.stringify(l)).join("\n")}`
      : "AMOSTRA: (vazia)",
  ].join("\n\n");

  const res = await client.messages.create({
    model: modelo,
    max_tokens: 400,
    temperature: 0,
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
  });
  await registrarUso({ tarefa: TAREFA, modelo, usage: res.usage });

  if (res.stop_reason === "max_tokens") throw new Error(`${TAREFA}: resposta cortada por max_tokens`);
  const saida = Saida.parse(extrairJson(textoDaResposta(res), TAREFA)); // Zod: formato errado falha aqui

  const colunas: Mapeamento["colunas"] = {};
  for (const campo of CAMPOS) {
    const cab = saida.colunas[campo];
    if (cab === undefined) continue;
    const original = paraOriginal.get(cab);
    if (original === undefined) throw new Error(`${TAREFA}: a IA retornou cabeçalho inexistente para o campo "${campo}"`);
    colunas[campo] = original;
  }

  const resultado: ResultadoMapeamento = {
    colunas,
    formatoData: saida.formatoData,
    origem: "haiku",
    arquivoHash: e.arquivoHash,
    confianca: saida.confianca,
  };
  await gravarNoCache(cache, e.arquivoHash, resultado, TAREFA);
  return resultado;
}
