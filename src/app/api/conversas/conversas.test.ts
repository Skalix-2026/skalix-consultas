import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/db/queries/lotes", () => ({ buscarClinicaPadrao: vi.fn() }));
vi.mock("@/db/queries/conversas", () => ({
  listarConversas: vi.fn(), buscarPacienteDaClinica: vi.fn(), buscarAgendamentoBasico: vi.fn(), listarAgendamentosDoPaciente: vi.fn(),
  agendamentoEmFoco: vi.fn(), ultimaRespostaDoPacienteEm: vi.fn(), listarMensagensDoPaciente: vi.fn(), listarRespostasDoPaciente: vi.fn(),
  gravarAcaoHumana: vi.fn(), reservarRespostaHumana: vi.fn(), liberarRespostaHumana: vi.fn(), registrarMensagemTexto: vi.fn(),
}));
// o sender é escolhido na carga do módulo: aqui sempre o FakeSender
vi.mock("@/lib/whatsapp", async (orig) => {
  const m = await orig<typeof import("@/lib/whatsapp")>();
  return { ...m, sender: m.fakeSender };
});

import { GET as listar } from "./route";
import { GET as historico } from "./[pacienteId]/route";
import { POST as acao } from "./[pacienteId]/acao/route";
import { buscarClinicaPadrao } from "@/db/queries/lotes";
import * as q from "@/db/queries/conversas";

const PAC = "00000000-0000-4000-8000-000000000001";
const AG = "00000000-0000-4000-8000-0000000000a1";
const ctx = (id: string) => ({ params: Promise.resolve({ pacienteId: id }) });
const post = (body: unknown) => new NextRequest("http://x", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(buscarClinicaPadrao).mockResolvedValue({ id: "c1", fuso: "America/Sao_Paulo", phoneNumberId: "123", tokenRef: null });
  vi.stubEnv("WHATSAPP_FAKE", "1");
});

describe("GET /api/conversas", () => {
  it("lista com exceções primeiro, telefone mascarado e nome abreviado", async () => {
    vi.mocked(q.listarConversas).mockResolvedValue([
      { pacienteId: PAC, nome: "Maria Souza", telefone: "5511900001234", ultimaTexto: "Oi", ultimaDirecao: "recebida", ultimaEm: new Date("2026-10-16T10:00:00Z"),
        agId: AG, agAtendimento: "Consulta", agDataHora: new Date("2026-10-20T12:00:00Z"), agStatus: "excecao", temExcecao: true },
    ]);
    const res = await listar(new NextRequest("http://x/api/conversas?exce%C3%A7%C3%B5esPrimeiro=1&limite=10"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(q.listarConversas).toHaveBeenCalledWith("c1", { excecoesPrimeiro: true, limite: 10 });
    expect(json.conversas[0]).toMatchObject({ nome: "Maria S.", telefone: "(11) 9****-1234", temExcecao: true });
    expect(JSON.stringify(json)).not.toContain("5511900001234");
  });
  it("limite inválido: 400", async () => {
    expect((await listar(new NextRequest("http://x/api/conversas?limite=0"))).status).toBe(400);
  });
});

describe("GET /api/conversas/[pacienteId]", () => {
  it("id inválido 400; paciente de outra clínica 404", async () => {
    expect((await historico(new NextRequest("http://x"), ctx("abc"))).status).toBe(400);
    vi.mocked(q.buscarPacienteDaClinica).mockResolvedValue({ id: PAC, clinicaId: "outra", telefone: "5511900001234", nome: "Maria" });
    expect((await historico(new NextRequest("http://x"), ctx(PAC))).status).toBe(404);
  });
  it("devolve histórico mascarado", async () => {
    vi.mocked(q.buscarPacienteDaClinica).mockResolvedValue({ id: PAC, clinicaId: "c1", telefone: "5511900001234", nome: "Maria Souza" });
    vi.mocked(q.listarMensagensDoPaciente).mockResolvedValue([]);
    vi.mocked(q.listarRespostasDoPaciente).mockResolvedValue([]);
    vi.mocked(q.listarAgendamentosDoPaciente).mockResolvedValue([]);
    const json = await (await historico(new NextRequest("http://x"), ctx(PAC))).json();
    expect(json).toMatchObject({ ok: true, paciente: { nome: "Maria S.", telefone: "(11) 9****-1234" }, eventos: [], janelaAberta: false });
  });
});

describe("POST /api/conversas/[pacienteId]/acao", () => {
  beforeEach(() => {
    vi.mocked(q.buscarPacienteDaClinica).mockResolvedValue({ id: PAC, clinicaId: "c1", telefone: "5511900001234", nome: "Maria" });
    vi.mocked(q.buscarAgendamentoBasico).mockResolvedValue({ id: AG, pacienteId: PAC, clinicaId: "c1", status: "enviado" });
  });

  it("confirmar: 200", async () => {
    vi.mocked(q.gravarAcaoHumana).mockResolvedValue(true);
    const res = await acao(post({ acao: "confirmar", agendamentoId: AG }), ctx(PAC));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, acao: "confirmar", duplicada: false, statusAgendamento: "confirmado" });
  });
  it("corpo inválido: 400", async () => {
    expect((await acao(post({ acao: "responder", texto: "" }), ctx(PAC))).status).toBe(400);
    expect((await acao(post({ acao: "x" }), ctx(PAC))).status).toBe(400);
    expect((await acao(new NextRequest("http://x", { method: "POST", body: "{" }), ctx(PAC))).status).toBe(400);
  });
  it("responder fora da janela: 409 fora_da_janela", async () => {
    vi.mocked(q.ultimaRespostaDoPacienteEm).mockResolvedValue(new Date(Date.now() - 25 * 3600_000));
    const res = await acao(post({ acao: "responder", texto: "Oi", agendamentoId: AG }), ctx(PAC));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, erro: "fora_da_janela" });
  });
  it("responder dentro da janela: 200 e registra com FakeSender", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(q.ultimaRespostaDoPacienteEm).mockResolvedValue(new Date(Date.now() - 3600_000));
    vi.mocked(q.reservarRespostaHumana).mockResolvedValue(true);
    const res = await acao(post({ acao: "responder", texto: "Oi", agendamentoId: AG }), ctx(PAC));
    expect(res.status).toBe(200);
    expect(q.registrarMensagemTexto).toHaveBeenCalledWith(expect.objectContaining({ status: "enviada", wamid: expect.stringMatching(/^fake\./) }));
  });
  it("agendamento de outro paciente: 403", async () => {
    vi.mocked(q.buscarAgendamentoBasico).mockResolvedValue({ id: AG, pacienteId: "outro", clinicaId: "c1", status: "enviado" });
    expect((await acao(post({ acao: "cancelar", agendamentoId: AG }), ctx(PAC))).status).toBe(403);
  });
});
