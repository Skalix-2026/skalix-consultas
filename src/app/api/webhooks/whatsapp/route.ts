import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook da WhatsApp Cloud API.
 * GET  — validação inicial (hub.challenge) feita pela Meta ao salvar a URL.
 * POST — eventos: mensagens recebidas (field=messages) e status (sent/delivered/read/failed).
 *
 * Regras: responder 200 em < 5s SEMPRE (a Meta reenvia se não receber);
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

  const body = JSON.parse(raw) as WebhookBody;

  // 2) Persistir bruto e enfileirar — TODO Fase 0: salvar em eventos_webhook e disparar Inngest
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      for (const m of v.messages ?? []) {
        // TODO: inngest.send({ name: "whatsapp/mensagem.recebida", data: { from: m.from, wamid: m.id, texto: m.text?.body, botao: m.button?.text, timestamp: m.timestamp } })
        console.log("[webhook] mensagem", { from: m.from.slice(-4), tipo: m.type });
      }
      for (const s of v.statuses ?? []) {
        // TODO: inngest.send({ name: "whatsapp/status.atualizado", data: { wamid: s.id, status: s.status, erro: s.errors?.[0] } })
        console.log("[webhook] status", { status: s.status, erro: s.errors?.[0]?.code });
      }
    }
  }

  return NextResponse.json({ ok: true });
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
  messages?: { from: string; id: string; timestamp: string; type: string; text?: { body: string }; button?: { text: string; payload: string } }[];
  statuses?: { id: string; status: "sent" | "delivered" | "read" | "failed"; timestamp: string; recipient_id: string; errors?: { code: number; title: string }[] }[];
};
