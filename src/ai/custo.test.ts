import { describe, it, expect } from "vitest";
import { calcularCustoUsd } from "./custo";

describe("calcularCustoUsd", () => {
  it("Haiku 4.5: US$ 1 / US$ 5 por MTok", () => {
    expect(calcularCustoUsd("claude-haiku-4-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })?.total).toBeCloseTo(6);
  });
  it("Sonnet 4.6: US$ 3 / US$ 15 por MTok", () => {
    expect(calcularCustoUsd("claude-sonnet-4-6", { input_tokens: 20_000, output_tokens: 8_000 })?.total).toBeCloseTo(0.18);
  });
  it("modelo sem preço → null", () => {
    expect(calcularCustoUsd("modelo-x", { input_tokens: 1, output_tokens: 1 })).toBeNull();
  });
});
