import { describe, it, expect, vi, beforeEach } from "vitest";
import { NonRetriableError } from "inngest";
import { fakeSender, type Sender } from "@/lib/whatsapp";
import {
  enviarBloco, enviarConfirmacao, intervaloDoDia, montarTextoConfirmacao, resolverToken,
  type AgendamentoEnvio, type DepsEnvio,
} from "./confirmacao";
import { rodarEnviarLote, type DepsLote, type StepLike } from "./lote";

const FUSO = "America/Sao_Paulo";
const CLINICA = { phoneNumberId: "123", fuso: FUSO, tokenRef: null };

function ag(n: number, over: Partial<AgendamentoEnvio> = {}): AgendamentoEnvio {
  return {
    id: `ag-${n}`, nome: `Maria Souza ${n}`, telefone: `551190000${String(n).padStart(4, "0")}`,
    atendimento: "Consulta cardiologia", profissional: "Dr. Caio Ventura",
    dataHora: new Date("2026-10-20T17:30:00Z"), // 14:30 em Sao Paulo
    ...over,
  };
}

/** Banco em memória que imita o índice único (agendamento_id, tipo) e os UPDATEs. */
function memoria() {
  const mensagens = new Map<string, { id: string; status: string; wamid?: string; corpo?: string; erroCodigo?: number | null; erroMensagem?: string }>();
  const agendamentos = new Map<string, string>();
  let seq = 0;
  const deps = {
    reservarMensagem: vi.fn(async (agId: string, tipo: string) => {
      const k = `${agId}:${tipo}`;
      if (mensagens.has(k)) return null; // ON CONFLICT DO NOTHING
      const id = `msg-${++seq}`;
      mensagens.set(k, { id, status: "pendente" });
      return id;
    }),
    marcarMensagemEnviada: vi.fn(async (id: string, d: { wamid: string; corpo: string }) => {
      for (const m of mensagens.values()) if (m.id === id) Object.assign(m, { status: "enviada", ...d });
    }),
    marcarMensagemFalhou: vi.fn(async (id: string, d: { erroCodigo: number | null; erroMensagem: string }) => {
      for (const m of mensagens.values()) if (m.id === id) Object.assign(m, { status: "falhou", ...d });
    }),
    marcarAgendamentoEnviado: vi.fn(async (agId: string) => { agendamentos.set(agId, "enviado"); }),
  };
  return { mensagens, agendamentos, deps };
}

function comSender(sender: Sender, m = memoria()): { m: ReturnType<typeof memoria>; deps: DepsEnvio } {
  return { m, deps: { sender, ...m.deps } };
}

beforeEach(() => { vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("texto de confirmação", () => {
  it("primeiro nome, atendimento, profissional e data/hora no fuso da clínica, pedindo SIM/NÃO", () => {
    const t = montarTextoConfirmacao(ag(1, { nome: "MARIA SOUZA LIMA" }), FUSO);
    expect(t).toContain("Olá, Maria!");
    expect(t).not.toContain("Souza");
    expect(t).toContain("Consulta cardiologia com Dr. Caio Ventura");
    expect(t).toContain("20/10/2026 às 14:30");
    expect(t).toMatch(/SIM.*NÃO/);
  });

  it("respeita o fuso (Manaus -04:00) e funciona sem profissional", () => {
    const t = montarTextoConfirmacao(ag(1, { profissional: null }), "America/Manaus");
    expect(t).toContain("13:30");
    expect(t).not.toContain(" com ");
  });
});

describe("enviarConfirmacao", () => {
  it("caminho feliz com FakeSender: reserva, envia, grava wamid/corpo e marca agendamento enviado", async () => {
    const { m, deps } = comSender(fakeSender);
    expect(await enviarConfirmacao(deps, ag(1), CLINICA, "fake")).toBe("enviada");
    const msg = m.mensagens.get("ag-1:confirmacao")!;
    expect(msg.status).toBe("enviada");
    expect(msg.wamid).toMatch(/^fake\./);
    expect(msg.corpo).toContain("Olá, Maria!");
    expect(m.agendamentos.get("ag-1")).toBe("enviado");
  });

  it("idempotência: rodar duas vezes o mesmo agendamento envia UMA vez", async () => {
    const sendText = vi.fn().mockResolvedValue({ wamid: "wamid.1" });
    const { deps } = comSender({ sendText, sendTemplate: vi.fn() });
    expect(await enviarConfirmacao(deps, ag(1), CLINICA, "t")).toBe("enviada");
    expect(await enviarConfirmacao(deps, ag(1), CLINICA, "t")).toBe("pulada");
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("mensagem que falhou antes também não é reenviada automaticamente", async () => {
    const sendText = vi.fn().mockRejectedValue(Object.assign(new Error("x"), { code: 130497 }));
    const { deps } = comSender({ sendText, sendTemplate: vi.fn() });
    expect(await enviarConfirmacao(deps, ag(1), CLINICA, "t")).toBe("falhou");
    expect(await enviarConfirmacao(deps, ag(1), CLINICA, "t")).toBe("pulada");
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("falha ao gravar o wamid: retry curto; se persistir, log com agendamentoId e wamid, sem reenviar", async () => {
    const sendText = vi.fn().mockResolvedValue({ wamid: "wamid.perdido" });
    const { m, deps } = comSender({ sendText, sendTemplate: vi.fn() });
    deps.esperar = async () => {};
    let tentativas = 0;
    deps.marcarMensagemEnviada = vi.fn(async () => { tentativas++; throw new Error("db"); });
    expect(await enviarConfirmacao(deps, ag(1), CLINICA, "t")).toBe("enviada");
    expect(tentativas).toBe(3);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("[envio] enviada mas NÃO gravou o wamid", { agendamentoId: "ag-1", mensagemId: "msg-1", wamid: "wamid.perdido" });
    expect(m.agendamentos.has("ag-1")).toBe(false);
  });

  it("falha transitória ao gravar o wamid se recupera no retry", async () => {
    const { m, deps } = comSender({ sendText: vi.fn().mockResolvedValue({ wamid: "wamid.ok" }), sendTemplate: vi.fn() });
    deps.esperar = async () => {};
    const original = deps.marcarMensagemEnviada;
    let n = 0;
    deps.marcarMensagemEnviada = vi.fn(async (id, d) => { if (n++ === 0) throw new Error("db"); return original(id, d); });
    expect(await enviarConfirmacao(deps, ag(1), CLINICA, "t")).toBe("enviada");
    expect(m.mensagens.get("ag-1:confirmacao")!.wamid).toBe("wamid.ok");
    expect(m.agendamentos.get("ag-1")).toBe("enviado");
  });

  it("erro da Meta: mensagem 'falhou' com código, agendamento continua 'inserido', número mascarado", async () => {
    const sendText = vi.fn().mockRejectedValue(
      Object.assign(new Error("WhatsApp 130497: restricted for +5511900000001"), { code: 130497 }),
    );
    const { m, deps } = comSender({ sendText, sendTemplate: vi.fn() });
    expect(await enviarConfirmacao(deps, ag(1), CLINICA, "t")).toBe("falhou");
    const msg = m.mensagens.get("ag-1:confirmacao")!;
    expect(msg).toMatchObject({ status: "falhou", erroCodigo: 130497 });
    expect(msg.erroMensagem).not.toContain("900000001");
    expect(m.agendamentos.has("ag-1")).toBe(false);
  });
});

describe("enviarBloco", () => {
  it("falha de um envio não impede os demais", async () => {
    const sendText = vi.fn(async (d: { to: string }) => {
      if (d.to.endsWith("0002")) throw Object.assign(new Error("boom"), { code: 131026 });
      return { wamid: `wamid.${d.to}` };
    });
    const { m, deps } = comSender({ sendText, sendTemplate: vi.fn() });
    const r = await enviarBloco(deps, [ag(1), ag(2), ag(3)], CLINICA, "t");
    expect(r).toEqual({ enviadas: 2, puladas: 0, falhas: 1 });
    expect(m.mensagens.get("ag-2:confirmacao")!.status).toBe("falhou");
    expect(m.mensagens.get("ag-3:confirmacao")!.status).toBe("enviada");
  });

  it("erro inesperado de banco em um item não derruba o bloco", async () => {
    const { m, deps } = comSender(fakeSender);
    const original = deps.reservarMensagem;
    deps.reservarMensagem = vi.fn(async (id, t) => { if (id === "ag-1") throw new Error("db"); return original(id, t); });
    const r = await enviarBloco(deps, [ag(1), ag(2)], CLINICA, "t");
    expect(r).toEqual({ enviadas: 1, puladas: 0, falhas: 1 });
    expect(m.mensagens.has("ag-2:confirmacao")).toBe(true);
  });
});

describe("rodarEnviarLote (função Inngest)", () => {
  const passos: StepLike & { sleeps: string[] } = {
    sleeps: [],
    run: (_id, fn) => fn(),
    sleep: async function (id) { (this as { sleeps: string[] }).sleeps.push(id); },
  };

  function depsLote(ags: AgendamentoEnvio[], sender: Sender, m = memoria()) {
    const d: DepsLote = {
      sender, ...m.deps,
      env: { WHATSAPP_FAKE: "1" },
      agora: () => new Date("2026-10-13T12:00:00Z"),
      carregarClinicaDoLote: vi.fn(async () => CLINICA),
      listarIdsParaEnvio: vi.fn(async () => ags.map((a) => a.id)),
      carregarAgendamentos: vi.fn(async (ids: string[]) => ags.filter((a) => ids.includes(a.id))),
      definirStatusLote: vi.fn(async () => {}),
      renovarEnvioLote: vi.fn(async () => {}),
    };
    return { d, m };
  }

  it("rodar o lote duas vezes (retry/novo disparo) resulta em 1 envio por agendamento", async () => {
    const sendText = vi.fn().mockResolvedValue({ wamid: "wamid.x" });
    const ags = Array.from({ length: 25 }, (_, i) => ag(i + 1));
    const { d } = depsLote(ags, { sendText, sendTemplate: vi.fn() });

    const r1 = await rodarEnviarLote(passos, { loteId: "l1" }, d);
    const r2 = await rodarEnviarLote(passos, { loteId: "l1" }, d);

    expect(r1).toEqual({ total: 25, enviadas: 25, puladas: 0, falhas: 0 });
    expect(r2).toEqual({ total: 25, enviadas: 0, puladas: 25, falhas: 0 });
    expect(sendText).toHaveBeenCalledTimes(25);
    expect(d.definirStatusLote).toHaveBeenLastCalledWith("l1", "concluido");
  });

  it("envia em blocos de 10 com pausa entre eles (nada de loop síncrono sem ritmo)", async () => {
    passos.sleeps.length = 0;
    const ags = Array.from({ length: 25 }, (_, i) => ag(i + 1));
    const { d } = depsLote(ags, fakeSender);
    await rodarEnviarLote(passos, { loteId: "l1" }, d);
    expect(d.renovarEnvioLote).toHaveBeenCalledTimes(3); // heartbeat a cada bloco
    expect(d.renovarEnvioLote).toHaveBeenCalledWith("l1");
    expect(passos.sleeps).toEqual(["pausa-1", "pausa-2"]);
  });

  it("falha de um envio não impede os demais nem o lote de concluir", async () => {
    const sendText = vi.fn(async (d: { to: string }) => {
      if (d.to.endsWith("0003")) throw Object.assign(new Error("restrito"), { code: 130497 });
      return { wamid: "w" };
    });
    const ags = [1, 2, 3, 4].map((n) => ag(n));
    const { d, m } = depsLote(ags, { sendText, sendTemplate: vi.fn() });
    const r = await rodarEnviarLote(passos, { loteId: "l1" }, d);
    expect(r).toMatchObject({ enviadas: 3, falhas: 1 });
    expect(m.mensagens.get("ag-3:confirmacao")).toMatchObject({ status: "falhou", erroCodigo: 130497 });
    expect(d.definirStatusLote).toHaveBeenLastCalledWith("l1", "concluido");
  });

  it("repassa o dia (no fuso da clínica) ao filtro de agendamentos", async () => {
    const { d } = depsLote([], fakeSender);
    await rodarEnviarLote(passos, { loteId: "l1", data: "2026-10-20" }, d);
    const filtro = vi.mocked(d.listarIdsParaEnvio).mock.calls[0][1];
    expect(filtro.de?.toISOString()).toBe("2026-10-20T03:00:00.000Z");
    expect(filtro.ate?.toISOString()).toBe("2026-10-21T03:00:00.000Z");
  });

  it("sem token (e sem FAKE): devolve o lote a 'importado' e falha, sem enviar", async () => {
    const sendText = vi.fn();
    const { d } = depsLote([ag(1)], { sendText, sendTemplate: vi.fn() });
    d.env = {};
    const erro = await rodarEnviarLote(passos, { loteId: "l1" }, d).catch((e) => e);
    expect(erro).toBeInstanceOf(NonRetriableError);
    expect(String(erro.message)).toMatch(/token/);
    expect(d.definirStatusLote).toHaveBeenCalledWith("l1", "importado");
    expect(sendText).not.toHaveBeenCalled();
  });
});

describe("fakeSender", () => {
  it("gera wamids únicos mesmo no mesmo milissegundo", async () => {
    const d = { phoneNumberId: "1", token: "t", to: "5511900000001" };
    const ids = await Promise.all(Array.from({ length: 50 }, () => fakeSender.sendText(d, "oi")));
    expect(new Set(ids.map((x) => x.wamid)).size).toBe(50);
  });
});

describe("helpers", () => {
  it("resolverToken: token_ref primeiro, depois WHATSAPP_TOKEN", () => {
    expect(resolverToken("TOKEN_CLINICA_A", { TOKEN_CLINICA_A: "a", WHATSAPP_TOKEN: "geral" })).toBe("a");
    expect(resolverToken("TOKEN_CLINICA_A", { WHATSAPP_TOKEN: "geral" })).toBe("geral");
    expect(resolverToken(null, { WHATSAPP_TOKEN: "geral" })).toBe("geral");
    expect(resolverToken(null, {})).toBeUndefined();
  });

  it("intervaloDoDia usa o offset do fuso (Manaus -04:00)", () => {
    const { de, ate } = intervaloDoDia("2026-10-20", "America/Manaus");
    expect(de.toISOString()).toBe("2026-10-20T04:00:00.000Z");
    expect(ate.toISOString()).toBe("2026-10-21T04:00:00.000Z");
  });
});
