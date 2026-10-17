import { describe, it, expect, vi, beforeEach } from "vitest";
import { ZodError } from "zod";
import { classificarResposta } from "./classificar-resposta";
import { registrarUso } from "../custo";
import { clienteFalso } from "../test/cliente-falso";

vi.mock("../custo", () => ({ registrarUso: vi.fn() }));

const base = {
  textoPaciente: "sim, confirmo",
  primeiroNome: "Maria",
  atendimento: "Consulta",
  dataHoraLegivel: "qui, 8 out, 14:30",
  clinicaNome: "Clínica Aurora",
};
const ok = JSON.stringify({ intencao: "confirmou", confianca: 0.97, resposta_ao_paciente: "Obrigada, Maria!", motivo: "confirmou" });
const AGENDAMENTO = "3f1c2a4e-8b7d-4c1e-9a2b-5d6e7f8a9b0c";

describe("classificarResposta", () => {
  beforeEach(() => vi.mocked(registrarUso).mockClear());

  it("caminho feliz: classifica e registra uso com agendamento_id (sem dado pessoal)", async () => {
    const { client, parametros, enviado } = clienteFalso(`Resposta: ${ok}`);
    const r = await classificarResposta({ ...base, agendamentoId: AGENDAMENTO }, client);
    expect(r).toMatchObject({ intencao: "confirmou", confianca: 0.97, precisaHumano: false, modelo: "claude-haiku-4-5" });
    expect(parametros()).toMatchObject({ max_tokens: 400, temperature: 0 });
    expect(enviado()).not.toContain(AGENDAMENTO); // id não vai ao modelo
    expect(registrarUso).toHaveBeenCalledTimes(1);
    expect(vi.mocked(registrarUso).mock.calls[0][0]).toMatchObject({
      tarefa: "classificar-resposta",
      metadados: { agendamento_id: AGENDAMENTO },
    });
    expect(JSON.stringify(vi.mocked(registrarUso).mock.calls[0][0])).not.toContain("Maria");
  });

  it("nome da clínica com $& ou $1 entra literal no system prompt", async () => {
    const { client, create } = clienteFalso(ok);
    await classificarResposta({ ...base, clinicaNome: "Clínica $& $1 $$" }, client);
    const system = String((create.mock.calls[0][0] as { system: string }).system);
    expect(system).toContain("Clínica $& $1 $$");
    expect(system).not.toContain("{clinica}");
  });

  it("registra uso mesmo quando a resposta falha (chamada já foi paga)", async () => {
    const { client } = clienteFalso("não sei");
    await expect(classificarResposta(base, client)).rejects.toThrow(/não retornou JSON/);
    expect(registrarUso).toHaveBeenCalledTimes(1);
  });

  it("stop_reason max_tokens → erro explícito", async () => {
    const { client } = clienteFalso(ok, "max_tokens");
    await expect(classificarResposta(base, client)).rejects.toThrow(/max_tokens/);
  });

  it("JSON malformado → erro explícito (json.ts)", async () => {
    const { client } = clienteFalso('{"intencao": "confirmou",, }');
    await expect(classificarResposta(base, client)).rejects.toThrow(/malformado/);
  });

  it("saída fora do formato → ZodError", async () => {
    const { client } = clienteFalso(JSON.stringify({ intencao: "talvez", confianca: 0.9, resposta_ao_paciente: "", motivo: "" }));
    await expect(classificarResposta(base, client)).rejects.toBeInstanceOf(ZodError);
  });

  it("primeiroNome com sobrenome, número ou longo demais → ZodError sem chamar o modelo", async () => {
    for (const primeiroNome of ["Maria Souza", "Maria1", "11987654321", "", "a".repeat(41)]) {
      const { client, create } = clienteFalso(ok);
      await expect(classificarResposta({ ...base, primeiroNome }, client)).rejects.toBeInstanceOf(ZodError);
      expect(create).not.toHaveBeenCalled();
    }
  });

  it("confiança baixa → precisa de humano", async () => {
    const { client } = clienteFalso(JSON.stringify({ intencao: "confirmou", confianca: 0.6, resposta_ao_paciente: "", motivo: "" }));
    expect((await classificarResposta(base, client)).precisaHumano).toBe(true);
  });
});
