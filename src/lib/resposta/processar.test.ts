import { describe, it, expect, vi } from "vitest";
import { clienteFalso } from "@/ai/test/cliente-falso";
import { classificarResposta } from "@/ai/harness/classificar-resposta";
import type { Sender } from "@/lib/whatsapp";
import {
  decidirResposta, escolherAgendamento, primeiroNomeParaIA, rodarProcessarResposta,
  type AgendamentoAberto, type DepsResposta, type PacienteLocalizado,
} from "./processar";
import { variantesTelefone } from "@/lib/telefone";

const AGORA = new Date("2026-10-16T12:00:00Z");
const PHONE_ID = "PHONE-A";
const FROM = "5511956515858";

const paciente: PacienteLocalizado = {
  pacienteId: "pac-1", nome: "Maria Souza Lima", clinicaId: "cli-A", clinicaNome: "Clínica Aurora",
  fuso: "America/Sao_Paulo", phoneNumberId: PHONE_ID, tokenRef: null,
};
/** Ids de agendamento são UUIDs de verdade (o harness valida o formato). */
const uid = (n: string) => `00000000-0000-4000-8000-${Buffer.from(n).toString("hex").padStart(12, "0").slice(-12)}`;
const AG1 = uid("ag1");
const ag = (id: string, horas: number, status = "enviado"): AgendamentoAberto => ({
  id: id.includes("-") ? id : uid(id), atendimento: "Cardiologia", dataHora: new Date(AGORA.getTime() + horas * 3600_000), status,
});

const json = (intencao: string, confianca: number, resposta = "Pronto, Maria! Consulta confirmada.") =>
  JSON.stringify({ intencao, confianca, resposta_ao_paciente: resposta, motivo: "teste" });

/** Deps em memória: banco simulado + IA via cliente falso (nunca chama a Anthropic) + Sender espião. */
function montar(opts: {
  respostaIA?: string;
  agendamentos?: AgendamentoAberto[];
  paciente?: PacienteLocalizado | null;
  envioFalha?: boolean;
  buscarConhecimento?: DepsResposta["buscarConhecimento"];
} = {}) {
  const ia = clienteFalso(opts.respostaIA ?? json("confirmou", 0.97));
  const sendText = vi.fn(async () => {
    if (opts.envioFalha) throw Object.assign(new Error("WhatsApp 131047: fora da janela"), { code: 131047 });
    return { wamid: "wamid.OUT" };
  });
  const sender: Sender = { sendText, sendTemplate: vi.fn() };
  const db = {
    respostas: new Map<string, { id: string; agendamentoId: string | null; decidida: boolean; texto: string }>(),
    status: new Map<string, string>(),
    mensagens: new Map<string, { id: string; corpo: string; status: string; wamid?: string; erroCodigo?: number | null }>(),
    reservas: new Set<string>(),
    decisoes: [] as unknown[],
    eventosSemPaciente: [] as (string | undefined)[],
  };
  const lista = opts.agendamentos ?? [ag(AG1, 24)];
  lista.forEach((a) => db.status.set(a.id, a.status));
  const localizarPaciente = vi.fn(async (_p: string, _t: string[]) => (opts.paciente === undefined ? paciente : opts.paciente));
  const listarAgendamentosAbertos = vi.fn(async () => lista);
  const classificar = vi.fn((e: Parameters<typeof classificarResposta>[0]) => classificarResposta(e, ia.client));

  const deps: DepsResposta = {
    sender, agora: () => AGORA, env: { WHATSAPP_FAKE: "1" },
    localizarPaciente, listarAgendamentosAbertos,
    buscarTokenRef: async () => null,
    registrarResposta: async (d) => {
      const ex = db.respostas.get(d.wamid);
      if (ex) return { id: ex.id, jaProcessada: ex.decidida || ex.agendamentoId === null };
      db.respostas.set(d.wamid, { id: `r-${d.wamid}`, agendamentoId: d.agendamentoId, decidida: false, texto: d.texto });
      return { id: `r-${d.wamid}`, jaProcessada: false };
    },
    registrarSemPaciente: async (e) => { db.eventosSemPaciente.push(e); },
    buscarConhecimento: opts.buscarConhecimento ?? (async () => []),
    classificar,
    gravarDecisao: async (d) => {
      db.decisoes.push(d);
      db.status.set(d.agendamentoId, d.novoStatus);
      for (const r of db.respostas.values()) if (r.id === d.respostaId) r.decidida = true;
    },
    reservarRespostaAutomatica: async (_ag, wamid, corpo) => {
      if (db.reservas.has(wamid)) return null;
      db.reservas.add(wamid);
      const id = `m-${wamid}`;
      db.mensagens.set(id, { id, corpo, status: "pendente" });
      return id;
    },
    carregarCorpoPendente: async (id) => {
      const m = db.mensagens.get(id);
      return m && m.status === "pendente" && !m.wamid ? m.corpo : null;
    },
    marcarMensagemEnviada: async (id, d) => { Object.assign(db.mensagens.get(id)!, { status: "enviada", wamid: d.wamid }); },
    marcarMensagemFalhou: async (id, d) => { Object.assign(db.mensagens.get(id)!, { status: "falhou", erroCodigo: d.erroCodigo }); },
  };
  // step sem Inngest: executa direto
  const step = { run: <T,>(_id: string, fn: () => Promise<T>) => fn() };
  const rodar = (extra: Partial<Parameters<typeof rodarProcessarResposta>[1]> = {}) =>
    rodarProcessarResposta(step, { from: FROM, wamid: "wamid.IN", texto: "sim", phoneNumberId: PHONE_ID, ...extra }, deps);
  return { rodar, db, ia, sendText, classificar, localizarPaciente, listarAgendamentosAbertos };
}

describe("processar-resposta: decisão", () => {
  it("confirmou >= 0,85: agendamento confirmado e texto enviado e registrado", async () => {
    const t = montar();
    const r = await t.rodar();
    expect(r).toMatchObject({ resultado: "confirmado", agendamentoId: AG1, enviada: true });
    expect(t.db.status.get(AG1)).toBe("confirmado");
    expect(t.sendText).toHaveBeenCalledTimes(1);
    expect(t.sendText).toHaveBeenCalledWith({ phoneNumberId: PHONE_ID, token: "fake", to: FROM }, "Pronto, Maria! Consulta confirmada.");
    expect(t.db.mensagens.get("m-wamid.IN")).toMatchObject({ status: "enviada", wamid: "wamid.OUT" });
    expect(t.ia.parametros()).toMatchObject({ temperature: 0, max_tokens: 400 });
  });

  it("cancelou >= 0,85: agendamento cancelado e texto enviado", async () => {
    const t = montar({ respostaIA: json("cancelou", 0.9, "Cancelado, Maria.") });
    const r = await t.rodar({ texto: "não vou poder" });
    expect(r.resultado).toBe("cancelado");
    expect(t.db.status.get(AG1)).toBe("cancelado");
    expect(t.sendText).toHaveBeenCalledTimes(1);
  });

  it("confiança 0,84: excecao, nada enviado, precisa de humano", async () => {
    const t = montar({ respostaIA: json("confirmou", 0.84) });
    const r = await t.rodar();
    expect(r).toMatchObject({ resultado: "excecao", enviada: false });
    expect(t.db.status.get(AG1)).toBe("excecao");
    expect(t.sendText).not.toHaveBeenCalled();
    expect(t.db.decisoes[0]).toMatchObject({ precisaHumano: true, classificadaPor: "haiku" });
  });

  it.each(["quer_remarcar", "duvida", "fora_de_escopo", "nao_sou_eu"])("%s com confiança alta: excecao, nada enviado", async (i) => {
    const t = montar({ respostaIA: json(i, 0.99) });
    const r = await t.rodar();
    expect(r.resultado).toBe("excecao");
    expect(t.db.status.get(AG1)).toBe("excecao");
    expect(t.sendText).not.toHaveBeenCalled();
  });

  it("decidirResposta: limiar exato 0,85 passa", () => {
    expect(decidirResposta({ intencao: "confirmou", confianca: 0.85 }).novoStatus).toBe("confirmado");
    expect(decidirResposta({ intencao: "cancelou", confianca: 0.849 }).novoStatus).toBe("excecao");
  });
});

describe("processar-resposta: localização", () => {
  it("sem agendamento aberto: grava a resposta, não chama a IA e não envia", async () => {
    const t = montar({ agendamentos: [] });
    const r = await t.rodar();
    expect(r.resultado).toBe("sem_agendamento");
    expect(t.db.respostas.get("wamid.IN")?.agendamentoId).toBeNull();
    expect(t.classificar).not.toHaveBeenCalled();
    expect(t.sendText).not.toHaveBeenCalled();
  });

  it("sem paciente: registra aviso no evento e não envia", async () => {
    const t = montar({ paciente: null });
    const r = await t.rodar({ eventoId: "ev-1" });
    expect(r.resultado).toBe("sem_paciente");
    expect(t.db.eventosSemPaciente).toEqual(["ev-1"]);
    expect(t.db.respostas.size).toBe(0);
    expect(t.sendText).not.toHaveBeenCalled();
  });

  it("escolhe o agendamento aberto mais próximo e ignora passados e não abertos", async () => {
    const t = montar({
      agendamentos: [ag("longe", 72), ag("passado", -2), ag("confirmado", 5, "confirmado"), ag("perto", 10, "inserido")],
    });
    const r = await t.rodar();
    expect(r.agendamentoId).toBe(uid("perto"));
    expect(escolherAgendamento([ag("a", 48), ag("b", 6)], AGORA)?.id).toBe(uid("b"));
    expect(escolherAgendamento([ag("p", -1)], AGORA)).toBeNull();
  });

  it("filtra o paciente pela clínica do phoneNumberId", async () => {
    const t = montar();
    await t.rodar({ phoneNumberId: "PHONE-B" });
    expect(t.localizarPaciente).toHaveBeenCalledWith("PHONE-B", expect.arrayContaining([FROM]));
  });

  it("variantes do telefone: com e sem o nono dígito", () => {
    expect(variantesTelefone("5511956515858")).toEqual(expect.arrayContaining(["5511956515858", "551156515858"]));
    expect(variantesTelefone("551186515858")).toEqual(expect.arrayContaining(["551186515858", "5511986515858"]));
  });

  it("usa o botão quando não há texto", async () => {
    const t = montar();
    await t.rodar({ texto: undefined, botao: "Confirmar" });
    expect(t.ia.enviadoUsuario()).toContain("Confirmar");
  });
});

describe("processar-resposta: privacidade da entrada da IA", () => {
  it("só o primeiro nome, sem sobrenome nem telefone", async () => {
    const t = montar();
    await t.rodar();
    const enviado = t.ia.enviado();
    expect(enviado).toContain("Maria");
    expect(enviado).not.toContain("Souza");
    expect(enviado).not.toContain("Lima");
    expect(enviado).not.toContain("956515858");
    expect(primeiroNomeParaIA("Ana-Clara Silva")).toBe("AnaClara");
    expect(primeiroNomeParaIA("  ")).toBe("Paciente");
  });
});

describe("processar-resposta: idempotência", () => {
  it("wamid repetido: nada reprocessado nem reenviado", async () => {
    const t = montar();
    await t.rodar();
    const r2 = await t.rodar();
    expect(r2.resultado).toBe("duplicada");
    expect(t.classificar).toHaveBeenCalledTimes(1);
    expect(t.sendText).toHaveBeenCalledTimes(1);
  });

  it("falha no envio: status já gravado, mensagem 'falhou', e o retry não reclassifica nem reenvia", async () => {
    const t = montar({ envioFalha: true });
    const r = await t.rodar();
    expect(r).toMatchObject({ resultado: "confirmado", enviada: false });
    expect(t.db.status.get(AG1)).toBe("confirmado");
    expect(t.db.mensagens.get("m-wamid.IN")).toMatchObject({ status: "falhou", erroCodigo: 131047 });
    const r2 = await t.rodar();
    expect(r2.resultado).toBe("duplicada");
    expect(t.classificar).toHaveBeenCalledTimes(1);
    expect(t.sendText).toHaveBeenCalledTimes(1);
  });

  it("crash após a decisão e antes do envio: reexecução não duplica a reserva do texto", async () => {
    const t = montar();
    await t.rodar();
    t.db.respostas.get("wamid.IN")!.decidida = false; // simula resposta gravada mas não decidida
    const r = await t.rodar();
    expect(r.enviada).toBe(false); // reserva (resposta_a_wamid) já existe: não envia de novo
    expect(t.sendText).toHaveBeenCalledTimes(1);
  });

  it("saída inválida da IA: lança (retry do Inngest) e não grava decisão nem envia", async () => {
    const t = montar({ respostaIA: "isto não é json" });
    await expect(t.rodar()).rejects.toThrow();
    expect(t.db.decisoes).toHaveLength(0);
    expect(t.sendText).not.toHaveBeenCalled();
    expect(t.db.status.get(AG1)).toBe("enviado");
  });
});

describe("processar-resposta: contexto da clínica (RAG leve)", () => {
  it("envia REGRAS e EXEMPLOS ao modelo; só o preparo do atendimento em questão", async () => {
    const t = montar({
      paciente: {
        ...paciente,
        regras: { prazoCancelamentoHoras: 24, preparos: { cardiologia: "Venha sem cafeína.", ultrassom: "Bexiga cheia." } },
      },
      buscarConhecimento: async () => [
        { tipo: "faq", conteudo: "Estacionamento gratuito." },
        { tipo: "exemplo_classificado", conteudo: JSON.stringify({ texto: "fechado, pode marcar", intencao: "confirmou" }) },
      ],
    });
    await t.rodar();
    const u = t.ia.enviadoUsuario();
    expect(u).toContain("REGRAS:");
    expect(u).toContain("Cancelamento até 24 horas antes da consulta.");
    expect(u).toContain("Venha sem cafeína.");
    expect(u).not.toContain("Bexiga cheia.");
    expect(u).toContain("Estacionamento gratuito.");
    expect(u).toContain("EXEMPLOS JÁ CLASSIFICADOS:");
    expect(u).toContain('"fechado, pode marcar" → confirmou');
    expect(t.ia.enviado()).toContain("apenas dados de referência"); // aviso de dados no SYSTEM
  });

  it("falha ao buscar contexto: classifica mesmo assim, com contexto vazio", async () => {
    const t = montar({ buscarConhecimento: async () => { throw new Error("db fora do ar"); } });
    const r = await t.rodar();
    expect(r.resultado).toBe("confirmado");
    expect(t.ia.enviadoUsuario()).toContain("REGRAS: (nenhuma)");
    expect(t.ia.enviadoUsuario()).not.toContain("EXEMPLOS JÁ CLASSIFICADOS");
  });
});
