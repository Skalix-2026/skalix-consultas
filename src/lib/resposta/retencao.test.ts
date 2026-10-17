import { describe, it, expect, vi, beforeEach } from "vitest";
import { RETENCAO_RESPOSTAS_DIAS, respostaVencida, rodarAnonimizarRespostas } from "./retencao";

const AGORA = new Date("2026-10-16T12:00:00Z");
const diasAtras = (n: number) => new Date(AGORA.getTime() - n * 24 * 3600_000);

beforeEach(() => { vi.spyOn(console, "log").mockImplementation(() => {}); });

describe("respostaVencida", () => {
  it("prazo é 90 dias", () => expect(RETENCAO_RESPOSTAS_DIAS).toBe(90));
  it("89 e 90 dias não vencem; 91 vence", () => {
    expect(respostaVencida(diasAtras(89), AGORA)).toBe(false);
    expect(respostaVencida(diasAtras(90), AGORA)).toBe(false);
    expect(respostaVencida(diasAtras(91), AGORA)).toBe(true);
  });
  it("aceita string ISO; data inválida não vence", () => {
    expect(respostaVencida(diasAtras(100).toISOString(), AGORA)).toBe(true);
    expect(respostaVencida("lixo", AGORA)).toBe(false);
  });
});

describe("rodarAnonimizarRespostas", () => {
  const mk = (r: number, e: number) => ({
    agora: () => AGORA,
    anonimizarAnterioresA: vi.fn(async () => r),
    anonimizarEventosAnterioresA: vi.fn(async () => e),
  });

  it("um UPDATE por tabela com corte exato de 90 dias; devolve e loga só as duas contagens", async () => {
    const deps = mk(4, 7);
    const r = await rodarAnonimizarRespostas(deps);
    expect(r).toEqual({ respostas: 4, eventos: 7 });
    expect(deps.anonimizarAnterioresA).toHaveBeenCalledTimes(1);
    expect(deps.anonimizarEventosAnterioresA).toHaveBeenCalledTimes(1);
    expect(deps.anonimizarAnterioresA).toHaveBeenCalledWith(diasAtras(90));
    expect(deps.anonimizarEventosAnterioresA).toHaveBeenCalledWith(diasAtras(90));
    expect(console.log).toHaveBeenCalledWith(expect.any(String), { respostas: 4, eventos: 7 });
  });

  it("nada vencido: contagens 0 e sem log", async () => {
    expect(await rodarAnonimizarRespostas(mk(0, 0))).toEqual({ respostas: 0, eventos: 0 });
    expect(console.log).not.toHaveBeenCalled();
  });

  it("só eventos vencidos também loga", async () => {
    expect(await rodarAnonimizarRespostas(mk(0, 2))).toEqual({ respostas: 0, eventos: 2 });
    expect(console.log).toHaveBeenCalledWith(expect.any(String), { respostas: 0, eventos: 2 });
  });

  it("idempotente com stub que só conta linhas ainda não anonimizadas", async () => {
    const pendentes = { respostas: 3, eventos: 5 };
    const consome = (k: "respostas" | "eventos") => async () => { const n = pendentes[k]; pendentes[k] = 0; return n; };
    const deps = { agora: () => AGORA, anonimizarAnterioresA: consome("respostas"), anonimizarEventosAnterioresA: consome("eventos") };
    expect(await rodarAnonimizarRespostas(deps)).toEqual({ respostas: 3, eventos: 5 });
    expect(await rodarAnonimizarRespostas(deps)).toEqual({ respostas: 0, eventos: 0 });
  });
});
