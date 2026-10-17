import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/db/queries/lotes", () => ({ buscarClinicaPadrao: vi.fn() }));
vi.mock("@/db/queries/agenda", () => ({ listarAgendaDoDia: vi.fn() }));

import { GET } from "./route";
import { buscarClinicaPadrao } from "@/db/queries/lotes";
import { listarAgendaDoDia } from "@/db/queries/agenda";

const get = (qs = "") => GET(new NextRequest(`http://x/api/agenda${qs}`));
const linha = {
  id: "a1", atendimento: "Consulta", profissional: "Dra. Ana", dataHora: new Date("2026-10-16T12:30:00Z"),
  status: "enviado", pacienteNome: "Maria Souza", pacienteTelefone: "5511900001234",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(buscarClinicaPadrao).mockResolvedValue({ id: "c1", fuso: "America/Sao_Paulo", phoneNumberId: "1", tokenRef: null });
  vi.mocked(listarAgendaDoDia).mockResolvedValue([linha]);
});
afterEach(() => vi.useRealTimers());

describe("GET /api/agenda", () => {
  it("devolve o dia pedido, com intervalo no fuso da clínica e dados protegidos", async () => {
    const res = await get("?data=2026-10-16");
    const json = await res.json();
    expect(res.status).toBe(200);
    const [clinicaId, inicio, fim] = vi.mocked(listarAgendaDoDia).mock.calls[0];
    expect(clinicaId).toBe("c1");
    expect(inicio.toISOString()).toBe("2026-10-16T03:00:00.000Z");
    expect(fim.toISOString()).toBe("2026-10-17T03:00:00.000Z");
    expect(json).toMatchObject({
      ok: true, data: "2026-10-16", profissionais: ["Dra. Ana"], contagemPorStatus: { enviado: 1 },
      agendamentos: [{ id: "a1", horaLocal: "09:30", pacienteNome: "Maria S.", telefone: "(11) 9****-1234", status: "enviado" }],
    });
    expect(JSON.stringify(json)).not.toContain("5511900001234");
  });
  it("sem data: usa hoje no fuso da clínica", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T01:00:00Z")); // ainda 16/10 em São Paulo
    const json = await (await get()).json();
    expect(json.data).toBe("2026-10-16");
  });
  it("filtra por profissional no servidor", async () => {
    const json = await (await get("?data=2026-10-16&profissional=Outro")).json();
    expect(json.agendamentos).toEqual([]);
    expect(json.profissionais).toEqual(["Dra. Ana"]);
  });
  it("data inválida: 400 sem tocar no banco", async () => {
    for (const qs of ["?data=2026-02-30", "?data=16/10/2026", "?data=x"]) {
      const res = await get(qs);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ ok: false, erro: "parametros_invalidos" });
    }
    expect(listarAgendaDoDia).not.toHaveBeenCalled();
  });
  it("sem clínica: 503; falha no banco: 500", async () => {
    vi.mocked(buscarClinicaPadrao).mockResolvedValueOnce(null);
    expect((await get("?data=2026-10-16")).status).toBe(503);
    vi.mocked(listarAgendaDoDia).mockRejectedValueOnce(new Error("boom"));
    const res = await get("?data=2026-10-16");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, erro: "erro_interno" });
  });
});
