import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";

beforeAll(() => {
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "segredo-teste";
  process.env.META_APP_SECRET = "";
  process.env.DATABASE_URL = "";
  process.env.INNGEST_EVENT_KEY = "off";
});

describe("webhook GET (validação da Meta)", () => {
  it("devolve o challenge quando o verify token confere", async () => {
    const req = new NextRequest("http://x/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=segredo-teste&hub.challenge=123");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("123");
  });
  it("recusa verify token errado", async () => {
    const req = new NextRequest("http://x/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=123");
    expect((await GET(req)).status).toBe(403);
  });
});

describe("webhook POST", () => {
  it("aceita payload de mensagem e responde 200", async () => {
    const body = { object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { metadata: { display_phone_number: "1", phone_number_id: "1" }, messages: [{ from: "5511999990000", id: "wamid.x", timestamp: "1", type: "text", text: { body: "Sim" } }] } }] }] };
    const req = new NextRequest("http://x/api/webhooks/whatsapp", { method: "POST", body: JSON.stringify(body) });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});
