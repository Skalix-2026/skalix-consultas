import { mask } from "@/lib/whatsapp";

/**
 * Proteção de dados pessoais ANTES de qualquer texto chegar ao modelo.
 * Usado pelos harnesses de importação (mapear-colunas, extrair-agenda-pdf).
 */

/**
 * Telefones brasileiros em texto livre. Cobre, entre outros:
 * +55 (11) 98765-4321 · 55 11 987654321 · (11) 3333-4444 · 011 98765 4321 · 11.98765.4321 · 11987654321 · 98765-4321 · 3333-4444
 * Separadores aceitos: espaço, tab, ponto, hífen — nunca quebra de linha (não junta números de linhas diferentes).
 * Não casa CPF (sem bloco de 4 dígitos), datas (dd/MM/yyyy, yyyy-MM-dd) nem horas.
 * Formatos que escapam deste regex (ex.: "11 9876 54321") são pegos por `ocultarNumerosLongos` (fail-closed).
 */
export const REGEX_TELEFONE_BR =
  /(?<!\d)(?:\+?[ \t]?55[ \t.-]?)?(?:(?:\([ \t]?0?\d{2}[ \t]?\)|0?\d{2})[ \t.-]?)?(?:9[ \t.-]?\d{4}|\d{4})[ \t.-]?\d{4}(?!\d)/g;

/** Substitui cada telefone encontrado pelo retorno de `fn`. */
export function substituirTelefones(texto: string, fn: (telefone: string) => string): string {
  return texto.replace(new RegExp(REGEX_TELEFONE_BR.source, "g"), fn);
}

/** Mascara no padrão de UI/log do projeto: `(11) 9****-1234`; sem DDD → `****-1234`. NÃO usar para texto que vai ao modelo. */
export function mascararTelefone(bruto: string): string {
  const d = bruto.replace(/\D/g, "");
  return d.length >= 10 ? mask(d) : `****-${d.slice(-4)}`;
}

/** Forma dos dígitos: todo dígito vira `9` (`123.456.789-00` → `999.999.999-99`, `14:30` → `99:99`). */
export function formaDosDigitos(texto: string): string {
  return texto.replace(/\p{Nd}/gu, "9");
}

/** Token com `@` (e-mail, @usuario) → `[email]`. */
const TOKEN_EMAIL = /\S*@\S*/g;

/** "Silva, Maria" / "SILVA SANTOS, Maria José" (sobrenome primeiro). */
const SOBRENOME_VIRGULA_NOME = /^\s*[\p{L}'’. -]+,\s*(?=\p{L})/u;

/**
 * Envia ao modelo só a FORMA de um valor de célula, nunca o dado:
 * - token com `@` → `[email]`;
 * - token com dígito → dígitos viram `9` (telefone `(11) 98765-4321` → `(99) 99999-9999`, CPF → `999.999.999-99`,
 *   data → `99/99/9999`); trechos de 4+ letras colados a dígitos viram `[texto]` (só "h", "hs", "min" etc. ficam);
 * - "Sobrenome, Nome" → descarta o trecho antes da vírgula;
 * - parte alfabética → só a 1ª palavra, e só se ela for apenas letras; com hífen/ponto/apóstrofo vira `[texto]`.
 *   As demais palavras alfabéticas são descartadas ("Maria da Silva" → "Maria"; "Maria-Silva Souza" → "[texto]").
 * Garantia: nenhum dígito real e nenhum sobrenome sai daqui.
 */
export function mascararValor(valor: string): string {
  const semSobrenome = valor.replace(SOBRENOME_VIRGULA_NOME, "");
  const saida: string[] = [];
  let viuTexto = false;
  for (const token of semSobrenome.split(/\s+/)) {
    if (!token) continue;
    if (token.includes("@")) {
      saida.push("[email]");
    } else if (/\p{Nd}/u.test(token)) {
      saida.push(formaDosDigitos(token).replace(/\p{L}{4,}/gu, "[texto]"));
    } else if (/\p{L}/u.test(token) && !viuTexto) {
      viuTexto = true;
      saida.push(/^\p{L}+$/u.test(token) ? token : "[texto]");
    }
    // demais tokens alfabéticos e pontuação solta são descartados
  }
  return saida.join(" ");
}

/**
 * Forma de um CABEÇALHO para o modelo: e-mails → `[email]`, dígitos → `9`; palavras ficam
 * (cabeçalho que parece nome de pessoa nem chega aqui: ver `cabecalhoPareceDado` em mapear-colunas).
 */
export function mascararCabecalho(cabecalho: string): string {
  return formaDosDigitos(cabecalho.replace(TOKEN_EMAIL, "[email]"));
}

/** CPF com ou sem pontuação. */
export const REGEX_CPF = /(?<!\d)\d{3}[ .]?\d{3}[ .]?\d{3}[ ]?-?[ ]?\d{2}(?!\d)/g;
/** Qualquer sequência com 8+ dígitos, aceitando um espaço, tab, ponto, hífen ou barra entre eles. */
export const REGEX_SEQUENCIA_LONGA = /(?<!\d)\d(?:[ \t./-]?\d){7,}(?!\d)/g;
/** Datas válidas (dd/MM/yyyy, dd-MM-yyyy, dd.MM.yyyy, yyyy-MM-dd): preservadas na varredura. */
const REGEX_DATA =
  /(?<![\d./-])(?:(?:0?[1-9]|[12]\d|3[01])([/.-])(?:0?[1-9]|1[0-2])\1(?:19|20)\d{2}|(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))(?![\d]|[./-]\d)/g;
const PROTEGIDO = "\uE000"; // caractere de uso privado, sem dígitos

/**
 * Varredura fail-closed (rodar DEPOIS de marcar telefones): CPF e qualquer sequência remanescente de 8+ dígitos
 * viram `[NUM_n]`, que NUNCA é restaurado. Datas válidas são preservadas (a extração precisa delas).
 */
export function ocultarNumerosLongos(texto: string): { texto: string; quantidade: number } {
  const datas: string[] = [];
  let n = 0;
  const marcar = () => `[NUM_${++n}]`;
  const resultado = texto
    .replace(new RegExp(PROTEGIDO, "g"), "") // o marcador interno nunca vem do arquivo
    .replace(REGEX_DATA, (d) => {
      datas.push(d);
      return PROTEGIDO;
    })
    .replace(REGEX_CPF, marcar)
    .replace(REGEX_SEQUENCIA_LONGA, marcar);
  let i = 0;
  return { texto: resultado.replace(new RegExp(PROTEGIDO, "g"), () => datas[i++]), quantidade: n };
}
