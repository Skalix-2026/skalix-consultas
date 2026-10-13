import { describe, it, expect } from "vitest";
import { normalizarTelefone } from "./telefone";

describe("normalizarTelefone", () => {
  it.each([
    ["(11) 98765-4321", "5511987654321"],
    ["11987654321", "5511987654321"],
    ["+55 11 98765-4321", "5511987654321"],
    ["5511987654321", "5511987654321"],
    ["011 98765-4321", "5511987654321"],
    ["(21) 3333-4444", "552133334444"],
    ["552133334444", "552133334444"],
    ["(55) 99876-5432", "5555998765432"], // DDD 55 (RS) sem DDI
  ])("aceita %s", (bruto, esperado) => {
    expect(normalizarTelefone(bruto)).toBe(esperado);
  });

  it.each([
    ["987654321", "sem DDD"],
    ["98765-4321", "sem DDD"],
    ["(05) 98765-4321", "DDD < 11"],
    ["(10) 98765-4321", "DDD < 11"],
    ["(20) 98765-4321", "DDD inexistente"],
    ["(11) 88765-4321", "celular de 9 dígitos sem 9 inicial"],
    ["(11) 8765-4321", "fixo começando com 8"],
    ["", "vazio"],
    ["abc", "sem dígitos"],
    ["+1 415 555 0100", "estrangeiro"],
  ])("rejeita %s (%s)", (bruto) => {
    expect(normalizarTelefone(bruto)).toBeNull();
  });
});
