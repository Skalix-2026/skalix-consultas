/**
 * Autenticação provisória do painel (senha única em PAINEL_SENHA) — válida até a Fase 3,
 * quando o Supabase Auth substitui. Toda a lógica fica aqui, em funções puras, para que a troca
 * mexa só neste módulo e em `src/proxy.ts`.
 *
 * Usa apenas Web Crypto (crypto.subtle), compatível com o runtime do proxy (Node ou Edge).
 *
 * Token do cookie: `v1.<expMs>.<hmacHex>`, onde hmacHex = HMAC-SHA256(PAINEL_SENHA, "v1.<expMs>").
 * A senha em si nunca vai no cookie. Trocar a senha invalida todos os tokens emitidos.
 *
 * TODO(Fase 3): rate limit em POST /api/entrar (hoje sem limite de tentativas).
 */

export const COOKIE_SESSAO = "painel_sessao";
export const DURACAO_SESSAO_MS = 12 * 60 * 60 * 1000; // 12h
const VERSAO = "v1";

const encoder = new TextEncoder();

function paraHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(chave: string, mensagem: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(chave),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return paraHex(await crypto.subtle.sign("HMAC", key, encoder.encode(mensagem)));
}

async function sha256Hex(texto: string): Promise<string> {
  return paraHex(await crypto.subtle.digest("SHA-256", encoder.encode(texto)));
}

/** Comparação em tempo constante para strings de mesmo tamanho (diferença de tamanho → false). */
export function iguaisTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Confere a senha digitada sem vazar tamanho nem posição da diferença (compara digests). */
export async function senhaConfere(digitada: string, senha: string): Promise<boolean> {
  if (!senha) return false;
  const [a, b] = await Promise.all([sha256Hex(digitada), sha256Hex(senha)]);
  return iguaisTempoConstante(a, b);
}

/** Gera o valor do cookie de sessão, expirando em `agoraMs + DURACAO_SESSAO_MS`. */
export async function assinarSessao(senha: string, agoraMs: number = Date.now()): Promise<string> {
  if (!senha) throw new Error("PAINEL_SENHA ausente: não é possível assinar sessão");
  const payload = `${VERSAO}.${agoraMs + DURACAO_SESSAO_MS}`;
  return `${payload}.${await hmacHex(senha, payload)}`;
}

/** Valida assinatura e expiração do token. Nunca lança. */
export async function verificarSessao(
  token: string | undefined | null,
  senha: string,
  agoraMs: number = Date.now(),
): Promise<boolean> {
  if (!token || !senha) return false;
  const partes = token.split(".");
  if (partes.length !== 3) return false;
  const [versao, expStr, assinatura] = partes as [string, string, string];
  if (versao !== VERSAO || !/^\d{1,16}$/.test(expStr) || !/^[0-9a-f]{64}$/.test(assinatura)) return false;
  const esperado = await hmacHex(senha, `${versao}.${expStr}`);
  if (!iguaisTempoConstante(assinatura, esperado)) return false;
  return Number(expStr) > agoraMs;
}

/** Rotas que não exigem sessão. Comparação exata ou por segmento (nunca prefixo solto). */
const ROTAS_LIBERADAS = [
  "/privacidade",
  "/entrar",
  "/api/entrar",
  "/api/webhooks/whatsapp", // Meta — protegido pela assinatura X-Hub-Signature-256
  "/api/inngest", // Inngest assina as próprias requisições (em produção exige INNGEST_SIGNING_KEY; ver inngestLiberado)
] as const;

/** Tamanho mínimo de PAINEL_SENHA em produção. Abaixo disso o painel falha fechado (503). */
export const SENHA_MIN_PRODUCAO = 16;

const ROTA_INNGEST = "/api/inngest";

export function rotaInngest(pathname: string): boolean {
  return pathname === ROTA_INNGEST || pathname.startsWith(`${ROTA_INNGEST}/`);
}

/**
 * O endpoint do Inngest só é servido em produção quando há INNGEST_SIGNING_KEY (sem ela,
 * nada garante que a chamada veio do Inngest). Fora de produção (dev local, INNGEST_DEV,
 * testes) segue liberado mesmo sem chave.
 */
export function inngestLiberado(args: { producao: boolean; signingKey: string | undefined }): boolean {
  if (!args.producao) return true;
  return typeof args.signingKey === "string" && args.signingKey.trim().length > 0;
}

/** Em produção a senha precisa existir e ter ao menos SENHA_MIN_PRODUCAO caracteres. */
export function senhaAceitavel(senha: string | undefined, producao: boolean): boolean {
  if (!senha) return false;
  return !producao || senha.length >= SENHA_MIN_PRODUCAO;
}

export function rotaLiberada(pathname: string): boolean {
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico") return true;
  return ROTAS_LIBERADAS.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/**
 * Destino pós-login a partir de `?de=`. Só aceita caminho relativo interno;
 * qualquer coisa suspeita (//host, /\host, esquema, controle) volta para "/".
 */
export function destinoSeguro(de: string | null | undefined): string {
  if (!de || typeof de !== "string") return "/";
  if (!de.startsWith("/") || de.startsWith("//") || de.startsWith("/\\")) return "/";
  for (let i = 0; i < de.length; i++) {
    const c = de.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x5c /* \ */) return "/";
  }
  try {
    const base = "http://painel.invalid";
    const url = new URL(de, base);
    if (url.origin !== base) return "/";
    if (url.pathname === "/entrar" || url.pathname.startsWith("/api/")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export type DecisaoAcesso = "liberar" | "nao_autenticado" | "indisponivel";

/**
 * Decide o acesso a uma requisição. Regras:
 * - /api/inngest em produção sem INNGEST_SIGNING_KEY → indisponivel (503);
 * - rota liberada → liberar;
 * - em produção, PAINEL_SENHA ausente ou com menos de SENHA_MIN_PRODUCAO caracteres
 *   → indisponivel (503, falha fechada, nunca libera);
 * - sem PAINEL_SENHA fora de produção → liberar (dev local);
 * - cookie válido → liberar; senão → nao_autenticado.
 */
export async function decidirAcesso(args: {
  pathname: string;
  cookie: string | undefined;
  senha: string | undefined;
  producao: boolean;
  /** INNGEST_SIGNING_KEY — só consultada para /api/inngest. */
  inngestSigningKey?: string;
  agoraMs?: number;
}): Promise<DecisaoAcesso> {
  if (rotaInngest(args.pathname) && !inngestLiberado({ producao: args.producao, signingKey: args.inngestSigningKey })) {
    return "indisponivel";
  }
  if (rotaLiberada(args.pathname)) return "liberar";
  if (args.producao && !senhaAceitavel(args.senha, true)) return "indisponivel";
  if (!args.senha) return "liberar"; // dev local sem senha
  return (await verificarSessao(args.cookie, args.senha, args.agoraMs)) ? "liberar" : "nao_autenticado";
}

/** Opções do cookie de sessão (usadas ao setar e ao limpar). */
export function opcoesCookie(producao: boolean) {
  return {
    httpOnly: true,
    secure: producao,
    sameSite: "lax" as const,
    path: "/",
    maxAge: DURACAO_SESSAO_MS / 1000,
  };
}
