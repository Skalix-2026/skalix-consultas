import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/db/queries/eventos", () => ({
  salvarEventoWebhook: vi.fn().mockResolvedValue("ev1"),
  marcarEventoComErro: vi.fn(),
}));
vi.mock("@/db/queries/status-mensagem", () => ({ aplicarStatusMensagemReal: vi.fn() }));
vi.mock("@/inngest/client", async (orig) => ({ ...(await orig<object>()), inngest: { send: vi.fn() } }));

import { POST } from "./route";
import { aplicarStatusMensagemReal } from "@/db/queries/status-mensagem";
import { inngest } from "@/inngest/client";
import { marcarEventoComErro } from "@/db/queries/eventos";

const corpo = (statuses: object[]) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "1", changes: [{ field: "messages", value: { metadata: { display_phone_number: "1", phone_number_id: "1" }, statuses } }] }],
});
const req = (b: unknown) => new NextRequest("http://x/api/webhooks/whatsapp", { method: "POST", body: JSON.stringify(b) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.META_APP_SECRET = "";
  process.env.DATABASE_URL = "postgres://teste";
  process.env.INNGEST_EVENT_KEY = "";
});

describe("webhook sem INNGEST_EVENT_KEY: status aplicados direto", () => {
  it("aplica sent/failed pela função reutilizável e não enfileira", async () => {
    const res = await POST(req(corpo([
      { id: "wamid.1", status: "sent", timestamp: "1", recipient_id: "5511" },
      { id: "wamid.2", status: "failed", timestamp: "1", recipient_id: "5511", errors: [{ code: 130497, title: "restrito" }] },
    ])));
    expect(res.status).toBe(200);
    expect(aplicarStatusMensagemReal).toHaveBeenCalledTimes(2);
    expect(aplicarStatusMensagemReal).toHaveBeenCalledWith({ wamid: "wamid.2", status: "failed", erroCodigo: 130497, erroMensagem: "restrito" });
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("wamid desconhecido: o evento bruto fica marcado com erro para reprocesso", async () => {
    vi.mocked(aplicarStatusMensagemReal).mockResolvedValue("desconhecido");
    const res = await POST(req(corpo([{ id: "wamid.x", status: "sent", timestamp: "1", recipient_id: "5511" }])));
    expect(res.status).toBe(200);
    expect(marcarEventoComErro).toHaveBeenCalledWith("ev1", "wamid_desconhecido");
  });

  it("erro ao aplicar não quebra o 200", async () => {
    vi.mocked(aplicarStatusMensagemReal).mockRejectedValue(new Error("db fora"));
    const res = await POST(req(corpo([{ id: "wamid.1", status: "read", timestamp: "1", recipient_id: "5511" }])));
    expect(res.status).toBe(200);
  });

  it("com INNGEST_EVENT_KEY: enfileira e não aplica direto", async () => {
    process.env.INNGEST_EVENT_KEY = "chave";
    vi.mocked(inngest.send).mockResolvedValue({ ids: [] } as never);
    await POST(req(corpo([{ id: "wamid.1", status: "read", timestamp: "1", recipient_id: "5511" }])));
    expect(inngest.send).toHaveBeenCalledTimes(1);
    expect(aplicarStatusMensagemReal).not.toHaveBeenCalled();
  });
});
