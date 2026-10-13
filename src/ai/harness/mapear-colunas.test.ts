import { describe, it, expect, vi } from "vitest";
import { ZodError } from "zod";
import { mapearColunas, cabecalhoPareceDado, SemCabecalhoError, type ResultadoMapeamento } from "./mapear-colunas";
import { cacheFalso, clienteFalso, HASH, HASH_2 } from "../test/cliente-falso";

vi.mock("../custo", () => ({ registrarUso: vi.fn() }));

const cabecalhos = ["Paciente", "Celular", "Procedimento", "Médico", "Data", "Hora"];
const amostra = [
  { Paciente: "Maria Aparecida Souza", Celular: "(11) 98765-4321", Procedimento: "Consulta Cardiologia", Médico: "Dr. João Pereira", Data: "08/10/2026", Hora: "14:30" },
  { Paciente: "Oliveira, José Carlos", Celular: "+55 21 3333-4444", Procedimento: "Ecocardiograma", Médico: "Dra. Ana Lima", Data: "09/10/2026", Hora: "08:00" },
  { Paciente: "Pedro Henrique Alves Neto", Celular: "11912345678", Procedimento: "Retorno", Médico: "Dr. João Pereira", Data: "10/10/2026", Hora: "09:15" },
];

const respostaOk = JSON.stringify({
  colunas: { nome: "Paciente", telefone: "Celular", atendimento: "Procedimento", profissional: "Médico", data: "Data", hora: "Hora" },
  formatoData: "dd/MM/yyyy",
  confianca: 0.95,
});

const entrada = { arquivoHash: HASH, cabecalhos, amostra };
const novoCache = () => cacheFalso<ResultadoMapeamento>();

describe("mapearColunas", () => {
  it("caminho feliz: devolve mapeamento com origem haiku, hash e confiança, e grava no cache", async () => {
    const { client, parametros } = clienteFalso(`Aqui está:\n${respostaOk}`);
    const { cache, set } = novoCache();
    const r = await mapearColunas(entrada, cache, client);
    expect(r).toEqual({
      colunas: { nome: "Paciente", telefone: "Celular", atendimento: "Procedimento", profissional: "Médico", data: "Data", hora: "Hora" },
      formatoData: "dd/MM/yyyy",
      origem: "haiku",
      arquivoHash: HASH,
      confianca: 0.95,
    });
    expect(parametros()).toMatchObject({ max_tokens: 400, temperature: 0, model: "claude-haiku-4-5" });
    expect(set).toHaveBeenCalledWith(HASH, r);
  });

  it("nenhum dígito real, e-mail ou sobrenome chega ao modelo", async () => {
    const { client, enviado, enviadoUsuario } = clienteFalso(respostaOk);
    const comEmail = [{ ...amostra[0], Paciente: "Maria-Silva Souza", Procedimento: "maria@x.com" }, amostra[1], amostra[2]];
    await mapearColunas({ ...entrada, amostra: comEmail }, novoCache().cache, client);
    const s = enviado();
    for (const proibido of ["4321", "3333", "4444", "1234", "5678", "2026", "14:30", "08:00", "09:15", "maria@x.com",
      "Aparecida", "Souza", "Oliveira", "Carlos", "Henrique", "Alves", "Neto", "Pereira", "Lima", "Silva"]) {
      expect(s).not.toContain(proibido);
    }
    // Fora do SYSTEM (que usa 9s de exemplo), nenhum dígito diferente de 9 vai ao modelo.
    expect(enviadoUsuario()).not.toMatch(/[0-8]/);
    expect(s).toContain("(99) 99999-9999");
    expect(s).toContain("99/99/9999");
    expect(s).toContain("[email]");
    expect(s).toContain("[texto]");
    expect(s).toContain("José");
  });

  it("cabeçalhos também vão só na forma e o original é devolvido", async () => {
    const cab = ["Nome", "Telefone 1", "Telefone 2", "Data"];
    const { client, enviado } = clienteFalso(
      JSON.stringify({ colunas: { nome: "Nome", telefone: "Telefone 9", data: "Data" }, formatoData: "dd/MM/yyyy", confianca: 0.6 }),
    );
    const r = await mapearColunas({ arquivoHash: HASH, cabecalhos: cab, amostra: [] }, novoCache().cache, client);
    expect(enviado()).toContain('\\"Telefone 9\\",\\"Telefone 9 #2\\"');
    expect(r.colunas.telefone).toBe("Telefone 1");
    expect(r.confianca).toBe(0.6);
  });

  it("arquivo sem linha de cabeçalho (1ª linha é dado) → SemCabecalhoError sem chamar o modelo", async () => {
    const semCabecalho = [
      ["Maria", "11987654321", "Consulta", "08/10/2026"],
      ["Maria Aparecida Souza", "Consulta Cardiologia", "Dr. João Pereira"],
      ["Paciente", "maria@x.com"],
      ["Nome", "123.456.789-00"],
      ["Nome", "14:30"],
    ];
    for (const cab of semCabecalho) {
      const { client, create } = clienteFalso(respostaOk);
      const erro = await mapearColunas({ arquivoHash: HASH, cabecalhos: cab, amostra: [] }, novoCache().cache, client).catch((e) => e);
      expect(erro).toBeInstanceOf(SemCabecalhoError);
      expect((erro as Error).message).not.toMatch(/Maria|Souza|9876|@/); // mensagem sem dado pessoal
      expect(create).not.toHaveBeenCalled();
    }
  });

  it("cabecalhoPareceDado: cabeçalhos reais passam", () => {
    for (const h of ["Nome do Paciente", "Data Agendamento", "Médico Responsável", "Telefone Celular", "Hora", "Convênio",
      "Cód. Agendamento", "Paciente", "Procedimento", "Unnamed"]) {
      expect(cabecalhoPareceDado(h), h).toBe(false);
    }
    for (const h of ["Maria Souza", "Dr. João Pereira", "(11) 98765-4321", "08/10/2026", "45938", "ana@x.com", "14h30"]) {
      expect(cabecalhoPareceDado(h), h).toBe(true);
    }
  });

  it("cache: segunda chamada com o mesmo hash não chama o client", async () => {
    const { client, create } = clienteFalso(respostaOk);
    const { cache, set } = novoCache();
    const r1 = await mapearColunas(entrada, cache, client);
    const r2 = await mapearColunas(entrada, cache, client);
    expect(r2).toEqual(r1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(1);
    // outro arquivo chama de novo
    await mapearColunas({ ...entrada, arquivoHash: HASH_2 }, cache, client);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("cache: erro na IA não grava nada", async () => {
    const { client } = clienteFalso("sem json");
    const { cache, set } = novoCache();
    await expect(mapearColunas(entrada, cache, client)).rejects.toThrow();
    expect(set).not.toHaveBeenCalled();
  });

  it("cache: falha no get não chama o modelo; falha no set não perde o resultado", async () => {
    const { client, create } = clienteFalso(respostaOk);
    const quebrado = { get: vi.fn().mockRejectedValue(new Error("db fora")), set: vi.fn() };
    await expect(mapearColunas(entrada, quebrado, client)).rejects.toThrow(/db fora/);
    expect(create).not.toHaveBeenCalled();

    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setQuebra = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockRejectedValue(new Error("db fora")) };
    const r = await mapearColunas(entrada, setQuebra, client);
    expect(r.origem).toBe("haiku");
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it("arquivoHash obrigatório (sha256 hex)", async () => {
    const { client, create } = clienteFalso(respostaOk);
    await expect(mapearColunas({ ...entrada, arquivoHash: "x" }, novoCache().cache, client)).rejects.toBeInstanceOf(ZodError);
    expect(create).not.toHaveBeenCalled();
  });

  it("cabeçalho com mais de 200 caracteres → ZodError antes de chamar o modelo", async () => {
    const { client, create } = clienteFalso(respostaOk);
    await expect(
      mapearColunas({ ...entrada, cabecalhos: ["Nome", "x".repeat(201)] }, novoCache().cache, client),
    ).rejects.toBeInstanceOf(ZodError);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejeita cabeçalho inexistente retornado pela IA", async () => {
    const { client } = clienteFalso(JSON.stringify({ colunas: { nome: "Nome do Paciente" }, formatoData: null, confianca: 0.9 }));
    await expect(mapearColunas(entrada, novoCache().cache, client)).rejects.toThrow(/cabeçalho inexistente/);
  });

  it("JSON fora do formato → ZodError", async () => {
    const { client } = clienteFalso(JSON.stringify({ colunas: { paciente: "Paciente" }, formatoData: "dd/mm/aa", confianca: 2 }));
    await expect(mapearColunas(entrada, novoCache().cache, client)).rejects.toBeInstanceOf(ZodError);
  });

  it("resposta sem JSON → erro explícito", async () => {
    const { client } = clienteFalso("Não consegui identificar as colunas.");
    await expect(mapearColunas(entrada, novoCache().cache, client)).rejects.toThrow(/não retornou JSON/);
  });

  it("resposta cortada por max_tokens → erro explícito", async () => {
    const { client } = clienteFalso(respostaOk, "max_tokens");
    await expect(mapearColunas(entrada, novoCache().cache, client)).rejects.toThrow(/max_tokens/);
  });

  it("entrada inválida (mais de 3 linhas de amostra) falha antes de chamar o modelo", async () => {
    const { client, create } = clienteFalso(respostaOk);
    await expect(
      mapearColunas({ ...entrada, amostra: [...amostra, amostra[0]] }, novoCache().cache, client),
    ).rejects.toBeInstanceOf(ZodError);
    expect(create).not.toHaveBeenCalled();
  });
});
