import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/db/queries/lotes", () => ({
  listarLotes: vi.fn(),
  obterLote: vi.fn(),
  listarAgendamentosDoLote: vi.fn(),
  trocarStatusLote: vi.fn(),
}));
vi.mock("@/inngest/client", async (orig) => ({
  ...(await orig<object>()),
  inngest: { send: vi.fn() },
}));

import { GET as listar } from "./route";
import { GET as detalhe } from "./[id]/route";
import { POST as enviar } from "./[id]/enviar/route";
import { listarLotes, obterLote, listarAgendamentosDoLote, trocarStatusLote } from "@/db/queries/lotes";
import { inngest } from "@/inngest/client";

const ID = "11111111-1111-4111-8111-111111111111";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const lote = (status: "importado" | "enviando" = "importado", enviandoDesde: Date | null = null) => ({
  id: ID, clinicaId: "c1", arquivoNome: "a.csv", totalLinhas: 3, linhasValidas: 2, status, enviandoDesde,
  criadoEm: new Date("2026-10-13T10:00:00Z"), contagens: { inserido: 2 },
});
const post = (body?: unknown) =>
  new NextRequest(`http://x/api/lotes/${ID}/enviar`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/lotes", () => {
  it("lista com contagens por status", async () => {
    vi.mocked(listarLotes).mockResolvedValue([lote()]);
    const res = await listar();
    expect(await res.json()).toEqual({
      ok: true,
      lotes: [{ id: ID, arquivoNome: "a.csv", totalLinhas: 3, linhasValidas: 2, status: "importado", criadoEm: "2026-10-13T10:00:00.000Z", contagens: { inserido: 2 } }],
    });
  });
});

describe("GET /api/lotes/[id]", () => {
  it("agendamentos com telefone mascarado e nome abreviado", async () => {
    vi.mocked(obterLote).mockResolvedValue(lote());
    vi.mocked(listarAgendamentosDoLote).mockResolvedValue([{
      id: "a1", nome: "Maria Souza Lima", telefone: "5511900001234", atendimento: "Consulta", profissional: "Dr. Caio",
      dataHora: new Date("2026-10-20T17:30:00Z"), status: "inserido", mensagemStatus: "falhou", erroCodigo: 130497, erroMensagem: "restrito",
    }]);
    const res = await detalhe(new NextRequest("http://x"), ctx(ID));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.agendamentos[0]).toMatchObject({
      nome: "Maria S.", telefone: "(11) 9****-1234", status: "inserido", mensagemStatus: "falhou", erroCodigo: 130497,
    });
    expect(JSON.stringify(json)).not.toContain("5511900001234");
    expect(JSON.stringify(json)).not.toContain("Souza");
  });

  it("id inválido 400; inexistente 404", async () => {
    expect((await detalhe(new NextRequest("http://x"), ctx("abc"))).status).toBe(400);
    vi.mocked(obterLote).mockResolvedValue(null);
    expect((await detalhe(new NextRequest("http://x"), ctx(ID))).status).toBe(404);
  });
});

describe("POST /api/lotes/[id]/enviar", () => {
  it("caminho feliz: marca 'enviando' e enfileira o evento (202), sem enviar nada na rota", async () => {
    vi.mocked(obterLote).mockResolvedValue(lote());
    vi.mocked(trocarStatusLote).mockResolvedValue(true);
    vi.mocked(inngest.send).mockResolvedValue({ ids: ["e1"] } as never);
    const res = await enviar(post({ data: "2026-10-20" }), ctx(ID));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, loteId: ID, status: "enviando" });
    expect(trocarStatusLote).toHaveBeenCalledWith(ID, "importado", "enviando");
    expect(inngest.send).toHaveBeenCalledWith({ name: "lote/enviar", data: { loteId: ID, data: "2026-10-20" } });
  });

  it("corpo vazio é aceito (todos os futuros do lote)", async () => {
    vi.mocked(obterLote).mockResolvedValue(lote());
    vi.mocked(trocarStatusLote).mockResolvedValue(true);
    vi.mocked(inngest.send).mockResolvedValue({ ids: [] } as never);
    const res = await enviar(post(), ctx(ID));
    expect(res.status).toBe(202);
    expect(inngest.send).toHaveBeenCalledWith({ name: "lote/enviar", data: { loteId: ID } });
  });

  it("fila indisponível: 502 fila_indisponivel e o lote volta ao status anterior", async () => {
    vi.mocked(obterLote).mockResolvedValue(lote("importado"));
    vi.mocked(trocarStatusLote).mockResolvedValue(true);
    vi.mocked(inngest.send).mockRejectedValue(new Error("sem chave"));
    const res = await enviar(post(), ctx(ID));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, erro: "fila_indisponivel" });
    expect(trocarStatusLote).toHaveBeenLastCalledWith(ID, "enviando", "importado");
  });

  it("validação: id não-uuid, data malformada/inexistente, JSON inválido -> 400", async () => {
    expect((await enviar(post(), ctx("123"))).status).toBe(400);
    expect((await enviar(post({ data: "20/10/2026" }), ctx(ID))).status).toBe(400);
    expect((await enviar(post({ data: "2026-13-45" }), ctx(ID))).status).toBe(400);
    const ruim = new NextRequest(`http://x/api/lotes/${ID}/enviar`, { method: "POST", body: "{nao json" });
    expect((await enviar(ruim, ctx(ID))).status).toBe(400);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("lote já enviando ou perdeu a corrida: 409, sem enfileirar", async () => {
    vi.mocked(obterLote).mockResolvedValue(lote("enviando", new Date()));
    expect((await enviar(post(), ctx(ID))).status).toBe(409);
    vi.mocked(obterLote).mockResolvedValue(lote("importado"));
    vi.mocked(trocarStatusLote).mockResolvedValue(false);
    expect((await enviar(post(), ctx(ID))).status).toBe(409);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("enviando parado há mais de 10 min é reenviável (retomada atômica)", async () => {
    vi.mocked(obterLote).mockResolvedValue(lote("enviando", new Date(Date.now() - 11 * 60_000)));
    vi.mocked(trocarStatusLote).mockResolvedValue(true);
    vi.mocked(inngest.send).mockResolvedValue({ ids: [] } as never);
    const res = await enviar(post(), ctx(ID));
    expect(res.status).toBe(202);
    expect(trocarStatusLote).toHaveBeenCalledWith(ID, "enviando", "enviando", { enviandoAntesDe: expect.any(Date) });
    expect(inngest.send).toHaveBeenCalledTimes(1);
  });

  it("enviando sem enviando_desde (dado antigo) também conta como parado", async () => {
    vi.mocked(obterLote).mockResolvedValue(lote("enviando", null));
    vi.mocked(trocarStatusLote).mockResolvedValue(true);
    vi.mocked(inngest.send).mockResolvedValue({ ids: [] } as never);
    expect((await enviar(post(), ctx(ID))).status).toBe(202);
  });

  it("lote inexistente: 404", async () => {
    vi.mocked(obterLote).mockResolvedValue(null);
    expect((await enviar(post(), ctx(ID))).status).toBe(404);
  });
});
