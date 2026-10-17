import { describe, it, expect, vi, beforeEach } from "vitest";
import { executarAcao, type DepsAcoes, type AgendamentoAcao } from "./acoes";
import { montarHistorico, montarLista, trecho, type LinhaConversa } from "./lista";
import { AcaoConversaSchema } from "@/lib/schemas-conversas";

const CLINICA = "c1", OUTRA = "c2";
const PAC = "00000000-0000-4000-8000-000000000001";
const AG = "00000000-0000-4000-8000-0000000000a1";
const AG_OUTRO = "00000000-0000-4000-8000-0000000000a2";
const AG_OUTRA_CLINICA = "00000000-0000-4000-8000-0000000000a3";
const AGORA = new Date("2026-10-16T12:00:00Z");

function mkDeps(over: Partial<DepsAcoes> = {}, ags: Record<string, AgendamentoAcao> = {}): DepsAcoes & { sender: { sendText: ReturnType<typeof vi.fn> } } {
  const base: Record<string, AgendamentoAcao> = {
    [AG]: { id: AG, pacienteId: PAC, clinicaId: CLINICA, status: "enviado" },
    [AG_OUTRO]: { id: AG_OUTRO, pacienteId: "outro", clinicaId: CLINICA, status: "enviado" },
    [AG_OUTRA_CLINICA]: { id: AG_OUTRA_CLINICA, pacienteId: PAC, clinicaId: OUTRA, status: "enviado" },
    ...ags,
  };
  return {
    sender: { sendText: vi.fn().mockResolvedValue({ wamid: "wamid.X" }), sendTemplate: vi.fn() },
    env: { WHATSAPP_FAKE: "1" },
    agora: () => AGORA,
    buscarClinica: async () => ({ id: CLINICA, phoneNumberId: "123", tokenRef: null }),
    buscarPaciente: async (id: string) => (id === PAC ? { id: PAC, clinicaId: CLINICA, telefone: "5511900001234" } : null),
    buscarAgendamento: async (id: string) => base[id] ?? null,
    agendamentoEmFoco: async () => ({ id: AG }),
    ultimaRespostaDoPacienteEm: async () => new Date("2026-10-16T10:00:00Z"),
    gravarAcaoHumana: vi.fn().mockResolvedValue(true),
    reservarRespostaHumana: vi.fn().mockResolvedValue(true),
    liberarRespostaHumana: vi.fn().mockResolvedValue(undefined),
    registrarMensagemTexto: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as never;
}

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("executarAcao: confirmar / cancelar / resolver", () => {
  it("confirmar grava resposta humana, muda o status e NÃO envia mensagem", async () => {
    const d = mkDeps();
    const r = await executarAcao(d, PAC, { acao: "confirmar", agendamentoId: AG });
    expect(r).toEqual({ ok: true, acao: "confirmar", duplicada: false, statusAgendamento: "confirmado" });
    expect(d.gravarAcaoHumana).toHaveBeenCalledWith(expect.objectContaining({
      pacienteId: PAC, agendamentoId: AG, intencao: "confirmou", novoStatus: "confirmado", resolverPendentes: true,
      texto: "Confirmado pela recepção", wamid: expect.stringMatching(/^humano\.[0-9a-f-]{36}$/),
    }));
    expect(d.sender.sendText).not.toHaveBeenCalled();
  });

  it("cancelar", async () => {
    const d = mkDeps();
    const r = await executarAcao(d, PAC, { acao: "cancelar", agendamentoId: AG });
    expect(r).toMatchObject({ ok: true, statusAgendamento: "cancelado" });
    expect(d.gravarAcaoHumana).toHaveBeenCalledWith(expect.objectContaining({ intencao: "cancelou", novoStatus: "cancelado" }));
  });

  it("resolver: excecao volta para enviado; outro status é mantido", async () => {
    const ex = mkDeps({}, { [AG]: { id: AG, pacienteId: PAC, clinicaId: CLINICA, status: "excecao" } });
    expect(await executarAcao(ex, PAC, { acao: "resolver", agendamentoId: AG })).toMatchObject({ ok: true, statusAgendamento: "enviado" });
    expect(ex.gravarAcaoHumana).toHaveBeenCalledWith(expect.objectContaining({ novoStatus: "enviado", intencao: null, texto: "Marcado como resolvido pela recepção" }));

    const ok = mkDeps({}, { [AG]: { id: AG, pacienteId: PAC, clinicaId: CLINICA, status: "confirmado" } });
    expect(await executarAcao(ok, PAC, { acao: "resolver", agendamentoId: AG })).toMatchObject({ statusAgendamento: "confirmado" });
    expect(ok.gravarAcaoHumana).toHaveBeenCalledWith(expect.objectContaining({ novoStatus: null, resolverPendentes: true }));
  });

  it("idempotência: mesma chave repetida devolve duplicada", async () => {
    const chave = "11111111-1111-4111-8111-111111111111";
    const d = mkDeps({ gravarAcaoHumana: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false) });
    const a = await executarAcao(d, PAC, { acao: "confirmar", agendamentoId: AG, chaveIdempotencia: chave });
    const b = await executarAcao(d, PAC, { acao: "confirmar", agendamentoId: AG, chaveIdempotencia: chave });
    expect(a).toMatchObject({ duplicada: false });
    expect(b).toMatchObject({ duplicada: true });
    const wamids = vi.mocked(d.gravarAcaoHumana).mock.calls.map((c) => c[0].wamid);
    expect(wamids).toEqual([`humano.${chave}`, `humano.${chave}`]);
  });

  it("agendamento de outro paciente ou de outra clínica: 403 tipado; inexistente: 404", async () => {
    const d = mkDeps();
    expect(await executarAcao(d, PAC, { acao: "confirmar", agendamentoId: AG_OUTRO })).toMatchObject({ ok: false, erro: "agendamento_de_outro_paciente" });
    expect(await executarAcao(d, PAC, { acao: "confirmar", agendamentoId: AG_OUTRA_CLINICA })).toMatchObject({ ok: false, erro: "agendamento_de_outro_paciente" });
    expect(await executarAcao(d, PAC, { acao: "cancelar", agendamentoId: "00000000-0000-4000-8000-0000000000ff" })).toMatchObject({ erro: "agendamento_nao_encontrado" });
    expect(d.gravarAcaoHumana).not.toHaveBeenCalled();
  });

  it("paciente inexistente ou de outra clínica", async () => {
    const d = mkDeps({ buscarPaciente: async () => ({ id: PAC, clinicaId: OUTRA, telefone: "5511900001234" }) });
    expect(await executarAcao(d, PAC, { acao: "confirmar", agendamentoId: AG })).toMatchObject({ erro: "paciente_nao_encontrado" });
  });
});

describe("executarAcao: responder", () => {
  it("dentro da janela: envia, registra mensagem texto_livre e resposta humana", async () => {
    const d = mkDeps();
    const r = await executarAcao(d, PAC, { acao: "responder", texto: "Tudo certo!", agendamentoId: AG });
    expect(r).toEqual({ ok: true, acao: "responder", duplicada: false, statusAgendamento: "enviado" });
    expect(d.sender.sendText).toHaveBeenCalledWith({ phoneNumberId: "123", token: "fake", to: "5511900001234" }, "Tudo certo!");
    expect(d.reservarRespostaHumana).toHaveBeenCalledWith(expect.objectContaining({ pacienteId: PAC, agendamentoId: AG, texto: "Tudo certo!" }));
    expect(d.registrarMensagemTexto).toHaveBeenCalledWith(expect.objectContaining({ status: "enviada", wamid: "wamid.X", corpo: "Tudo certo!" }));
  });

  it("sem agendamentoId usa o agendamento em foco", async () => {
    const d = mkDeps();
    await executarAcao(d, PAC, { acao: "responder", texto: "Oi" });
    expect(d.registrarMensagemTexto).toHaveBeenCalledWith(expect.objectContaining({ agendamentoId: AG }));
  });

  it("fora da janela de 24 h: fora_da_janela e nada é enviado", async () => {
    const d = mkDeps({ ultimaRespostaDoPacienteEm: async () => new Date("2026-10-15T11:59:00Z") });
    expect(await executarAcao(d, PAC, { acao: "responder", texto: "Oi", agendamentoId: AG })).toMatchObject({ ok: false, erro: "fora_da_janela" });
    const sem = mkDeps({ ultimaRespostaDoPacienteEm: async () => null });
    expect(await executarAcao(sem, PAC, { acao: "responder", texto: "Oi", agendamentoId: AG })).toMatchObject({ erro: "fora_da_janela" });
    expect(d.sender.sendText).not.toHaveBeenCalled();
    expect(sem.reservarRespostaHumana).not.toHaveBeenCalled();
  });

  it("idempotência: chave já usada não reenvia", async () => {
    const d = mkDeps({ reservarRespostaHumana: vi.fn().mockResolvedValue(false) });
    const r = await executarAcao(d, PAC, { acao: "responder", texto: "Oi", agendamentoId: AG, chaveIdempotencia: "11111111-1111-4111-8111-111111111111" });
    expect(r).toMatchObject({ ok: true, duplicada: true });
    expect(d.sender.sendText).not.toHaveBeenCalled();
    expect(d.registrarMensagemTexto).not.toHaveBeenCalled();
  });

  it("falha de envio: mensagem 'falhou' com erro mascarado e chave liberada", async () => {
    const d = mkDeps();
    d.sender.sendText.mockRejectedValue(Object.assign(new Error("WhatsApp 131047: número +55 11 90000-1234 fora da janela"), { code: 131047 }));
    const r = await executarAcao(d, PAC, { acao: "responder", texto: "Oi", agendamentoId: AG });
    expect(r).toMatchObject({ ok: false, erro: "envio_falhou" });
    const gravado = vi.mocked(d.registrarMensagemTexto).mock.calls[0][0];
    expect(gravado).toMatchObject({ status: "falhou", wamid: null, erroCodigo: 131047 });
    expect(gravado.erroMensagem).not.toContain("90000-1234");
    expect(d.liberarRespostaHumana).toHaveBeenCalled();
  });

  it("agendamento de outro paciente é rejeitado antes de enviar", async () => {
    const d = mkDeps();
    expect(await executarAcao(d, PAC, { acao: "responder", texto: "Oi", agendamentoId: AG_OUTRO })).toMatchObject({ erro: "agendamento_de_outro_paciente" });
    expect(d.sender.sendText).not.toHaveBeenCalled();
  });

  it("sem FAKE e sem token: envio_nao_configurado", async () => {
    const d = mkDeps({ env: {} });
    expect(await executarAcao(d, PAC, { acao: "responder", texto: "Oi", agendamentoId: AG })).toMatchObject({ erro: "envio_nao_configurado" });
  });
});

describe("AcaoConversaSchema", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";
  it("aceita as variantes válidas", () => {
    expect(AcaoConversaSchema.safeParse({ acao: "confirmar", agendamentoId: uuid }).success).toBe(true);
    expect(AcaoConversaSchema.safeParse({ acao: "responder", texto: "ok" }).success).toBe(true);
  });
  it("rejeita texto vazio, > 1000, ação desconhecida e agendamentoId ausente", () => {
    expect(AcaoConversaSchema.safeParse({ acao: "responder", texto: "   " }).success).toBe(false);
    expect(AcaoConversaSchema.safeParse({ acao: "responder", texto: "a".repeat(1001) }).success).toBe(false);
    expect(AcaoConversaSchema.safeParse({ acao: "apagar", agendamentoId: uuid }).success).toBe(false);
    expect(AcaoConversaSchema.safeParse({ acao: "cancelar" }).success).toBe(false);
  });
});

describe("montarLista", () => {
  const linha = (id: string, min: number, temExcecao: boolean, extra: Partial<LinhaConversa> = {}): LinhaConversa => ({
    pacienteId: id, nome: "Maria Souza Lima", telefone: "5511900001234", ultimaTexto: "oi", ultimaDirecao: "recebida",
    ultimaEm: new Date(AGORA.getTime() - min * 60000), agId: null, agAtendimento: null, agDataHora: null, agStatus: null, temExcecao, ...extra,
  });
  const linhas = [linha("a", 1, false), linha("b", 30, true), linha("c", 10, false), linha("d", 60, true)];

  it("exceções primeiro: pendentes antes, depois por atividade desc", () => {
    expect(montarLista(linhas, { excecoesPrimeiro: true, limite: 50 }).map((c) => c.pacienteId)).toEqual(["b", "d", "a", "c"]);
  });
  it("sem a opção, só por atividade; respeita o limite", () => {
    expect(montarLista(linhas, { excecoesPrimeiro: false, limite: 3 }).map((c) => c.pacienteId)).toEqual(["a", "c", "b"]);
  });
  it("mascara telefone, abrevia nome e corta o trecho em 80 caracteres", () => {
    const [c] = montarLista([linha("a", 1, false, {
      ultimaTexto: `ligue para 11 90000-1234 ${"x".repeat(200)}`,
      agId: "g", agAtendimento: "Consulta", agDataHora: AGORA, agStatus: "excecao",
    })], { excecoesPrimeiro: true, limite: 5 });
    expect(c.nome).toBe("Maria S.");
    expect(c.telefone).toBe("(11) 9****-1234");
    expect(c.ultimaMensagem.trecho.length).toBeLessThanOrEqual(80);
    expect(JSON.stringify(c)).not.toContain("90000-1234");
    expect(JSON.stringify(c)).not.toContain("Souza");
    expect(c.agendamento).toMatchObject({ id: "g", status: "excecao" });
  });
  it("trecho curto passa inteiro", () => expect(trecho("  Sim,   confirmo ")).toBe("Sim, confirmo"));
});

describe("montarHistorico", () => {
  it("ordena por tempo, mascara telefones no texto e não duplica a resposta humana enviada", () => {
    const t = (min: number) => new Date(AGORA.getTime() + min * 60000);
    const ev = montarHistorico(
      [{ id: "m1", agendamentoId: AG, tipo: "confirmacao", corpo: "Olá, confirme", status: "lida", quando: t(0) },
       { id: "m2", agendamentoId: AG, tipo: "texto_livre", corpo: "Ligue 11 90000-1234", status: "enviada", quando: t(3) }],
      [{ id: "r1", agendamentoId: AG, texto: "quero remarcar 11 90000-1234", intencao: "quer_remarcar", confianca: "0.910", motivo: null, origem: "paciente", classificadaPor: "haiku", precisaHumano: 1, resolvidaEm: null, quando: t(1) },
       { id: "r2", agendamentoId: AG, texto: "Marcado como resolvido pela recepção", intencao: null, confianca: null, motivo: "acao:resolver", origem: "humano", classificadaPor: "humano", precisaHumano: 0, resolvidaEm: t(2), quando: t(2) },
       { id: "r3", agendamentoId: AG, texto: "Ligue 11 90000-1234", intencao: null, confianca: null, motivo: "acao:responder", origem: "humano", classificadaPor: "humano", precisaHumano: 0, resolvidaEm: null, quando: t(3) }],
    );
    expect(ev.map((e) => e.id)).toEqual(["m1", "r1", "r2", "m2"]);
    expect(ev[1]).toMatchObject({ tipo: "resposta_paciente", confianca: 0.91, precisaHumano: true, resolvida: false });
    expect(ev[2]).toMatchObject({ tipo: "acao_recepcao" });
    expect(JSON.stringify(ev)).not.toContain("90000-1234");
  });
});
