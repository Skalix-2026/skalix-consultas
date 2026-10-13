import { describe, it, expect } from "vitest";
import { mascararCabecalho, mascararValor, ocultarNumerosLongos } from "./privacidade";

describe("mascararValor (só a forma do valor)", () => {
  it("e-mail → [email]", () => {
    expect(mascararValor("maria.souza@gmail.com")).toBe("[email]");
    expect(mascararValor("contato: ana@x.com.br")).toBe("[texto] [email]");
  });

  it("CPF com e sem pontuação → só a forma", () => {
    expect(mascararValor("123.456.789-00")).toBe("999.999.999-99");
    expect(mascararValor("12345678900")).toBe("99999999999");
  });

  it("telefones viram forma de dígitos (nenhum dígito real)", () => {
    expect(mascararValor("(11) 98765-4321")).toBe("(99) 99999-9999");
    expect(mascararValor("+55 21 3333-4444")).toBe("+99 99 9999-9999");
  });

  it("data e hora preservam a forma", () => {
    expect(mascararValor("08/10/2026")).toBe("99/99/9999");
    expect(mascararValor("2026-10-08 14:30")).toBe("9999-99-99 99:99");
    expect(mascararValor("14h30")).toBe("99h99");
  });

  it("nome com hífen → [texto] (nunca vaza a parte depois do hífen)", () => {
    expect(mascararValor("Maria-Silva Souza")).toBe("[texto]");
    expect(mascararValor("D'Ávila Ramos")).toBe("[texto]");
    expect(mascararValor("Dr. João Pereira")).toBe("[texto]");
  });

  it("\"Sobrenome, Nome\" → só o nome", () => {
    expect(mascararValor("Oliveira, José Carlos")).toBe("José");
    expect(mascararValor("SILVA SANTOS, Maria José")).toBe("Maria");
  });

  it("nome comum → só a primeira palavra", () => {
    expect(mascararValor("Maria Aparecida da Silva")).toBe("Maria");
  });

  it("letras coladas a dígitos não vazam", () => {
    expect(mascararValor("Souza123")).toBe("[texto]999");
  });
});

describe("mascararCabecalho", () => {
  it("mantém palavras, troca dígitos e e-mails", () => {
    expect(mascararCabecalho("Telefone 2")).toBe("Telefone 9");
    expect(mascararCabecalho("Nome do Paciente")).toBe("Nome do Paciente");
    expect(mascararCabecalho("a@b.com")).toBe("[email]");
  });
});

describe("ocultarNumerosLongos (varredura fail-closed)", () => {
  it("telefone fora do padrão e CPF viram [NUM_n]; datas e horas ficam", () => {
    const { texto, quantidade } = ocultarNumerosLongos(
      "Ana 11 9876 54321 · CPF 123.456.789-00 · 12345678900 · 08/10/2026 2026-10-08 14:30 · id 1234/5678",
    );
    expect(texto.replace(/NUM_\d+/g, "NUM")).toBe("Ana [NUM] · CPF [NUM] · [NUM] · 08/10/2026 2026-10-08 14:30 · id [NUM]");
    expect(quantidade).toBe(4);
  });

  it("data colada a outros dígitos não protege o número", () => {
    expect(ocultarNumerosLongos("08/10/2026/1234").texto).not.toMatch(/\d{4}$/);
  });
});
