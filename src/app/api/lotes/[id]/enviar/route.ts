import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { inngest, Ev } from "@/inngest/client";
import type { RespostaEnviarLote } from "@/lib/schemas-lotes";
import { obterLote, trocarStatusLote } from "@/db/queries/lotes";

/**
 * Dispara o envio das confirmações de um lote. A rota NÃO envia nada: marca o lote como "enviando" e
 * enfileira o evento; quem envia (em blocos, com idempotência) é a função Inngest `enviarLote`.
 */

/** Lote em "enviando" há mais que isso é considerado travado. */
const ENVIO_PARADO_MS = 15 * 60 * 1000;

const Id = z.uuid();
const Body = z.object({
  /** yyyy-MM-dd no fuso da clínica: só os agendamentos desse dia. Sem isso, todos os futuros do lote. */
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "data inexistente").optional(),
});

function responder(body: RespostaEnviarLote, status: number) {
  return NextResponse.json<RespostaEnviarLote>(body, { status });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = Id.safeParse((await ctx.params).id);
  if (!id.success) return responder({ ok: false, erro: "id_invalido", mensagem: "Identificador de lote inválido." }, 400);

  // corpo opcional: vazio = {}
  const texto = await req.text();
  let json: unknown = {};
  if (texto.trim()) {
    try { json = JSON.parse(texto); }
    catch { return responder({ ok: false, erro: "entrada_invalida", mensagem: "Corpo da requisição não é JSON válido." }, 400); }
  }
  const body = Body.safeParse(json);
  if (!body.success) return responder({ ok: false, erro: "entrada_invalida", mensagem: "Use { \"data\": \"yyyy-MM-dd\" } ou deixe o corpo vazio." }, 400);

  const lote = await obterLote(id.data);
  if (!lote) return responder({ ok: false, erro: "lote_nao_encontrado", mensagem: "Lote não encontrado." }, 404);
  const agora = Date.now();
  const parado = lote.status === "enviando" && (!lote.enviandoDesde || agora - lote.enviandoDesde.getTime() > ENVIO_PARADO_MS);
  if (lote.status === "enviando" && !parado) {
    return responder({ ok: false, erro: "lote_em_envio", mensagem: "Este lote já está sendo enviado." }, 409);
  }

  // "enviando" parado há > 15 min (função morreu) é reenviável; o envio é idempotente, só vai o que falta
  const anterior = parado ? "importado" : lote.status;
  // troca atômica: dois cliques simultâneos não enfileiram duas vezes
  const trocou = parado
    ? await trocarStatusLote(id.data, "enviando", "enviando", { enviandoAntesDe: new Date(agora - ENVIO_PARADO_MS) })
    : await trocarStatusLote(id.data, anterior, "enviando");
  if (!trocou) {
    return responder({ ok: false, erro: "lote_em_envio", mensagem: "Este lote já está sendo enviado." }, 409);
  }

  try {
    await inngest.send({ name: Ev.enviarLote.name, data: { loteId: id.data, ...(body.data.data ? { data: body.data.data } : {}) } });
  } catch (e) {
    console.error("[lotes] falha ao enfileirar", { loteId: id.data, erro: (e as Error).name });
    await trocarStatusLote(id.data, "enviando", anterior).catch(() => undefined);
    return responder({ ok: false, erro: "fila_indisponivel", mensagem: "A fila de envio está indisponível. Tente novamente em instantes." }, 502);
  }
  return responder({ ok: true, loteId: id.data, status: "enviando" }, 202);
}
