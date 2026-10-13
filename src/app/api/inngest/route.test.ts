import { describe, it, expect, vi, afterEach } from "vitest";

// O serve real é substituído: o teste cobre só a barreira de INNGEST_SIGNING_KEY.
const { chamado } = vi.hoisted(() => ({
  chamado: vi.fn(async (_req: Request) => Response.json({ servido: true })),
}));
vi.mock("inngest/next", () => ({
  serve: () => ({ GET: chamado, POST: chamado, PUT: chamado }),
}));

import { GET, POST, PUT } from "./route";

type Handler = (req: Request) => Promise<Response>;
const chamar = (h: unknown, method: string) => (h as Handler)(new Request("http://x/api/inngest", { method }));

describe("/api/inngest — defesa em profundidade", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    chamado.mockClear();
  });

  it("produção sem INNGEST_SIGNING_KEY → 503 e não chama o serve", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INNGEST_SIGNING_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [h, m] of [[GET, "GET"], [POST, "POST"], [PUT, "PUT"]] as const) {
      const res = await chamar(h, m);
      expect(res.status, m).toBe(503);
      expect(await res.json()).toEqual({ ok: false, erro: "inngest_indisponivel" });
    }
    expect(chamado).not.toHaveBeenCalled();
  });

  it("produção com INNGEST_SIGNING_KEY → delega ao serve", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INNGEST_SIGNING_KEY", "signkey-prod-abc");
    const res = await chamar(PUT, "PUT");
    expect(res.status).toBe(200);
    expect(chamado).toHaveBeenCalledTimes(1);
  });

  it("dev sem chave (INNGEST_DEV) continua funcionando", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("INNGEST_DEV", "1");
    vi.stubEnv("INNGEST_SIGNING_KEY", "");
    const res = await chamar(GET, "GET");
    expect(res.status).toBe(200);
    expect(chamado).toHaveBeenCalledTimes(1);
  });
});
