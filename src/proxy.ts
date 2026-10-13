import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO, decidirAcesso, rotaInngest } from "@/lib/painel-auth";

/**
 * Proxy (Next.js 16 — antigo middleware.ts). Protege o painel com a senha única PAINEL_SENHA
 * até a Fase 3. A lógica fica em src/lib/painel-auth.ts; aqui só traduzimos a decisão em resposta.
 */
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const decisao = await decidirAcesso({
    pathname,
    cookie: req.cookies.get(COOKIE_SESSAO)?.value,
    senha: process.env.PAINEL_SENHA,
    producao: process.env.NODE_ENV === "production",
    inngestSigningKey: process.env.INNGEST_SIGNING_KEY,
  });

  if (decisao === "liberar") return NextResponse.next();

  const ehApi = pathname.startsWith("/api/");

  if (decisao === "indisponivel") {
    if (rotaInngest(pathname)) {
      console.error("[proxy] INNGEST_SIGNING_KEY ausente em produção — /api/inngest bloqueado");
      return NextResponse.json({ ok: false, erro: "inngest_indisponivel" }, { status: 503 });
    }
    console.error("[proxy] PAINEL_SENHA ausente ou curta demais em produção — acesso bloqueado");
    return ehApi
      ? NextResponse.json({ ok: false, erro: "painel_indisponivel" }, { status: 503 })
      : new NextResponse("Painel indisponível: configuração ausente.", { status: 503 });
  }

  if (ehApi) return NextResponse.json({ ok: false, erro: "nao_autenticado" }, { status: 401 });

  const url = req.nextUrl.clone();
  url.pathname = "/entrar";
  url.search = "";
  url.searchParams.set("de", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  // Assets estáticos ficam fora do proxy; o resto passa por decidirAcesso (que também libera rotas públicas).
  // Exclusões ANCORADAS: "/_next/staticX" e "/favicon.icoX" continuam passando pelo proxy.
  // Precisa ser literal (o Next analisa estaticamente); proxy.test.ts valida a regex.
  matcher: ["/((?!_next/static/|_next/image/|favicon\\.ico$).*)"],
};
