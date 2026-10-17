import { describe, expect, it } from "vitest";
import type { ConversaResumo } from "@/lib/schemas-conversas";
import {
  agendamentoPadrao, AVISO_FORA_DA_JANELA, contarExcecoes, horarioRelativo, mensagemErroAcao,
  ordenarConversas, percentual, textoValido,
} from "./conversas";

const agora = new Date("2026-10-16T12:00:00Z");

describe("horarioRelativo", () => {
  it("formata faixas", () => {
    expect(horarioRelativo("2026-10-16T11:59:40Z", agora)).toBe("agora");
    expect(horarioRelativo("2026-10-16T11:55:00Z", agora)).toBe("há 5 min");
    expect(horarioRelativo("2026-10-16T09:00:00Z", agora)).toBe("há 3 h");
    expect(horarioRelativo("2026-10-15T11:00:00Z", agora)).toBe("ontem");
    expect(horarioRelativo("2026-10-12T12:00:00Z", agora)).toBe("há 4 dias");
    expect(horarioRelativo("2026-09-01T12:00:00Z", agora)).toBe("01/09");
    expect(horarioRelativo("x", agora)).toBe("—");
  });
});

describe("agendamentoPadrao", () => {
  const ags = [
    { id: "a", dataHora: "2026-10-10T12:00:00Z", status: "confirmado" },
    { id: "b", dataHora: "2026-10-20T12:00:00Z", status: "enviado" },
    { id: "c", dataHora: "2026-10-25T12:00:00Z", status: "excecao" },
  ];
  it("prefere o foco, depois exceção, depois próximo futuro, depois o mais recente", () => {
    expect(agendamentoPadrao(ags, "a", agora)?.id).toBe("a");
    expect(agendamentoPadrao(ags, "zzz", agora)?.id).toBe("c");
    expect(agendamentoPadrao(ags.slice(0, 2), null, agora)?.id).toBe("b");
    expect(agendamentoPadrao(ags.slice(0, 1), null, agora)?.id).toBe("a");
    expect(agendamentoPadrao([], null, agora)).toBeNull();
  });
});

describe("mensagemErroAcao", () => {
  it("traduz códigos conhecidos e usa a da API nos desconhecidos", () => {
    expect(mensagemErroAcao("fora_da_janela")).toBe(AVISO_FORA_DA_JANELA);
    expect(mensagemErroAcao("envio_falhou")).toMatch(/Não foi possível enviar/);
    expect(mensagemErroAcao("sem_agendamento")).toMatch(/agendamento/);
    expect(mensagemErroAcao("novo", "Texto da API")).toBe("Texto da API");
    expect(mensagemErroAcao(undefined)).toMatch(/Algo deu errado/);
  });
});

describe("lista e texto", () => {
  const mk = (id: string, temExcecao: boolean): ConversaResumo => ({
    pacienteId: id, nome: "A B.", telefone: "(11) 9****-1234",
    ultimaMensagem: { trecho: "x", direcao: "recebida", quando: "2026-10-16T11:00:00Z" }, agendamento: null, temExcecao,
  });
  it("ordena exceções primeiro de forma estável e conta", () => {
    const l = [mk("1", false), mk("2", true), mk("3", false), mk("4", true)];
    expect(ordenarConversas(l, true).map((c) => c.pacienteId)).toEqual(["2", "4", "1", "3"]);
    expect(ordenarConversas(l, false)).toBe(l);
    expect(contarExcecoes(l)).toBe(2);
  });
  it("valida texto e percentual", () => {
    expect(textoValido("  ")).toBe(false);
    expect(textoValido("oi")).toBe(true);
    expect(textoValido("a".repeat(1001))).toBe(false);
    expect(percentual(0.912)).toBe("91%");
  });
});
