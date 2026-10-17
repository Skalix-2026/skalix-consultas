import { describe, it, expect } from "vitest";
import { textoResposta, dataLocal } from "./textos";

// 2026-10-17 02:30 UTC = 16/10 23:30 em São Paulo, 22:30 em Manaus, 11:30 em Tóquio (mesmo dia 17)
const QUANDO = new Date("2026-10-17T02:30:00Z");
const base = { primeiroNome: "Maria", dataHora: QUANDO, fuso: "America/Sao_Paulo", profissional: "Dra. Ana" };

describe("textoResposta", () => {
  it("confirmou: texto fixo com profissional", () => {
    expect(textoResposta("confirmou", base)).toBe("Obrigado, Maria! Sua consulta de 16/10/2026 às 23:30 com Dra. Ana está confirmada.");
  });

  it("confirmou sem profissional (null, vazio ou espaços): omite ' com ...'", () => {
    for (const profissional of [null, undefined, "", "  "]) {
      expect(textoResposta("confirmou", { ...base, profissional })).toBe("Obrigado, Maria! Sua consulta de 16/10/2026 às 23:30 está confirmada.");
    }
  });
  it("profissional é limitado a 80 caracteres", () => {
    const t = textoResposta("confirmou", { ...base, profissional: "X".repeat(200) })!;
    expect(t).toContain(` com ${"X".repeat(80)} `.trimEnd());
    expect(t).not.toContain("X".repeat(81));
  });


  it("cancelou: texto fixo", () => {
    expect(textoResposta("cancelou", base)).toBe(
      "Tudo certo, Maria. Sua consulta de 16/10/2026 às 23:30 foi cancelada. Se quiser remarcar, é só responder aqui.",
    );
  });

  it("data e hora no fuso da clínica (a data pode mudar de dia)", () => {
    expect(textoResposta("confirmou", { ...base, fuso: "America/Manaus", profissional: null })).toContain("16/10/2026 às 22:30");
    expect(textoResposta("confirmou", { ...base, fuso: "Asia/Tokyo", profissional: null })).toContain("17/10/2026 às 11:30");
    expect(dataLocal(QUANDO, "America/Sao_Paulo")).toBe("16/10/2026");
  });

  it("nome vazio vira 'Paciente'", () => {
    expect(textoResposta("confirmou", { ...base, primeiroNome: " " })).toContain("Obrigado, Paciente!");
  });

  it.each(["quer_remarcar", "duvida", "nao_sou_eu", "fora_de_escopo", "qualquer"])("%s não gera texto automático", (i) => {
    expect(textoResposta(i, base)).toBeNull();
  });
});
