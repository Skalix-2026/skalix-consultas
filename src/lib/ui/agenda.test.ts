import { describe, it, expect } from "vitest";
import {
  agruparPorHora, contarPorGrupo, dataPorExtenso, dataValida, faixaHoras, grupoDoStatus, rotuloHora, somarDias, visualDoStatus,
} from "./agenda";
import { hojeNoFuso, horaLocal, limitesDoDia, montarAgenda } from "@/lib/agenda/dia";

describe("datas", () => {
  it("valida datas reais", () => {
    expect(dataValida("2026-10-16")).toBe(true);
    expect(dataValida("2026-02-30")).toBe(false);
    expect(dataValida("2026-2-3")).toBe(false);
    expect(dataValida("abc")).toBe(false);
  });
  it("soma dias sem erro na virada de mês/ano e em dias de horário de verão", () => {
    expect(somarDias("2026-10-31", 1)).toBe("2026-11-01");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(somarDias("2026-01-01", -1)).toBe("2025-12-31");
    expect(somarDias("2024-02-28", 1)).toBe("2024-02-29");
    expect(somarDias("2026-03-08", 1)).toBe("2026-03-09");
    expect(somarDias("2026-11-01", -1)).toBe("2026-10-31");
  });
  it("data por extenso em português", () => {
    expect(dataPorExtenso("2026-10-16")).toBe("sexta-feira, 16 de outubro de 2026");
  });
});

describe("limites do dia por fuso", () => {
  it("São Paulo (-03:00): meia-noite local = 03:00Z", () => {
    const { inicio, fim } = limitesDoDia("2026-10-16", "America/Sao_Paulo");
    expect(inicio.toISOString()).toBe("2026-10-16T03:00:00.000Z");
    expect(fim.toISOString()).toBe("2026-10-17T03:00:00.000Z");
  });
  it("Manaus (-04:00)", () => {
    expect(limitesDoDia("2026-10-16", "America/Manaus").inicio.toISOString()).toBe("2026-10-16T04:00:00.000Z");
  });
  it("virada de horário de verão: dia de 23 h (Nova York, 08/03/2026)", () => {
    const { inicio, fim } = limitesDoDia("2026-03-08", "America/New_York");
    expect(inicio.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(fim.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect((fim.getTime() - inicio.getTime()) / 3_600_000).toBe(23);
  });
  it("agendamento às 23:30 locais fica no dia certo (e 00:00 do dia seguinte fica fora)", () => {
    const { inicio, fim } = limitesDoDia("2026-10-16", "America/Sao_Paulo");
    const tarde = new Date("2026-10-17T02:30:00Z"); // 23:30 local
    const meiaNoite = new Date("2026-10-17T03:00:00Z");
    expect(tarde >= inicio && tarde < fim).toBe(true);
    expect(meiaNoite < fim).toBe(false);
  });
  it("hoje no fuso da clínica (22h em SP ainda é o mesmo dia, mesmo já sendo o dia seguinte em UTC)", () => {
    expect(hojeNoFuso("America/Sao_Paulo", new Date("2026-10-17T01:00:00Z"))).toBe("2026-10-16");
    expect(hojeNoFuso("America/Sao_Paulo", new Date("2026-10-16T03:00:00Z"))).toBe("2026-10-16");
    expect(hojeNoFuso("America/Sao_Paulo", new Date("2026-10-16T02:59:00Z"))).toBe("2026-10-15");
  });
  it("hora local HH:mm", () => {
    expect(horaLocal(new Date("2026-10-16T12:30:00Z"), "America/Sao_Paulo")).toBe("09:30");
    expect(horaLocal(new Date("2026-10-16T03:00:00Z"), "America/Sao_Paulo")).toBe("00:00");
  });
});

describe("grade de horários", () => {
  it("faixa padrão 07h-19h e expansão", () => {
    expect(faixaHoras([])).toEqual({ inicio: 7, fim: 19 });
    expect(faixaHoras(["09:00"])).toEqual({ inicio: 7, fim: 19 });
    expect(faixaHoras(["06:30", "21:00"])).toEqual({ inicio: 6, fim: 21 });
  });
  it("agrupa por hora, inclusive horas vazias, mantendo a ordem", () => {
    const g = agruparPorHora([{ horaLocal: "08:00", n: 1 }, { horaLocal: "08:30", n: 2 }, { horaLocal: "10:00", n: 3 }]);
    expect(g).toHaveLength(13);
    expect(g[0].hora).toBe(7);
    expect(g.find((x) => x.hora === 8)?.itens.map((i) => i.n)).toEqual([1, 2]);
    expect(g.find((x) => x.hora === 9)?.itens).toEqual([]);
    expect(rotuloHora(8)).toBe("08h");
  });
  it("hora fora da faixa amplia a grade", () => {
    const g = agruparPorHora([{ horaLocal: "05:15" }, { horaLocal: "20:00" }]);
    expect(g[0].hora).toBe(5);
    expect(g.at(-1)?.hora).toBe(20);
    expect(g[0].itens).toHaveLength(1);
  });
});

describe("status", () => {
  it("mapeia status do banco para grupo/rótulo", () => {
    expect(grupoDoStatus("inserido")).toBe("aguardando");
    expect(visualDoStatus("inserido").rotulo).toBe("Aguardando envio");
    expect(visualDoStatus("respondido").rotulo).toBe("Respondido");
    expect(grupoDoStatus("nao_sou_eu")).toBe("excecao");
    expect(visualDoStatus("excecao").icone).toBe("!");
    expect(grupoDoStatus("qualquer")).toBe("aguardando");
  });
  it("conta por grupo somando legados", () => {
    expect(contarPorGrupo({ excecao: 1, nao_sou_eu: 2, inserido: 3, confirmado: 4 })).toMatchObject({ excecao: 3, aguardando: 3, confirmado: 4, cancelado: 0 });
  });
});

describe("montarAgenda", () => {
  const base = { dataHora: new Date("2026-10-16T12:00:00Z"), pacienteNome: "Maria Souza", pacienteTelefone: "5511900001234" };
  const linhas = [
    { id: "b", atendimento: "Retorno", profissional: "Dr. Paulo", status: "confirmado", ...base, dataHora: new Date("2026-10-16T13:00:00Z") },
    { id: "a", atendimento: "Consulta", profissional: "Dra. Ana", status: "excecao", ...base },
    { id: "c", atendimento: "Exame", profissional: null, status: "excecao", ...base },
  ];
  it("ordena, mascara, abrevia e filtra no servidor; profissionais são do dia todo", () => {
    const r = montarAgenda(linhas, { data: "2026-10-16", fuso: "America/Sao_Paulo", profissional: "Dra. Ana" });
    expect(r.profissionais).toEqual(["Dr. Paulo", "Dra. Ana"]);
    expect(r.agendamentos.map((a) => a.id)).toEqual(["a"]);
    expect(r.agendamentos[0]).toMatchObject({ horaLocal: "09:00", pacienteNome: "Maria S.", telefone: "(11) 9****-1234", profissional: "Dra. Ana" });
    expect(r.contagemPorStatus).toEqual({ excecao: 1 });
    expect(JSON.stringify(r)).not.toContain("5511900001234");
    expect(JSON.stringify(r)).not.toContain("Souza");
  });
  it("sem filtro: ordenado por horário", () => {
    const r = montarAgenda(linhas, { data: "2026-10-16", fuso: "America/Sao_Paulo" });
    expect(r.agendamentos.map((a) => a.id)).toEqual(["a", "c", "b"]);
    expect(r.contagemPorStatus).toEqual({ excecao: 2, confirmado: 1 });
  });
});
