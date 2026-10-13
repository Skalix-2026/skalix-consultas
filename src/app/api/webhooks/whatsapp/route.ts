import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { inngest, Ev } from "@/inngest/client";
import { salvarEventoWebhook, marcarEventoComErro } from "@/db/queries/eventos";
import { aplicarStatusMensagemReal } from "@/db/queries/status-mensagem";

/**
 * Webhook da WhatsApp Cloud API.
 * GET  — validação inicial (hub.challenge) feita pela Meta ao salvar a URL.
 * POST — eventos: mensagens recebidas (field=messages) e status (sent/delivered/read/failed).
 *
 * Regras: responder 200 em < 5 s SEMPRE (a Meta reenvia se não receber);
 * gravar o payload bruto em eventos_webhook e processar de forma assíncrona (Inngest).
 */

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(p.get("hub.challenge"), { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  // 1) Assinatura: X-Hub-Signature-256 = sha256=HMAC(app_secret, body)
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  if (!verifySignature(raw, sig)) return new NextResponse("invalid signature", { status: 401 });

  let body: WebhookBody;
  try { body = JSON.parse(raw) as WebhookBody; } catch { return new NextResponse("bad json", { status: 400 }); }

  // 2) Persistir o payload bruto (auditoria). Falha de banco não pode derrubar o 200.
  let eventoId: string | undefined;
  if (process.env.DATABASE_URL) {
    try { eventoId = await salvarEventoWebhook(body); }
    catch (e) { console.error("[webhook] falha ao salvar evento", (e as Error).message); }
  }

  // 3) Enfileirar para processamento assíncrono
  const eventos: { name: string; data: unknown }[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      for (const m of v.messages ?? []) {
        eventos.push({
          name: Ev.mensagemRecebida.name,
          data: {
            eventoId, from: m.from, wamid: m.id, timestamp: m.timestamp,
            phoneNumberId: v.metadata.phone_number_id,
            texto: m.text?.body, botao: m.button?.text ?? m.interactive?.button_reply?.title,
          },
        });
      }
      for (const s of v.statuses ?? []) {
        eventos.push({
          name: Ev.statusAtualizado.name,
          data: { wamid: s.id, status: s.status, erroCodigo: s.errors?.[0]?.code, erroMensagem: s.errors?.[0]?.title },
        });
      }
    }
  }
  // Inngest só é acionado quando a chave existir (Fase 1). Sem ela, os status (sent/delivered/read/failed)
  // são aplicados direto no banco; mensagens recebidas ficam salvas em eventos_webhook para reprocessar.
  if (eventos.length) {
    if (process.env.INNGEST_EVENT_KEY && process.env.INNGEST_EVENT_KEY !== "off") {
      try { await inngest.send(eventos); }
      catch (e) { console.error("[webhook] falha ao enviar para Inngest", (e as Error).message); }
    } else if (process.env.DATABASE_URL) {
      for (const ev of eventos) {
        if (ev.name !== Ev.statusAtualizado.name) continue;
        try {
          const r = await aplicarStatusMensagemReal(Ev.statusAtualizado.data.parse(ev.data));
          // status de wamid ainda desconhecido (chegou antes da gravação?) não se perde: fica no evento bruto p/ reprocesso
          if (r === "desconhecido" && eventoId) await marcarEventoComErro(eventoId, "wamid_desconhecido");
        }
        catch (e) { console.error("[webhook] falha ao aplicar status", (e as Error).message); }
      }
    }
  }

  return NextResponse.json({ ok: true, eventos: eventos.length });
}

function verifySignature(raw: string, header: string) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production"; // em dev, permitir sem secret
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- Tipos mínimos do payload (ver evento real em docs/decisoes.md) ----
type WebhookBody = {
  object: "whatsapp_business_account";
  entry?: { id: string; changes?: { field: string; value: ChangeValue }[] }[];
};
type ChangeValue = {
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: {
    from: string; id: string; timestamp: string; type: string;
    text?: { body: string };
    button?: { text: string; payload: string };
    interactive?: { button_reply?: { id: string; title: string } };
  }[];
  statuses?: { id: string; status: "sent" | "delivered" | "read" | "failed"; timestamp: string; recipient_id: string; errors?: { code: number; title: string }[] }[];
};
