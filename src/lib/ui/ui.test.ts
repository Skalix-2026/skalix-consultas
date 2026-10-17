import { describe, expect, it } from "vitest";
import { formatarTamanho, validarArquivo } from "./arquivo";
import { formatarDataHora } from "./formatar";
import { explicarErro, infoLote, intervaloPolling, podeEnviar, textoBotaoEnviar } from "./status";

describe("validarArquivo", () => {
  it("aceita extensões válidas", () => {
    expect(validarArquivo({ name: "Agenda.XLSX", size: 100 })).toBeNull();
    expect(validarArquivo({ name: "a.pdf", size: 100 })).toBeNull();
  });
  it("rejeita extensão, vazio e grande", () => {
    expect(validarArquivo({ name: "a.docx", size: 100 })).toMatch(/Formato/);
    expect(validarArquivo({ name: "semext", size: 100 })).toMatch(/Formato/);
    expect(validarArquivo({ name: "a.csv", size: 0 })).toMatch(/vazio/);
    expect(validarArquivo({ name: "a.csv", size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
  });
  it("formata tamanho", () => {
    expect(formatarTamanho(500)).toBe("500 B");
    expect(formatarTamanho(2048)).toBe("2 KB");
    expect(formatarTamanho(1572864)).toBe("1,5 MB");
  });
});

describe("formatarDataHora", () => {
  it("usa fuso de São Paulo", () => {
    expect(formatarDataHora("2026-10-14T12:30:00Z")).toBe("14/10/2026 09:30");
  });
  it("tolera data inválida", () => {
    expect(formatarDataHora("x")).toBe("—");
  });
});

describe("status", () => {
  it("explica 130497", () => {
    expect(explicarErro(130497, "x")).toBe("Conta Meta ainda não verificada (código 130497)");
    expect(explicarErro(null, null)).toBeNull();
    expect(explicarErro(1, "Boom")).toBe("Boom (código 1)");
  });
  it("regras do botão enviar", () => {
    expect(podeEnviar("importado", 3)).toBe(true);
    expect(podeEnviar("conferido", 0)).toBe(false);
    expect(podeEnviar("enviando", 3)).toBe(false);
    expect(podeEnviar("concluido", 2)).toBe(true);
    expect(podeEnviar("concluido", 0)).toBe(false);
    expect(textoBotaoEnviar("concluido")).toBe("Reenviar pendentes");
    expect(textoBotaoEnviar("concluido", 2)).toBe("Reenviar pendentes e falhas");
    expect(textoBotaoEnviar("importado", 2)).toBe("Enviar confirmações");
  });
  it("intervalo de polling", () => {
    expect(intervaloPolling("enviando", [])).toBe(3000);
    expect(intervaloPolling("concluido", ["enviada", "lida"])).toBe(10000);
    expect(intervaloPolling("concluido", ["pendente"])).toBe(10000);
    expect(intervaloPolling("concluido", ["lida", "falhou", null])).toBeNull();
  });
  it("rótulo de lote", () => {
    expect(infoLote("enviando").rotulo).toBe("Enviando…");
    expect(infoLote("zzz").rotulo).toBe("zzz");
  });
});
