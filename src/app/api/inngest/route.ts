import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";
import { inngestLiberado } from "@/lib/painel-auth";

const handlers = serve({ client: inngest, functions });

/**
 * Defesa em profundidade (o proxy já bloqueia): em produção sem INNGEST_SIGNING_KEY a rota
 * responde 503 em vez de servir o endpoint sem verificação de assinatura.
 * Fora de produção (dev local / INNGEST_DEV) segue funcionando sem chave.
 * O env é lido a cada requisição, não no carregamento do módulo.
 */
function protegido<H extends (...args: never[]) => unknown>(handler: H): H {
  const envolvido = (...args: Parameters<H>) => {
    const liberado = inngestLiberado({
      producao: process.env.NODE_ENV === "production",
      signingKey: process.env.INNGEST_SIGNING_KEY,
    });
    if (!liberado) {
      console.error("[inngest] INNGEST_SIGNING_KEY ausente em produção — rota bloqueada");
      return Response.json({ ok: false, erro: "inngest_indisponivel" }, { status: 503 });
    }
    return handler(...args);
  };
  return envolvido as unknown as H;
}

export const GET = protegido(handlers.GET);
export const POST = protegido(handlers.POST);
export const PUT = protegido(handlers.PUT);
