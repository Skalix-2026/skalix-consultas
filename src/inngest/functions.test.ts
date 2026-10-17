import { describe, it, expect } from "vitest";
import { logMensagemRecebida, logStatusAtualizado, logEnviarLote, functions, processarResposta, recuperarPendentes, anonimizarRespostas } from "./functions";

const TEXTO = "Sim, confirmo a consulta da Maria Souza com a Dra. Ana";

describe("logs do Inngest sem dados de paciente", () => {
  it("mensagem recebida: wamid, telefone mascarado e tamanho — nunca o texto", () => {
    const log = logMensagemRecebida({
      from: "5511956515858", wamid: "wamid.ABC", texto: TEXTO, botao: "Confirmar", timestamp: "1", phoneNumberId: "99",
    });
    expect(log).toEqual({ wamid: "wamid.ABC", de: "(11) 9****-5858", tamanho: TEXTO.length, temBotao: true });
    const s = JSON.stringify(log);
    expect(s).not.toContain("Maria");
    expect(s).not.toContain("Confirmar");
    expect(s).not.toContain("956515858");
  });

  it("mensagem sem texto: tamanho 0", () => {
    expect(logMensagemRecebida({ from: "5511956515858", wamid: "w", timestamp: "1", phoneNumberId: "9" }).tamanho).toBe(0);
  });

  it("status: só wamid, status e código de erro (sem a mensagem de erro da Meta)", () => {
    const log = logStatusAtualizado({ wamid: "wamid.X", status: "failed", erroCodigo: 131026, erroMensagem: "Undeliverable to +5511956515858" });
    expect(log).toEqual({ wamid: "wamid.X", status: "failed", erroCodigo: 131026 });
  });

  it("lote: só loteId", () => {
    expect(logEnviarLote({ loteId: "lote-1", data: "2026-10-09" })).toEqual({ loteId: "lote-1" });
  });
});

describe("funções registradas", () => {
  it("processar-resposta substitui o antigo processar-mensagem-recebida", () => {
    expect(functions).toContain(processarResposta);
    expect(processarResposta.id()).toBe("processar-resposta");
    expect(functions.map((f) => f.id())).not.toContain("processar-mensagem-recebida");
  });

  it("recuperar-pendentes está registrada", () => {
    expect(functions).toContain(recuperarPendentes);
    expect(recuperarPendentes.id()).toBe("recuperar-pendentes");
  });

  it("anonimizar-respostas está registrada", () => {
    expect(functions).toContain(anonimizarRespostas);
    expect(anonimizarRespostas.id()).toBe("anonimizar-respostas");
  });
});
