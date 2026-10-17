import { describe, it, expect, vi, beforeEach } from "vitest";
import { ERRO_PENDENTE_VENCIDA, PENDENTE_VENCE_MS, pendenteVencida, rodarRecuperarPendentes } from "./pendentes";

const AGORA = new Date("2026-10-16T12:00:00Z");
const minAtras = (n: number) => new Date(AGORA.getTime() - n * 60_000);

beforeEach(() => { vi.spyOn(console, "log").mockImplementation(() => {}); });

describe("pendenteVencida", () => {
  it("limite é 15 min", () => expect(PENDENTE_VENCE_MS).toBe(15 * 60_000));
  it("14 min não vence, 16 min vence", () => {
    expect(pendenteVencida(minAtras(14), AGORA)).toBe(false);
    expect(pendenteVencida(minAtras(15), AGORA)).toBe(false);
    expect(pendenteVencida(minAtras(16), AGORA)).toBe(true);
  });
  it("data inválida não vence", () => expect(pendenteVencida("lixo", AGORA)).toBe(false));
});

describe("rodarRecuperarPendentes", () => {
  it("chama um único UPDATE com corte de 15 min e erro fixo; devolve só a contagem", async () => {
    const marcarVencidas = vi.fn(async () => 3);
    const r = await rodarRecuperarPendentes({ agora: () => AGORA, marcarVencidas });
    expect(r).toEqual({ recuperadas: 3 });
    expect(marcarVencidas).toHaveBeenCalledTimes(1);
    expect(marcarVencidas).toHaveBeenCalledWith(minAtras(15), ERRO_PENDENTE_VENCIDA);
    expect(console.log).toHaveBeenCalledWith(expect.any(String), { recuperadas: 3 });
  });

  it("sem vencidas: contagem 0 e sem log", async () => {
    const r = await rodarRecuperarPendentes({ agora: () => AGORA, marcarVencidas: async () => 0 });
    expect(r).toEqual({ recuperadas: 0 });
    expect(console.log).not.toHaveBeenCalled();
  });

  it("erro fixo não contém dados de paciente", () => {
    expect(ERRO_PENDENTE_VENCIDA).toBe("Envio interrompido (sem confirmação); reenvio manual");
  });
});
