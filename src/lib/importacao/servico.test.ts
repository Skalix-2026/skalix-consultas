import { describe, it, expect, vi } from "vitest";
import { importarAgenda, type DepsImportacao } from "./servico";
import { hashArquivo } from "./ler-arquivo";
import { SemCabecalhoError } from "@/ai/harness/mapear-colunas";

const AGORA = new Date("2026-10-13T12:00:00Z");
const CLINICA = { id: "clinica-1", fuso: "America/Sao_Paulo" };

const CSV = [
  "Nome;Telefone;Atendimento;Profissional;Data;Hora;CPF;Observacoes",
  "Maria Souza Lima;(11) 90000-0101;Consulta cardiologia;Dr. Caio;20/10/2026;08:00;123.456.789-09;diabetica CID E11",
  "Joao Pereira;11900000102;Eletrocardiograma;Dr. Caio;20/10/2026;08:30;987.654.321-00;",
  "Ana Beatriz Costa;123;Holter;Dr. Caio;20/10/2026;09:00;111.111.111-11;",
].join("\n");

function deps(over: Partial<DepsImportacao> = {}) {
  const d = {
    buscarLotePorHash: vi.fn().mockResolvedValue(null),
    criarLote: vi.fn().mockResolvedValue({ loteId: "lote-novo", inseridas: 2, duplicadas: 0 }),
    mapearColunas: vi.fn(),
    extrairAgendaPdf: vi.fn(),
    extrairTextoPdf: vi.fn(),
    agora: () => AGORA,
  };
  return Object.assign(d, over) as typeof d;
}

describe("importarAgenda - planilha/CSV", () => {
  it("caminho feliz: heurística, sem IA, persiste só as válidas e sem colunas extras", async () => {
    const d = deps();
    const { status, corpo } = await importarAgenda(d, { buffer: Buffer.from(CSV), nomeArquivo: "agenda.csv", clinica: CLINICA });

    expect(status).toBe(200);
    expect(corpo).toMatchObject({ ok: true, loteId: "lote-novo", reaproveitado: false, totalLinhas: 3, validas: 2, duplicadas: 0 });
    expect(d.mapearColunas).not.toHaveBeenCalled();
    expect(d.extrairAgendaPdf).not.toHaveBeenCalled();

    const arg = d.criarLote.mock.calls[0][0];
    expect(arg.validas).toHaveLength(2);
    expect(arg.mapeamento.origem).toBe("heuristica");
    expect(arg.mapeamento.arquivoHash).toBe(hashArquivo(Buffer.from(CSV)));
    // nada de CPF/observações/CID persistidos
    const gravado = JSON.stringify(arg);
    expect(gravado).not.toContain("123.456.789-09");
    expect(gravado).not.toContain("CID");
    expect(Object.keys(arg.validas[0]).sort()).toEqual(
      ["atendimento", "chaveExterna", "dataHora", "nome", "profissional", "telefone", "tipo"],
    );
  });

  it("linha inválida volta só mascarada/abreviada e não é persistida", async () => {
    const d = deps();
    const { corpo } = await importarAgenda(d, { buffer: Buffer.from(CSV), nomeArquivo: "agenda.csv", clinica: CLINICA });
    if (!corpo.ok) throw new Error("esperava ok");
    expect(corpo.invalidas).toHaveLength(1);
    expect(corpo.invalidas[0].linha).toBe(4);
    expect(corpo.invalidas[0].bruto.nome).toBe("Ana B.");
    expect(corpo.invalidas[0].bruto.telefone).toBe("****");
    expect(JSON.stringify(corpo.invalidas)).not.toContain("Costa");
    expect(JSON.stringify(corpo.invalidas)).not.toContain("111.111");
  });

  it("duplicadas vêm do banco (ON CONFLICT DO NOTHING) e geram aviso", async () => {
    const d = deps({ criarLote: vi.fn().mockResolvedValue({ loteId: "l", inseridas: 1, duplicadas: 1 }) });
    const { corpo } = await importarAgenda(d, { buffer: Buffer.from(CSV), nomeArquivo: "a.csv", clinica: CLINICA });
    if (!corpo.ok) throw new Error("esperava ok");
    expect(corpo.duplicadas).toBe(1);
    expect(corpo.avisos.join(" ")).toContain("já existiam");
  });

  it("mesmo hash na mesma clínica: reaproveita o lote, sem reprocessar, sem IA e sem gravar", async () => {
    const d = deps({
      buscarLotePorHash: vi.fn().mockResolvedValue({ id: "lote-antigo", arquivoNome: "x.csv", totalLinhas: 3, linhasValidas: 2, status: "importado", criadoEm: new Date() }),
    });
    const { status, corpo } = await importarAgenda(d, { buffer: Buffer.from(CSV), nomeArquivo: "outro-nome.csv", clinica: CLINICA });
    expect(status).toBe(200);
    expect(corpo).toMatchObject({ ok: true, loteId: "lote-antigo", reaproveitado: true, totalLinhas: 3, validas: 2 });
    expect(d.buscarLotePorHash).toHaveBeenCalledWith("clinica-1", hashArquivo(Buffer.from(CSV)));
    expect(d.criarLote).not.toHaveBeenCalled();
    expect(d.mapearColunas).not.toHaveBeenCalled();
    expect(d.extrairAgendaPdf).not.toHaveBeenCalled();
  });

  it("heurística falha: chama o Haiku UMA vez e segue com o mapeamento dele", async () => {
    const csv = "Qm;Ctt;Svc;Qdo\nMaria Souza;(11) 90000-0101;Consulta;20/10/2026 08:00\n";
    const hash = hashArquivo(Buffer.from(csv));
    const d = deps({
      mapearColunas: vi.fn().mockResolvedValue({
        colunas: { nome: "Qm", telefone: "Ctt", atendimento: "Svc", data_hora: "Qdo" },
        formatoData: "dd/MM/yyyy", origem: "haiku", arquivoHash: hash, confianca: 0.7,
      }),
    });
    const { corpo } = await importarAgenda(d, { buffer: Buffer.from(csv), nomeArquivo: "x.csv", clinica: CLINICA });
    expect(d.mapearColunas).toHaveBeenCalledTimes(1);
    if (!corpo.ok) throw new Error(JSON.stringify(corpo));
    expect(corpo.validas).toBe(1);
    expect(corpo.avisos.join(" ")).toContain("baixa confiança");
    expect(d.criarLote.mock.calls[0][0].mapeamento.origem).toBe("haiku");
  });

  it("arquivo sem cabeçalho: 422 sem_cabecalho e nada gravado", async () => {
    const csv = "Maria Souza;(11) 90000-0101;Consulta;20/10/2026 08:00\nJoao Lima;(11) 90000-0102;Exame;20/10/2026 09:00\n";
    const d = deps({ mapearColunas: vi.fn().mockRejectedValue(new SemCabecalhoError([0])) });
    const { status, corpo } = await importarAgenda(d, { buffer: Buffer.from(csv), nomeArquivo: "x.csv", clinica: CLINICA });
    expect(status).toBe(422);
    expect(corpo).toMatchObject({ ok: false, erro: "sem_cabecalho" });
    expect(d.criarLote).not.toHaveBeenCalled();
  });

  it("nenhuma linha válida: 422 com os motivos (mascarados) e sem criar lote", async () => {
    const csv = "Nome;Telefone;Atendimento;Data;Hora\nMaria Souza;123;Consulta;20/10/2026;08:00\n";
    const d = deps();
    const { status, corpo } = await importarAgenda(d, { buffer: Buffer.from(csv), nomeArquivo: "x.csv", clinica: CLINICA });
    expect(status).toBe(422);
    expect(corpo).toMatchObject({ ok: false, erro: "nenhuma_linha_valida" });
    if (corpo.ok) throw new Error();
    expect(corpo.invalidas?.[0].bruto.nome).toBe("Maria S.");
    // grava o lote vazio (só o hash) para o mesmo arquivo não pagar IA de novo
    expect(d.criarLote).toHaveBeenCalledTimes(1);
    expect(d.criarLote.mock.calls[0][0]).toMatchObject({ validas: [], totalLinhas: 1 });
    expect(d.criarLote.mock.calls[0][0].mapeamento.arquivoHash).toBe(hashArquivo(Buffer.from(csv)));
  });

  it("reenvio de arquivo já analisado sem linhas válidas: 422 sem reprocessar nem IA", async () => {
    const d = deps({
      buscarLotePorHash: vi.fn().mockResolvedValue({ id: "l0", arquivoNome: "x.csv", totalLinhas: 1, linhasValidas: 0, status: "importado", criadoEm: new Date() }),
    });
    const { status, corpo } = await importarAgenda(d, { buffer: Buffer.from("a;b\n1;2\n"), nomeArquivo: "x.csv", clinica: CLINICA });
    expect(status).toBe(422);
    expect(corpo).toMatchObject({ ok: false, erro: "nenhuma_linha_valida" });
    expect(d.criarLote).not.toHaveBeenCalled();
    expect(d.mapearColunas).not.toHaveBeenCalled();
  });

  it("formato inválido (415) e arquivo grande (413) antes de qualquer trabalho", async () => {
    const d = deps();
    expect((await importarAgenda(d, { buffer: Buffer.from("x"), nomeArquivo: "a.docx", clinica: CLINICA })).status).toBe(415);
    const grande = Buffer.alloc(5 * 1024 * 1024 + 1);
    expect((await importarAgenda(d, { buffer: grande, nomeArquivo: "a.csv", clinica: CLINICA })).status).toBe(413);
    expect(d.buscarLotePorHash).not.toHaveBeenCalled();
  });
});

describe("importarAgenda - PDF", () => {
  const pdf = Buffer.from("%PDF-1.4 falso");

  it("caminho feliz: texto -> Sonnet (1 chamada) -> aplica mapeamento", async () => {
    const hash = hashArquivo(pdf);
    const d = deps({
      extrairTextoPdf: vi.fn().mockResolvedValue("agenda do dia"),
      extrairAgendaPdf: vi.fn().mockResolvedValue({
        cabecalhos: ["nome", "telefone", "atendimento", "profissional", "data", "hora"],
        linhas: [{ nome: "Maria Souza", telefone: "(11) 90000-0101", atendimento: "Consulta", profissional: "Dr. Caio", data: "2026-10-20", hora: "08:00" }],
        mapeamento: {
          colunas: { nome: "nome", telefone: "telefone", atendimento: "atendimento", profissional: "profissional", data: "data", hora: "hora" },
          formatoData: "yyyy-MM-dd", origem: "sonnet_pdf", arquivoHash: hash,
        },
        avisos: ["Linha 2 da extração descartada: campo(s) inválido(s): hora."],
      }),
    });
    const { corpo } = await importarAgenda(d, { buffer: pdf, nomeArquivo: "agenda.PDF", clinica: CLINICA });
    expect(d.extrairAgendaPdf).toHaveBeenCalledTimes(1);
    expect(d.extrairAgendaPdf.mock.calls[0][0]).toMatchObject({ arquivoHash: hash, dataReferencia: "2026-10-13" });
    expect(d.mapearColunas).not.toHaveBeenCalled();
    if (!corpo.ok) throw new Error(JSON.stringify(corpo));
    expect(corpo.validas).toBe(1);
    expect(corpo.avisos[0]).toContain("descartada");
    expect(d.criarLote.mock.calls[0][0].mapeamento.origem).toBe("sonnet_pdf");
  });

  it("PDF sem texto (escaneado): 422 sem chamar a IA", async () => {
    const d = deps({ extrairTextoPdf: vi.fn().mockResolvedValue("   ") });
    const { status, corpo } = await importarAgenda(d, { buffer: pdf, nomeArquivo: "a.pdf", clinica: CLINICA });
    expect(status).toBe(422);
    expect(corpo).toMatchObject({ ok: false, erro: "pdf_sem_texto" });
    expect(d.extrairAgendaPdf).not.toHaveBeenCalled();
  });

  it("falha do harness vira 422 extracao_falhou, sem vazar a mensagem", async () => {
    const d = deps({
      extrairTextoPdf: vi.fn().mockResolvedValue("texto"),
      extrairAgendaPdf: vi.fn().mockRejectedValue(new Error("Maria Souza 11900000000")),
    });
    const { status, corpo } = await importarAgenda(d, { buffer: pdf, nomeArquivo: "a.pdf", clinica: CLINICA });
    expect(status).toBe(422);
    expect(JSON.stringify(corpo)).not.toContain("Maria");
    expect(d.criarLote).not.toHaveBeenCalled();
  });
});
