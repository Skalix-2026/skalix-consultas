import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { assinarSessao, COOKIE_SESSAO, destinoSeguro, opcoesCookie, senhaConfere } from "@/lib/painel-auth";

// TODO(Fase 3): rate limit de tentativas por IP (hoje sem limite).

const EntradaSchema = z.object({
  senha: z.string().min(1).max(200),
  de: z.string().max(2000).optional(),
});

export type RespostaEntrar =
  | { ok: true; destino: string }
  | { ok: false; erro: "entrada_invalida" | "senha_incorreta" | "painel_indisponivel" };

function responder(body: RespostaEntrar, status: number) {
  return NextResponse.json<RespostaEntrar>(body, { status });
}

export async function POST(req: NextRequest) {
  const senhaPainel = process.env.PAINEL_SENHA;
  if (!senhaPainel) return responder({ ok: false, erro: "painel_indisponivel" }, 503);

  let json: unknown;
  try { json = await req.json(); } catch { return responder({ ok: false, erro: "entrada_invalida" }, 400); }
  const parsed = EntradaSchema.safeParse(json);
  if (!parsed.success) return responder({ ok: false, erro: "entrada_invalida" }, 400);

  if (!(await senhaConfere(parsed.data.senha, senhaPainel))) {
    return responder({ ok: false, erro: "senha_incorreta" }, 401);
  }

  const res = responder({ ok: true, destino: destinoSeguro(parsed.data.de) }, 200);
  res.cookies.set(COOKIE_SESSAO, await assinarSessao(senhaPainel), opcoesCookie(process.env.NODE_ENV === "production"));
  return res;
}
