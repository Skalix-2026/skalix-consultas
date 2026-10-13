import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/db/queries/lotes", () => ({
  buscarClinicaPadrao: vi.fn(),
  buscarLotePorHash: vi.fn(),
  criarLoteComAgendamentos: vi.fn(),
}));
// a rota nunca deve chegar na IA com planilha de cabeçalho conhecido; se chegar, o teste falha
vi.mock("@/ai/harness/mapear-colunas", async (orig) => ({
  ...(await orig<object>()),
  mapearColunas: vi.fn(() => { throw new Error("IA não deveria ser chamada"); }),
}));

import { POST } from "./route";
import { buscarClinicaPadrao, buscarLotePorHash, criarLoteComAgendamentos } from "@/db/queries/lotes";

const clinica = vi.mocked(buscarClinicaPadrao);
const porHash = vi.mocked(buscarLotePorHash);
const criar = vi.mocked(criarLoteComAgendamentos);

function req(arquivo?: File | string) {
  const f = new FormData();
  if (arquivo !== undefined) f.set("arquivo", arquivo);
  return new NextRequest("http://x/api/importar", { method: "POST", body: f });
}

const CSV = "Nome;Telefone;Atendimento;Data;Hora\nMaria Souza;(11) 90000-0101;Consulta;20/10/2099;08:00\n";

beforeEach(() => {
  vi.clearAllMocks();
  clinica.mockResolvedValue({ id: "c1", fuso: "America/Sao_Paulo", phoneNumberId: "1", tokenRef: null });
  porHash.mockResolvedValue(null);
  criar.mockResolvedValue({ loteId: "lote-1", inseridas: 1, duplicadas: 0 });
});

describe("POST /api/importar", () => {
  it("caminho feliz: 200 com o contrato tipado", async () => {
    const res = await POST(req(new File([CSV], "agenda.csv", { type: "text/csv" })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true, loteId: "lote-1", reaproveitado: false, totalLinhas: 1, validas: 1, duplicadas: 0, invalidas: [], avisos: [],
    });
    expect(criar).toHaveBeenCalledTimes(1);
  });

  it("arquivo acima de 5 MB: 413", async () => {
    const res = await POST(req(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "grande.csv")));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ ok: false, erro: "arquivo_grande" });
    expect(criar).not.toHaveBeenCalled();
  });

  it("formato inválido: 415", async () => {
    const res = await POST(req(new File(["x"], "agenda.docx")));
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ ok: false, erro: "formato_invalido" });
  });

  it("sem o campo arquivo (ou texto no lugar de arquivo): 400", async () => {
    expect((await POST(req())).status).toBe(400);
    expect((await POST(req("texto"))).status).toBe(400);
  });

  it("sem clínica cadastrada: 409 sem_clinica", async () => {
    clinica.mockResolvedValue(null);
    const res = await POST(req(new File([CSV], "agenda.csv")));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, erro: "sem_clinica" });
  });

  it("falha inesperada no banco: 500 genérico, sem vazar detalhes", async () => {
    criar.mockRejectedValue(new Error("connection refused postgres://user:senha@host"));
    const res = await POST(req(new File([CSV], "agenda.csv")));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("senha");
  });
});
