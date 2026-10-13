import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { lerArquivo, extrairTextoPdf, hashArquivo, celulaDataParaTexto, FormatoNaoSuportadoError } from "./ler-arquivo";
import { mapearPorHeuristica, detectarFormatoData, analisarFormatoData } from "./heuristica";
import { aplicarMapeamento, parseDataHora, parseHora, paraExibicao, offsetDoFuso, AVISO_DATA_AMBIGUA } from "./normalizar";
import type { Mapeamento } from "./tipos";

const EXEMPLOS = path.resolve(__dirname, "../../../docs/exemplos");
const ler = (nome: string) => readFileSync(path.join(EXEMPLOS, nome));

/** As fixtures têm datas fixas (13–15/10/2026): "agora" injetado para o teste não depender do relógio. */
const AGORA = new Date("2026-10-08T12:00:00Z");
const OPCOES = { fuso: "America/Sao_Paulo", agora: AGORA };

function importar(nome: string) {
  const buf = ler(nome);
  const arq = lerArquivo(buf, nome);
  const parcial = mapearPorHeuristica(arq.cabecalhos, arq.linhas);
  return { arq, parcial };
}

describe("clínica A (.xlsx)", () => {
  it("heurística mapeia e linhas ruins vão para inválidas", () => {
    const { arq, parcial } = importar("agenda-clinica-a.xlsx");
    expect(arq.cabecalhos).toEqual(["Paciente", "Celular", "Procedimento", "Médico", "Data", "Hora"]);
    expect(arq.linhas).toHaveLength(15);
    expect(arq.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(parcial).not.toBeNull();
    expect(parcial!.colunas).toMatchObject({
      nome: "Paciente", telefone: "Celular", atendimento: "Procedimento",
      profissional: "Médico", data: "Data", hora: "Hora",
    });
    expect(parcial!.formatoData).toBe("yyyy-MM-dd"); // célula de data do Excel → ISO na leitura

    const r = aplicarMapeamento(arq.linhas, { ...parcial!, arquivoHash: arq.hash }, OPCOES);
    expect(r.validas).toHaveLength(12);
    expect(r.invalidas.map((x) => [x.linha, x.motivo])).toEqual([
      [6, "Telefone inválido ou sem DDD"],
      [8, "Data vazia"],
      [11, "Nome vazio"],
    ]);
    expect(r.validas[0].dados).toEqual({
      nome: "Aurora Bittencourt Lago",
      telefone: "5511900000101",
      atendimento: "Consulta cardiologia",
      profissional: "Dr. Caio Ventura",
      dataHora: "2026-10-13T08:00:00-03:00",
      tipo: null,
      chaveExterna: null,
    });
    // fixo de 8 dígitos
    expect(r.validas.find((v) => v.dados.nome === "Dorival Quintanilha")!.dados.telefone).toBe("551130000104");
  });
});

describe("clínica B (.csv ; com BOM, data/hora numa coluna)", () => {
  it("heurística mapeia DATA/HORA e linhas ruins vão para inválidas", () => {
    const { arq, parcial } = importar("agenda-clinica-b.csv");
    expect(arq.cabecalhos[0]).toBe("NOME DO PACIENTE"); // BOM removido
    expect(arq.linhas).toHaveLength(15);
    expect(parcial).not.toBeNull();
    expect(parcial!.colunas).toMatchObject({
      nome: "NOME DO PACIENTE", telefone: "FONE", atendimento: "EXAME",
      profissional: "PROFISSIONAL", data_hora: "DATA/HORA",
    });
    expect(parcial!.formatoData).toBe("dd/MM/yyyy");

    const r = aplicarMapeamento(arq.linhas, { ...parcial!, arquivoHash: arq.hash }, OPCOES);
    expect(r.validas).toHaveLength(12);
    expect(r.invalidas.map((x) => x.motivo)).toEqual([
      "Telefone inválido ou sem DDD",
      "Nome vazio",
      "Data/hora vazia",
    ]);
    const quiteria = r.validas.find((v) => v.dados.nome === "QUITÉRIA MONTEIRO")!;
    expect(quiteria.dados.telefone).toBe("5521900000203");
    expect(quiteria.dados.dataHora).toBe("2026-10-13T08:10:00-03:00");
  });
});

describe("clínica C (.csv , cabeçalhos fora do padrão)", () => {
  it("heurística retorna null (caso para o fallback de IA)", () => {
    const { arq, parcial } = importar("agenda-clinica-c.csv");
    expect(arq.cabecalhos).toEqual(["Cliente", "Contato WhatsApp", "Serviço", "Responsável", "Dia", "Horário"]);
    expect(arq.linhas).toHaveLength(15);
    expect(parcial).toBeNull();
  });

  it("com mapeamento vindo de fora (ex.: Haiku), normaliza horário '9h45'", () => {
    const arq = lerArquivo(ler("agenda-clinica-c.csv"), "agenda-clinica-c.csv");
    const mapeamento: Mapeamento = {
      colunas: { nome: "Cliente", telefone: "Contato WhatsApp", atendimento: "Serviço", profissional: "Responsável", data: "Dia", hora: "Horário" },
      formatoData: "dd/MM/yyyy",
      origem: "haiku",
      arquivoHash: arq.hash,
    };
    const r = aplicarMapeamento(arq.linhas, mapeamento, OPCOES);
    expect(r.validas).toHaveLength(12);
    expect(r.invalidas).toHaveLength(3);
    expect(r.validas[1].dados.dataHora).toBe("2026-10-13T09:45:00-03:00");
  });
});

describe("clínica D (.pdf)", () => {
  it("extrai o texto com os nomes dos pacientes", async () => {
    const texto = await extrairTextoPdf(ler("agenda-clinica-d.pdf"));
    expect(texto).toContain("Clínica Ortopédica Pinheiral");
    for (const nome of ["Silvana Prates Couto", "Tarcísio Leme Barros", "Flávio Rocha Lemos"]) expect(texto).toContain(nome);
  });

  it("lerArquivo recusa PDF (vai pelo fluxo de IA)", () => {
    expect(() => lerArquivo(ler("agenda-clinica-d.pdf"), "agenda-clinica-d.pdf")).toThrow(FormatoNaoSuportadoError);
  });
});

describe("ler-arquivo / normalizar — casos de borda", () => {
  it("hash é estável e muda com o conteúdo", () => {
    expect(hashArquivo(Buffer.from("a"))).toBe(hashArquivo(Buffer.from("a")));
    expect(hashArquivo(Buffer.from("a"))).not.toBe(hashArquivo(Buffer.from("b")));
  });

  it("CSV em Windows-1252 é decodificado", () => {
    const buf = Buffer.from("Paciente;Telefone\nJoão Ç;11900000001\n", "latin1");
    const arq = lerArquivo(buf, "x.csv");
    expect(arq.cabecalhos).toEqual(["Paciente", "Telefone"]);
    expect(arq.linhas[0].Paciente).toBe("João Ç");
  });

  it("detecta formatos de data", () => {
    expect(detectarFormatoData(["46308", "46309"])).toBe("serial_excel");
    expect(detectarFormatoData(["10/13/2026"])).toBe("MM/dd/yyyy");
    expect(detectarFormatoData(["13-10-2026"])).toBe("dd-MM-yyyy");
    expect(detectarFormatoData([""])).toBeNull();
  });

  it("serial do Excel com fração vira data e hora", () => {
    // 46308 = 13/10/2026; 0.375 = 09:00
    expect(parseDataHora("46308.375", "serial_excel")).toEqual({ data: { y: 2026, m: 10, d: 13 }, hora: { hh: 9, mm: 0 } });
  });

  it("data inexistente é inválida", () => {
    const r = aplicarMapeamento(
      [{ N: "Ana Teste", T: "11900000001", A: "Consulta", D: "31/02/2026", H: "08:00" }],
      { colunas: { nome: "N", telefone: "T", atendimento: "A", data: "D", hora: "H" }, formatoData: "dd/MM/yyyy", origem: "heuristica", arquivoHash: "x" },
      OPCOES,
    );
    expect(r.validas).toHaveLength(0);
    expect(r.invalidas[0].motivo).toBe("Data inválida");
  });

  it("coluna 'Data' com horário embutido é tratada como data_hora", () => {
    const p = mapearPorHeuristica(["Nome", "Telefone", "Exame", "Data"], [{ Nome: "x", Telefone: "y", Exame: "z", Data: "13/10/2026 08:00" }]);
    expect(p?.colunas.data_hora).toBe("Data");
    expect(p?.colunas.data).toBeUndefined();
  });
});

// ---------- correções da revisão ----------

const MAP_SEPARADO: Mapeamento = {
  colunas: { nome: "N", telefone: "T", atendimento: "A", data: "D", hora: "H" },
  formatoData: "dd/MM/yyyy", origem: "heuristica", arquivoHash: "x",
};
const linhaBase = { N: "Ana Teste", T: "11900000001", A: "Consulta", D: "13/10/2026", H: "08:00" };
const umaLinha = (extra: Partial<typeof linhaBase>, opcoes: { fuso: string; agora?: Date } = OPCOES) =>
  aplicarMapeamento([{ ...linhaBase, ...extra }], MAP_SEPARADO, opcoes);

describe("1. bruto das inválidas só com colunas mapeadas + paraExibicao", () => {
  const linhas = [{
    Paciente: "Aurora Bittencourt Lago", Celular: "900000101", Procedimento: "Consulta", Data: "13/10/2026", Hora: "08:00",
    Observações: "alergia a dipirona", CID: "I10", CPF: "123.456.789-00", Convênio: "Unimed",
  }];
  const map: Mapeamento = {
    colunas: { nome: "Paciente", telefone: "Celular", atendimento: "Procedimento", data: "Data", hora: "Hora" },
    formatoData: "dd/MM/yyyy", origem: "heuristica", arquivoHash: "x",
  };

  it("colunas não mapeadas nunca saem de aplicarMapeamento; chave = campo canônico", () => {
    const r = aplicarMapeamento(linhas, map, OPCOES);
    expect(r.invalidas).toHaveLength(1);
    expect(r.invalidas[0].bruto).toEqual({
      nome: "Aurora Bittencourt Lago", telefone: "900000101", atendimento: "Consulta", data: "13/10/2026", hora: "08:00",
    });
    const json = JSON.stringify(r);
    for (const proibido of ["dipirona", "I10", "123.456.789-00", "Unimed", "Observações", "CPF"]) expect(json).not.toContain(proibido);
  });

  it("linha válida não carrega colunas extras", () => {
    const r = aplicarMapeamento([{ ...linhas[0], Celular: "11900000101" }], map, OPCOES);
    expect(r.validas).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain("dipirona");
  });

  it("paraExibicao mascara telefone e reduz o nome", () => {
    const r = aplicarMapeamento([{ ...linhas[0], Data: "" }, { ...linhas[0], Celular: "11900000101", Data: "" }], map, OPCOES);
    expect(paraExibicao(r.invalidas[0])).toMatchObject({ nome: "Aurora B.", telefone: "****-0101", atendimento: "Consulta" });
    expect(paraExibicao(r.invalidas[1]).telefone).toBe("(11) 9****-0101");
    expect(paraExibicao({ linha: 2, motivo: "x", bruto: { nome: "Maria da Silva", telefone: "12" } }))
      .toEqual({ nome: "Maria S.", telefone: "****" });
    expect(paraExibicao({ linha: 2, motivo: "x", bruto: { nome: "Cher" } })).toEqual({ nome: "Cher" });
  });
});

describe("2. hora com AM/PM, intervalo e sufixo desconhecido", () => {
  it("AM/PM", () => {
    expect(parseHora("2:30 PM")).toEqual({ hh: 14, mm: 30 });
    expect(parseHora("2:30 pm")).toEqual({ hh: 14, mm: 30 });
    expect(parseHora("12:15 AM")).toEqual({ hh: 0, mm: 15 });
    expect(parseHora("12:15 PM")).toEqual({ hh: 12, mm: 15 });
    expect(parseHora("8:05 a.m.")).toEqual({ hh: 8, mm: 5 });
    expect(parseHora("13:00 PM")).toBeNull();
  });

  it("intervalo pega o início; formatos brasileiros seguem aceitos", () => {
    expect(parseHora("08:00 - 08:30")).toEqual({ hh: 8, mm: 0 });
    expect(parseHora("08:00-08:30")).toEqual({ hh: 8, mm: 0 });
    expect(parseHora("8h às 8h30")).toEqual({ hh: 8, mm: 0 });
    expect(parseHora("9h45")).toEqual({ hh: 9, mm: 45 });
    expect(parseHora("9h45min")).toEqual({ hh: 9, mm: 45 });
    expect(parseHora("08:00:00")).toEqual({ hh: 8, mm: 0 });
  });

  it("na importação: PM vira 14:30, sufixo desconhecido é inválido", () => {
    expect(umaLinha({ H: "2:30 PM" }).validas[0].dados.dataHora).toBe("2026-10-13T14:30:00-03:00");
    expect(umaLinha({ H: "08:00 - 08:30" }).validas[0].dados.dataHora).toBe("2026-10-13T08:00:00-03:00");
    for (const H of ["08:00 xyz", "08:00 - depois", "08:00 GMT"]) {
      const r = umaLinha({ H });
      expect(r.validas).toHaveLength(0);
      expect(r.invalidas[0].motivo).toBe("Hora em formato não reconhecido");
    }
    expect(umaLinha({ H: "abc" }).invalidas[0].motivo).toBe("Hora inválida");
  });

  it("sufixo desconhecido dentro de DATA/HORA também", () => {
    const base = { N: "Ana Teste", T: "11900000001", A: "Consulta" };
    const r = aplicarMapeamento(
      [{ ...base, DH: "13/10/2026 08:00 xyz" }, { ...base, DH: "13/10/2026 2:30 PM" }],
      { colunas: { nome: "N", telefone: "T", atendimento: "A", data_hora: "DH" }, formatoData: "dd/MM/yyyy", origem: "heuristica", arquivoHash: "x" },
      OPCOES,
    );
    expect(r.invalidas[0].motivo).toBe("Hora em formato não reconhecido");
    expect(r.validas[0].dados.dataHora).toBe("2026-10-13T14:30:00-03:00");
  });
});

describe("3. fuso da clínica", () => {
  it("offset calculado pelo Intl para a data", () => {
    const d = { y: 2026, m: 10, d: 13 }, h = { hh: 8, mm: 0 };
    expect(offsetDoFuso("America/Sao_Paulo", d, h)).toBe("-03:00");
    expect(offsetDoFuso("America/Manaus", d, h)).toBe("-04:00");
    expect(offsetDoFuso("America/Rio_Branco", d, h)).toBe("-05:00");
    expect(offsetDoFuso("UTC", d, h)).toBe("+00:00");
    // prova de que não é tabela fixa: São Paulo tinha horário de verão em jan/2019 (-02:00)
    expect(offsetDoFuso("America/Sao_Paulo", { y: 2019, m: 1, d: 15 }, h)).toBe("-02:00");
  });

  it("Manaus (-04:00) e Rio Branco (-05:00) na importação", () => {
    expect(umaLinha({}, { fuso: "America/Manaus", agora: AGORA }).validas[0].dados.dataHora).toBe("2026-10-13T08:00:00-04:00");
    expect(umaLinha({}, { fuso: "America/Rio_Branco", agora: AGORA }).validas[0].dados.dataHora).toBe("2026-10-13T08:00:00-05:00");
  });

  it("fuso inexistente lança erro", () => {
    expect(() => umaLinha({}, { fuso: "America/Atlantida", agora: AGORA })).toThrow(/Fuso inválido/);
  });
});

describe("4. serial cuja fração arredonda para 1440 min", () => {
  it("vira 00:00 do dia seguinte (normalizar)", () => {
    // 46308 = 13/10/2026; 0.9999999 ≈ 23:59:59.99
    expect(parseDataHora("46308.9999999", "serial_excel")).toEqual({ data: { y: 2026, m: 10, d: 14 }, hora: { hh: 0, mm: 0 } });
    expect(umaLinha({ D: "46308.9999999", H: "" }).validas[0].dados.dataHora).toBe("2026-10-14T00:00:00-03:00");
  });

  it("vira 00:00 do dia seguinte (leitura da célula); só horário não volta 24h", () => {
    expect(celulaDataParaTexto(46308.9999999)).toBe("2026-10-14 00:00");
    expect(celulaDataParaTexto(46308.375)).toBe("2026-10-13 09:00");
    expect(celulaDataParaTexto(46308)).toBe("2026-10-13");
    expect(celulaDataParaTexto(0.9999999)).toBe("23:59");
    expect(parseHora("0.9999999")).toEqual({ hh: 23, mm: 59 });
  });
});

describe("5. sistema de datas 1904", () => {
  it("conversão unitária", () => {
    // 1904: dia 0 = 01/01/1904; 13/10/2026 = 46308 - 1462 = 44846
    expect(celulaDataParaTexto(44846, true)).toBe("2026-10-13");
    expect(celulaDataParaTexto(44846.375, true)).toBe("2026-10-13 09:00");
    expect(celulaDataParaTexto(44846)).toBe("2022-10-12"); // mesmo número no sistema 1900
  });

  it("lerArquivo lê WBProps.date1904 da pasta de trabalho", () => {
    const ws = XLSX.utils.aoa_to_sheet([["Paciente", "Data"], ["Ana", 0]]);
    ws["B2"] = { t: "n", v: 44846.375, z: "dd/mm/yyyy hh:mm" };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Agenda");
    wb.Workbook = { WBProps: { date1904: true } };
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    expect(lerArquivo(buf, "a.xlsx").linhas[0].Data).toBe("2026-10-13 09:00");
  });
});

describe("6. data no passado", () => {
  it("antes de hoje no fuso da clínica é inválida; hoje é aceito", () => {
    const agora = new Date("2026-10-13T12:00:00Z");
    const r = aplicarMapeamento(
      [{ ...linhaBase, D: "12/10/2026" }, { ...linhaBase, D: "13/10/2026" }],
      MAP_SEPARADO, { fuso: "America/Sao_Paulo", agora },
    );
    expect(r.invalidas.map((x) => [x.linha, x.motivo])).toEqual([[2, "Data no passado"]]);
    expect(r.validas.map((x) => x.linha)).toEqual([3]);
  });

  it("'hoje' é o dia no fuso da clínica, não em UTC", () => {
    // 14/10 02:00 UTC = 13/10 23:00 em São Paulo = 13/10 21:00 em Rio Branco
    const agora = new Date("2026-10-14T02:00:00Z");
    expect(umaLinha({ D: "13/10/2026" }, { fuso: "America/Sao_Paulo", agora }).validas).toHaveLength(1);
    expect(umaLinha({ D: "13/10/2026" }, { fuso: "America/Rio_Branco", agora }).validas).toHaveLength(1);
    expect(umaLinha({ D: "13/10/2026" }, { fuso: "UTC", agora }).invalidas[0].motivo).toBe("Data no passado");
  });
});

describe("7. formato de data com todas as linhas e sinal de ambiguidade", () => {
  it("analisa todas as linhas: um dia > 12 no fim desambigua", () => {
    const valores = [...Array<string>(10).fill("05/06/2026"), "13/06/2026"];
    expect(analisarFormatoData(valores)).toEqual({ formato: "dd/MM/yyyy", ambiguo: false });
    expect(analisarFormatoData(["05/06/2026", "06/13/2026"])).toEqual({ formato: "MM/dd/yyyy", ambiguo: false });
    expect(analisarFormatoData(["05/06/2026", "07/08/2026"])).toEqual({ formato: "dd/MM/yyyy", ambiguo: true });
    expect(analisarFormatoData(["05-06-2026"])).toEqual({ formato: "dd-MM-yyyy", ambiguo: true });
    expect(analisarFormatoData(["2026-06-05"])).toEqual({ formato: "yyyy-MM-dd", ambiguo: false });
    expect(detectarFormatoData(["05/06/2026"])).toBe("dd/MM/yyyy"); // atalho compatível
  });

  it("mapearPorHeuristica olha além das primeiras linhas e sinaliza ambiguidade → aviso na triagem", () => {
    const cab = ["Nome", "Telefone", "Exame", "Data", "Hora"];
    const l = (Data: string) => ({ Nome: "Ana Teste", Telefone: "11900000001", Exame: "RX", Data, Hora: "08:00" });
    const desambiguado = mapearPorHeuristica(cab, [...Array.from({ length: 8 }, () => l("11/10/2026")), l("20/10/2026")]);
    expect(desambiguado?.formatoData).toBe("dd/MM/yyyy");
    expect(desambiguado?.formatoDataAmbiguo).toBeUndefined();

    const linhas = [l("11/10/2026"), l("12/11/2026")];
    const ambiguo = mapearPorHeuristica(cab, linhas)!;
    expect(ambiguo).toMatchObject({ formatoData: "dd/MM/yyyy", formatoDataAmbiguo: true });
    const r = aplicarMapeamento(linhas, { ...ambiguo, arquivoHash: "x" }, OPCOES);
    expect(r.avisos).toEqual([AVISO_DATA_AMBIGUA]);
    expect(r.validas[1].dados.dataHora).toBe("2026-11-12T08:00:00-03:00");
  });

  it("fixtures desambiguadas não geram aviso", () => {
    const { arq, parcial } = importar("agenda-clinica-b.csv");
    expect(aplicarMapeamento(arq.linhas, { ...parcial!, arquivoHash: arq.hash }, OPCOES).avisos).toEqual([]);
  });
});
