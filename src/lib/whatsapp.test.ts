import { describe, it, expect, vi, afterEach } from "vitest";
import { mask, fakeSender } from "./whatsapp";

describe("mask", () => {
  it("mascara número brasileiro em E.164", () => {
    expect(mask("5511956515858")).toBe("(11) 9****-5858");
  });
  it("aceita número sem DDI", () => {
    expect(mask("11911700407")).toBe("(11) 9****-0407");
  });
});

describe("fakeSender não loga dados de paciente", () => {
  const d = { phoneNumberId: "1", token: "tok-secreto", to: "5511956515858" };
  afterEach(() => vi.restoreAllMocks());

  const capturar = () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    return () => JSON.stringify(spy.mock.calls);
  };

  it("sendText: devolve wamid fake e loga só máscara + tamanho", async () => {
    const saida = capturar();
    const body = "Olá Maria, sua consulta com Dra. Ana é amanhã às 14h";
    const r = await fakeSender.sendText(d, body);
    expect(r.wamid).toMatch(/^fake\.[0-9a-f-]{36}$/);
    const s = saida();
    expect(s).toContain("(11) 9****-5858");
    expect(s).toContain(`"tamanho":${body.length}`);
    expect(s).not.toContain("Maria");
    expect(s).not.toContain("956515858");
    expect(s).not.toContain("tok-secreto");
  });

  it("sendTemplate: devolve wamid fake e não loga os parâmetros", async () => {
    const saida = capturar();
    const r = await fakeSender.sendTemplate(d, "confirmacao_consulta", ["Maria", "09/10", "Dra. Ana"]);
    expect(r.wamid).toMatch(/^fake\.[0-9a-f-]{36}$/);
    const s = saida();
    expect(s).toContain("confirmacao_consulta");
    expect(s).not.toContain("Maria");
    expect(s).not.toContain("Dra. Ana");
    expect(s).not.toContain("956515858");
  });
});
