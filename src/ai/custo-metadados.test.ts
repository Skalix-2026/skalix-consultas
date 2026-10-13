import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

const generation = vi.fn();
vi.mock("langfuse", () => ({
  Langfuse: class {
    generation = generation;
    flushAsync = vi.fn().mockResolvedValue(undefined);
  },
}));

const usage = { input_tokens: 10, output_tokens: 5 };
const ID = "3f1c2a4e-8b7d-4c1e-9a2b-5d6e7f8a9b0c";

describe("registrarUso: metadados estritos", () => {
  beforeAll(() => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-teste");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-teste");
  });
  afterEach(() => {
    generation.mockClear();
    vi.restoreAllMocks();
  });

  it("metadados válidos chegam ao Langfuse", async () => {
    const { registrarUso } = await import("./custo");
    await registrarUso({ tarefa: "t", modelo: "claude-haiku-4-5", usage, metadados: { agendamento_id: ID, linhas_estimadas: 3 } });
    expect(generation.mock.calls[0][0].metadata).toEqual({ tarefa: "t", agendamento_id: ID, linhas_estimadas: 3 });
  });

  it("chave desconhecida (ex.: nome) → descarta tudo, avisa sem o valor e não derruba", async () => {
    const { registrarUso } = await import("./custo");
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const invalido = { agendamento_id: ID, nome: "Maria Souza" } as never;
    await expect(registrarUso({ tarefa: "t", modelo: "claude-haiku-4-5", usage, metadados: invalido })).resolves.toBeUndefined();
    expect(generation.mock.calls[0][0].metadata).toEqual({ tarefa: "t" });
    expect(aviso).toHaveBeenCalledTimes(1);
    const msg = String(aviso.mock.calls[0][0]);
    expect(msg).not.toContain("Maria");
    expect(msg).not.toContain(ID);
  });

  it("id que não é uuid (ex.: telefone) → descartado sem vazar no log", async () => {
    const { registrarUso } = await import("./custo");
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    await registrarUso({ tarefa: "t", modelo: "claude-haiku-4-5", usage, metadados: { lote_id: "11987654321" } });
    expect(generation.mock.calls[0][0].metadata).toEqual({ tarefa: "t" });
    expect(String(aviso.mock.calls[0][0])).not.toContain("11987654321");
  });

  it("linhas_estimadas não inteiro → descartado", async () => {
    const { metadadosSeguros } = await import("./custo");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(metadadosSeguros("t", { linhas_estimadas: 1.5 })).toEqual({});
    expect(metadadosSeguros("t", undefined)).toEqual({});
  });
});
