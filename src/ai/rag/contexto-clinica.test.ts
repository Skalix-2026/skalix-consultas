import { describe, it, expect } from "vitest";
import { montarContexto, MAX_CARACTERES_ITEM, MAX_EXEMPLOS, MAX_REGRAS } from "./contexto-clinica";

const ex = (texto: string, intencao = "confirmou") => JSON.stringify({ texto, intencao });

describe("montarContexto", () => {
  it("prazo de cancelamento vira frase", () => {
    const c = montarContexto({ regras: { prazoCancelamentoHoras: 24 }, conhecimento: [], atendimento: "Cardiologia" });
    expect(c.regras).toEqual(["Cancelamento até 24 horas antes da consulta."]);
  });

  it("sem regras nem conhecimento: contexto vazio", () => {
    expect(montarContexto({ regras: null, conhecimento: [], atendimento: "X" })).toEqual({ regras: [], exemplos: [] });
  });

  it("preparo casa por normalização (acento, caixa, includes nos dois sentidos)", () => {
    const preparos = { "Ultrassom": "Bexiga cheia.", cardiologia: "Sem cafeína." };
    expect(montarContexto({ regras: { preparos }, conhecimento: [], atendimento: "ULTRASSOM abdominal" }).regras)
      .toEqual(["Preparo para Ultrassom: Bexiga cheia."]);
    expect(montarContexto({ regras: { preparos: { "ultrassom abdominal": "Jejum." } }, conhecimento: [], atendimento: "Ultrassom" }).regras)
      .toEqual(["Preparo para ultrassom abdominal: Jejum."]);
    expect(montarContexto({ regras: { preparos: { "Endócrino": "Jejum." } }, conhecimento: [], atendimento: "endocrino" }).regras)
      .toHaveLength(1);
  });

  it("preparo que não casa não é injetado", () => {
    const c = montarContexto({ regras: { preparos: { ultrassom: "Bexiga cheia." } }, conhecimento: [], atendimento: "Dermatologia" });
    expect(c.regras).toEqual([]);
  });

  it("regra e faq entram em regras; exemplo_classificado entra em exemplos; outros tipos são ignorados", () => {
    const c = montarContexto({
      atendimento: "X",
      conhecimento: [
        { tipo: "regra", conteudo: "Trazer documento.", criadoEm: new Date(2026, 0, 1) },
        { tipo: "faq", conteudo: "Aceitamos convênio Y.", criadoEm: new Date(2026, 0, 2) },
        { tipo: "exemplo_classificado", conteudo: ex("pode confirmar") },
        { tipo: "outro", conteudo: "ignorar" },
      ],
    });
    expect(c.regras).toEqual(["Trazer documento.", "Aceitamos convênio Y."]);
    expect(c.exemplos).toEqual([{ texto: "pode confirmar", intencao: "confirmou" }]);
  });

  it("exemplos inválidos (JSON ruim, intenção fora do enum, sem texto) são ignorados sem lançar", () => {
    const c = montarContexto({
      atendimento: "X",
      conhecimento: [
        { tipo: "exemplo_classificado", conteudo: "não é json" },
        { tipo: "exemplo_classificado", conteudo: ex("oi", "inventada") },
        { tipo: "exemplo_classificado", conteudo: JSON.stringify({ intencao: "cancelou" }) },
        { tipo: "exemplo_classificado", conteudo: ex("não vou", "cancelou") },
      ],
    });
    expect(c.exemplos).toEqual([{ texto: "não vou", intencao: "cancelou" }]);
  });

  it("limites: 8 regras, 10 exemplos, itens truncados", () => {
    const conhecimento = [
      ...Array.from({ length: 20 }, (_, i) => ({ tipo: "regra", conteudo: `r${i}`, criadoEm: new Date(2026, 0, i + 1) })),
      ...Array.from({ length: 20 }, (_, i) => ({ tipo: "exemplo_classificado", conteudo: ex(`e${i}`), criadoEm: new Date(2026, 0, i + 1) })),
      { tipo: "faq", conteudo: "a".repeat(1000), criadoEm: new Date(2025, 0, 1) },
    ];
    const c = montarContexto({ regras: { prazoCancelamentoHoras: 12 }, conhecimento, atendimento: "X" });
    expect(c.regras).toHaveLength(MAX_REGRAS);
    expect(c.exemplos).toHaveLength(MAX_EXEMPLOS);
    expect(c.regras[1]!.length).toBe(MAX_CARACTERES_ITEM); // faq antiga (truncada) vem primeiro entre as linhas
  });

  it("ordena por criadoEm independentemente da ordem de entrada", () => {
    const c = montarContexto({
      atendimento: "X",
      conhecimento: [
        { tipo: "regra", conteudo: "segunda", criadoEm: "2026-02-01T00:00:00Z" },
        { tipo: "regra", conteudo: "primeira", criadoEm: "2026-01-01T00:00:00Z" },
      ],
    });
    expect(c.regras).toEqual(["primeira", "segunda"]);
  });

  it("remove telefones e quebras de linha do conteúdo", () => {
    const c = montarContexto({
      atendimento: "X",
      conhecimento: [{ tipo: "regra", conteudo: "Ligue (11) 99999-1234\nou +55 11 98888 7777 agora" }],
    });
    expect(c.regras[0]).toBe("Ligue [telefone removido] ou [telefone removido] agora");
  });
});
