import { NextResponse } from "next/server";
import { COOKIE_SESSAO, opcoesCookie } from "@/lib/painel-auth";

export type RespostaSair = { ok: true };

/** Encerra a sessão do painel apagando o cookie. Sem corpo de entrada. */
export async function POST() {
  const res = NextResponse.json<RespostaSair>({ ok: true }, { status: 200 });
  res.cookies.set(COOKIE_SESSAO, "", { ...opcoesCookie(process.env.NODE_ENV === "production"), maxAge: 0 });
  return res;
}
