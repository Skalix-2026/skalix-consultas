import { vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { CacheIA } from "../cache";

/** Client Anthropic falso para testes: nunca faz chamada real (orçamento de IA). */
export function clienteFalso(texto: string, stopReason: string = "end_turn") {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: texto }],
    stop_reason: stopReason,
    usage: { input_tokens: 100, output_tokens: 50 },
  });
  const client = { messages: { create } } as unknown as Anthropic;
  /** Tudo que foi enviado ao modelo (system + messages), serializado. */
  const enviado = () => JSON.stringify(create.mock.calls[0]?.[0] ?? null);
  /** Só o conteúdo da mensagem do usuário (o texto vindo do arquivo). */
  const enviadoUsuario = () =>
    (create.mock.calls[0]?.[0] as { messages: { content: string }[] } | undefined)?.messages[0]?.content ?? "";
  const parametros = () => create.mock.calls[0]?.[0] as { max_tokens: number; temperature: number; model: string };
  return { client, create, enviado, enviadoUsuario, parametros };
}

/** Cache em memória para testes dos harnesses (implementação real fica com o chamador). */
export function cacheFalso<T>() {
  const store = new Map<string, T>();
  const get = vi.fn(async (hash: string) => store.get(hash) ?? null);
  const set = vi.fn(async (hash: string, valor: T) => {
    store.set(hash, valor);
  });
  const cache: CacheIA<T> = { get, set };
  return { cache, get, set, store };
}

/** sha256 fictício (64 hex). */
export const HASH = "a".repeat(64);
export const HASH_2 = "b".repeat(64);
