import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { POST as SAIR } from "../sair/route";
import { verificarSessao } from "@/lib/painel-auth";

function req(body: unknown) {
  return new NextRequest("http://x/api/entrar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.PAINEL_SENHA = "senha-teste";
});

describe("POST /api/entrar", () => {
  it("senha correta seta cookie assinado e devolve destino interno", async () => {
    const res = await POST(req({ senha: "senha-teste", de: "/importar?x=1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, destino: "/importar?x=1" });
    const cookie = res.cookies.get("painel_sessao");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.value).not.toContain("senha-teste");
    expect(await verificarSessao(cookie?.value, "senha-teste")).toBe(true);
  });

  it("ignora ?de= externo (open redirect)", async () => {
    const res = await POST(req({ senha: "senha-teste", de: "//evil.com" }));
    expect(await res.json()).toEqual({ ok: true, destino: "/" });
  });

  it("senha errada → 401 sem cookie", async () => {
    const res = await POST(req({ senha: "errada" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, erro: "senha_incorreta" });
    expect(res.cookies.get("painel_sessao")).toBeUndefined();
  });

  it("entrada inválida → 400", async () => {
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req("não é json"))).status).toBe(400);
  });

  it("sem PAINEL_SENHA → 503", async () => {
    process.env.PAINEL_SENHA = "";
    expect((await POST(req({ senha: "qualquer" }))).status).toBe(503);
  });
});

describe("POST /api/sair", () => {
  it("apaga o cookie", async () => {
    const res = await SAIR();
    expect(res.status).toBe(200);
    expect(res.cookies.get("painel_sessao")?.value).toBe("");
    expect(res.cookies.get("painel_sessao")?.maxAge).toBe(0);
  });
});
