import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

/** Aproximação do path-to-regexp do Next para o matcher `/(regex)`: ancorado no início e no fim. */
const matcher = new RegExp(`^${config.matcher[0]}$`);

describe("matcher do proxy (exclusões ancoradas)", () => {
  it("exclui só os assets estáticos de verdade", () => {
    for (const p of ["/_next/static/chunks/a.js", "/_next/image/", "/_next/image/x", "/favicon.ico"]) {
      expect(matcher.test(p), p).toBe(false);
    }
  });
  it("prefixos parecidos passam pelo proxy", () => {
    for (const p of ["/", "/importar", "/favicon.icoX", "/favicon.ico/x", "/faviconXico", "/_next/staticX", "/_next/imageX", "/_next/static", "/api/inngest"]) {
      expect(matcher.test(p), p).toBe(true);
    }
  });
});

describe("proxy: /api/inngest e PAINEL_SENHA em produção", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sem INNGEST_SIGNING_KEY → 503", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAINEL_SENHA", "senha-de-teste-bem-longa");
    vi.stubEnv("INNGEST_SIGNING_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await proxy(new NextRequest("http://x/api/inngest", { method: "PUT" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, erro: "inngest_indisponivel" });
  });

  it("com INNGEST_SIGNING_KEY → segue sem sessão", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAINEL_SENHA", "senha-de-teste-bem-longa");
    vi.stubEnv("INNGEST_SIGNING_KEY", "signkey-prod-abc");
    const res = await proxy(new NextRequest("http://x/api/inngest", { method: "PUT" }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("PAINEL_SENHA curta → 503 no painel", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAINEL_SENHA", "curta");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await proxy(new NextRequest("http://x/importar"));
    expect(res.status).toBe(503);
  });
});
