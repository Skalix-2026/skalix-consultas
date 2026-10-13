/**
 * Gera as agendas sintéticas de `docs/exemplos/` (nomes e telefones 100% fictícios).
 * Uso: npx tsx scripts/gerar-exemplos.ts
 * Cada arquivo traz ~15 linhas, das quais 3 são propositalmente ruins.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const DESTINO = path.resolve(__dirname, "..", "docs", "exemplos");

type Linha = { nome: string; telefone: string; atendimento: string; profissional: string; data: string; hora: string };

/** Datas no formato dd/MM/yyyy. Telefones no bloco 9 0000-xxxx (fictícios). */
const A: Linha[] = [
  { nome: "Aurora Bittencourt Lago", telefone: "(11) 90000-0101", atendimento: "Consulta cardiologia", profissional: "Dr. Caio Ventura", data: "13/10/2026", hora: "08:00" },
  { nome: "Benício Prado Salles", telefone: "11900000102", atendimento: "Eletrocardiograma", profissional: "Dr. Caio Ventura", data: "13/10/2026", hora: "08:30" },
  { nome: "Celeste Amaral Duarte", telefone: "+55 11 90000-0103", atendimento: "Consulta retorno", profissional: "Dra. Íris Monteval", data: "13/10/2026", hora: "09:00" },
  { nome: "Dorival Quintanilha", telefone: "(11) 3000-0104", atendimento: "Ecocardiograma", profissional: "Dra. Íris Monteval", data: "13/10/2026", hora: "09:30" },
  { nome: "Estela Marinho Faria", telefone: "90000-0105", atendimento: "Holter 24h", profissional: "Dr. Caio Ventura", data: "13/10/2026", hora: "10:00" }, // ruim: sem DDD
  { nome: "Fausto Rezende Arcanjo", telefone: "(11) 90000-0106", atendimento: "Teste ergométrico", profissional: "Dr. Caio Ventura", data: "13/10/2026", hora: "10:30" },
  { nome: "Glória Tavares Nunes", telefone: "(11) 90000-0107", atendimento: "Consulta cardiologia", profissional: "Dra. Íris Monteval", data: "", hora: "11:00" }, // ruim: data vazia
  { nome: "Heitor Valadares", telefone: "(11) 90000-0108", atendimento: "MAPA", profissional: "Dra. Íris Monteval", data: "14/10/2026", hora: "08:00" },
  { nome: "Isadora Fontoura Reis", telefone: "(11) 90000-0109", atendimento: "Consulta cardiologia", profissional: "Dr. Caio Ventura", data: "14/10/2026", hora: "08:30" },
  { nome: "", telefone: "(11) 90000-0110", atendimento: "Eletrocardiograma", profissional: "Dr. Caio Ventura", data: "14/10/2026", hora: "09:00" }, // ruim: nome vazio
  { nome: "Joaquim Barreto Lins", telefone: "(11) 90000-0111", atendimento: "Consulta retorno", profissional: "Dra. Íris Monteval", data: "14/10/2026", hora: "09:30" },
  { nome: "Kátia Moreira Selva", telefone: "(11) 90000-0112", atendimento: "Ecocardiograma", profissional: "Dra. Íris Monteval", data: "14/10/2026", hora: "10:00" },
  { nome: "Lauro Castanheira", telefone: "(11) 90000-0113", atendimento: "Teste ergométrico", profissional: "Dr. Caio Ventura", data: "15/10/2026", hora: "14:00" },
  { nome: "Marina Ofélia Brandão", telefone: "(11) 90000-0114", atendimento: "Consulta cardiologia", profissional: "Dr. Caio Ventura", data: "15/10/2026", hora: "14:30" },
  { nome: "Nestor Albuquerque Paiva", telefone: "(11) 90000-0115", atendimento: "Holter 24h", profissional: "Dra. Íris Monteval", data: "15/10/2026", hora: "15:00" },
];

const B: Linha[] = [
  { nome: "OTÁVIO RIBAS FALCÃO", telefone: "21 90000-0201", atendimento: "ULTRASSOM ABDOME TOTAL", profissional: "DR. VICENTE AROUCA", data: "13/10/2026", hora: "07:30" },
  { nome: "PALOMA ESTEVES VIANA", telefone: "(21)90000-0202", atendimento: "MAMOGRAFIA", profissional: "DRA. LÍVIA SERRANO", data: "13/10/2026", hora: "07:50" },
  { nome: "QUITÉRIA MONTEIRO", telefone: "5521900000203", atendimento: "RAIO-X TÓRAX", profissional: "DR. VICENTE AROUCA", data: "13/10/2026", hora: "08:10" },
  { nome: "RAUL PEIXOTO DANTAS", telefone: "900000204", atendimento: "ULTRASSOM TIREOIDE", profissional: "DRA. LÍVIA SERRANO", data: "13/10/2026", hora: "08:30" }, // ruim: sem DDD
  { nome: "SABRINA CORDEIRO LEAL", telefone: "(21) 90000-0205", atendimento: "DENSITOMETRIA", profissional: "DR. VICENTE AROUCA", data: "13/10/2026", hora: "08:50" },
  { nome: "TEODORO ALMEIDA CRUZ", telefone: "(21) 90000-0206", atendimento: "TOMOGRAFIA CRÂNIO", profissional: "DRA. LÍVIA SERRANO", data: "13/10/2026", hora: "09:10" },
  { nome: "", telefone: "(21) 90000-0207", atendimento: "RAIO-X COLUNA", profissional: "DR. VICENTE AROUCA", data: "13/10/2026", hora: "09:30" }, // ruim: nome vazio
  { nome: "ÚRSULA NOGUEIRA", telefone: "(21) 2000-0208", atendimento: "ULTRASSOM PÉLVICO", profissional: "DRA. LÍVIA SERRANO", data: "14/10/2026", hora: "07:30" },
  { nome: "VALTER BRAGANÇA", telefone: "(21) 90000-0209", atendimento: "MAMOGRAFIA", profissional: "DRA. LÍVIA SERRANO", data: "14/10/2026", hora: "07:50" },
  { nome: "WANDA SIQUEIRA LOPES", telefone: "(21) 90000-0210", atendimento: "RESSONÂNCIA JOELHO", profissional: "DR. VICENTE AROUCA", data: "", hora: "" }, // ruim: data/hora vazia
  { nome: "XAVIER DOURADO", telefone: "(21) 90000-0211", atendimento: "ULTRASSOM ABDOME TOTAL", profissional: "DR. VICENTE AROUCA", data: "14/10/2026", hora: "08:30" },
  { nome: "YARA FERNANDES COUTO", telefone: "(21) 90000-0212", atendimento: "RAIO-X TÓRAX", profissional: "DRA. LÍVIA SERRANO", data: "14/10/2026", hora: "08:50" },
  { nome: "ZENO CAVALCANTE", telefone: "(21) 90000-0213", atendimento: "DENSITOMETRIA", profissional: "DR. VICENTE AROUCA", data: "14/10/2026", hora: "09:10" },
  { nome: "ALICE PORTELA GUSMÃO", telefone: "(21) 90000-0214", atendimento: "TOMOGRAFIA CRÂNIO", profissional: "DRA. LÍVIA SERRANO", data: "15/10/2026", hora: "13:00" },
  { nome: "BRUNO HERCULANO", telefone: "(21) 90000-0215", atendimento: "ULTRASSOM TIREOIDE", profissional: "DR. VICENTE AROUCA", data: "15/10/2026", hora: "13:20" },
];

const C: Linha[] = [
  { nome: "Cecília Andrade Moura", telefone: "31900000301", atendimento: "Limpeza de pele", profissional: "Rosana Dutra", data: "13/10/2026", hora: "9h00" },
  { nome: "Davi Lacerda Ramos", telefone: "31900000302", atendimento: "Drenagem linfática", profissional: "Rosana Dutra", data: "13/10/2026", hora: "9h45" },
  { nome: "Elisa Guaraná Pires", telefone: "3190000030", atendimento: "Peeling", profissional: "Tânia Bastos", data: "13/10/2026", hora: "10h30" }, // ruim: falta dígito (fixo inválido)
  { nome: "Fábio Ximenes", telefone: "31900000304", atendimento: "Consulta dermatologia", profissional: "Dra. Tânia Bastos", data: "13/10/2026", hora: "11h15" },
  { nome: "Gabriela Penteado", telefone: "31900000305", atendimento: "Limpeza de pele", profissional: "Rosana Dutra", data: "13/10/2026", hora: "14h00" },
  { nome: "", telefone: "31900000306", atendimento: "Drenagem linfática", profissional: "Rosana Dutra", data: "13/10/2026", hora: "14h45" }, // ruim: nome vazio
  { nome: "Hugo Medeiros Tolentino", telefone: "31900000307", atendimento: "Peeling", profissional: "Tânia Bastos", data: "14/10/2026", hora: "9h00" },
  { nome: "Ingrid Sá Rocha", telefone: "31900000308", atendimento: "Consulta dermatologia", profissional: "Dra. Tânia Bastos", data: "", hora: "9h45" }, // ruim: data vazia
  { nome: "Júlio Arantes", telefone: "31900000309", atendimento: "Limpeza de pele", profissional: "Rosana Dutra", data: "14/10/2026", hora: "10h30" },
  { nome: "Lívia Coutinho", telefone: "31900000310", atendimento: "Drenagem linfática", profissional: "Rosana Dutra", data: "14/10/2026", hora: "11h15" },
  { nome: "Murilo Saldanha", telefone: "31900000311", atendimento: "Peeling", profissional: "Tânia Bastos", data: "14/10/2026", hora: "14h00" },
  { nome: "Nádia Bezerra Frota", telefone: "31900000312", atendimento: "Consulta dermatologia", profissional: "Dra. Tânia Bastos", data: "15/10/2026", hora: "9h00" },
  { nome: "Orlando Vasconcelos", telefone: "31900000313", atendimento: "Limpeza de pele", profissional: "Rosana Dutra", data: "15/10/2026", hora: "9h45" },
  { nome: "Patrícia Queiroz", telefone: "31900000314", atendimento: "Peeling", profissional: "Tânia Bastos", data: "15/10/2026", hora: "10h30" },
  { nome: "Renato Galvão Lima", telefone: "31900000315", atendimento: "Drenagem linfática", profissional: "Rosana Dutra", data: "15/10/2026", hora: "11h15" },
];

const D: Omit<Linha, "data">[] = [
  { nome: "Silvana Prates Couto", telefone: "(41) 90000-0401", atendimento: "Consulta ortopedia", profissional: "Dr. Mauro Telles", hora: "08:00" },
  { nome: "Tarcísio Leme Barros", telefone: "(41) 90000-0402", atendimento: "Infiltração joelho", profissional: "Dr. Mauro Telles", hora: "08:20" },
  { nome: "Úrsula Damasceno", telefone: "(41) 3000-0403", atendimento: "Consulta retorno", profissional: "Dra. Helena Quaresma", hora: "08:40" },
  { nome: "Vinícius Ataíde", telefone: "90000-0404", atendimento: "Consulta ortopedia", profissional: "Dr. Mauro Telles", hora: "09:00" }, // ruim: sem DDD
  { nome: "Wesley Fagundes", telefone: "(41) 90000-0405", atendimento: "Raio-X punho", profissional: "Dra. Helena Quaresma", hora: "09:20" },
  { nome: "Ximena Caldas", telefone: "(41) 90000-0406", atendimento: "Consulta ortopedia", profissional: "Dr. Mauro Telles", hora: "09:40" },
  { nome: "", telefone: "(41) 90000-0407", atendimento: "Consulta retorno", profissional: "Dra. Helena Quaresma", hora: "10:00" }, // ruim: nome vazio
  { nome: "Yolanda Brito Sales", telefone: "(41) 90000-0408", atendimento: "Fisioterapia avaliação", profissional: "Dra. Helena Quaresma", hora: "10:20" },
  { nome: "Zacarias Mendonça", telefone: "(41) 90000-0409", atendimento: "Consulta ortopedia", profissional: "Dr. Mauro Telles", hora: "10:40" },
  { nome: "Adriana Lustosa", telefone: "(41) 90000-0410", atendimento: "Infiltração ombro", profissional: "Dr. Mauro Telles", hora: "" }, // ruim: hora vazia
  { nome: "Bernardo Tavora", telefone: "(41) 90000-0411", atendimento: "Consulta retorno", profissional: "Dra. Helena Quaresma", hora: "11:20" },
  { nome: "Camila Rangel Pinto", telefone: "(41) 90000-0412", atendimento: "Consulta ortopedia", profissional: "Dr. Mauro Telles", hora: "13:30" },
  { nome: "Diogo Sampaio", telefone: "(41) 90000-0413", atendimento: "Raio-X joelho", profissional: "Dra. Helena Quaresma", hora: "13:50" },
  { nome: "Eduarda Viveiros", telefone: "(41) 90000-0414", atendimento: "Consulta ortopedia", profissional: "Dr. Mauro Telles", hora: "14:10" },
  { nome: "Flávio Rocha Lemos", telefone: "(41) 90000-0415", atendimento: "Consulta retorno", profissional: "Dra. Helena Quaresma", hora: "14:30" },
];

/** dd/MM/yyyy → serial do Excel (dias desde 1899-12-30), sem fuso. */
function serialExcel(ddmmyyyy: string): number {
  const [d, m, y] = ddmmyyyy.split("/").map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

function gerarXlsxA(): Buffer {
  const aoa: (string | number)[][] = [["Paciente", "Celular", "Procedimento", "Médico", "Data", "Hora"]];
  for (const l of A) aoa.push([l.nome, l.telefone, l.atendimento, l.profissional, l.data ? serialExcel(l.data) : "", l.hora]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // coluna Data como célula de data (serial + formato), igual ao que os sistemas de clínica exportam
  for (let r = 1; r <= A.length; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 4 })];
    if (cell && cell.t === "n") cell.z = "dd/mm/yyyy";
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Agenda");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function csvCampo(v: string, sep: string): string {
  return v.includes(sep) || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v;
}

function gerarCsvB(): Buffer {
  const linhas = ["NOME DO PACIENTE;FONE;EXAME;PROFISSIONAL;DATA/HORA"];
  for (const l of B) {
    const dataHora = l.data ? `${l.data} ${l.hora}` : "";
    linhas.push([l.nome, l.telefone, l.atendimento, l.profissional, dataHora].map((v) => csvCampo(v, ";")).join(";"));
  }
  return Buffer.from("﻿" + linhas.join("\r\n") + "\r\n", "utf8");
}

function gerarCsvC(): Buffer {
  const linhas = ['"Cliente","Contato WhatsApp","Serviço","Responsável","Dia","Horário"'];
  for (const l of C) linhas.push([l.nome, l.telefone, l.atendimento, l.profissional, l.data, l.hora].map((v) => `"${v}"`).join(","));
  return Buffer.from(linhas.join("\n") + "\n", "utf8");
}

async function gerarPdfD(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fixa = new Date("2026-10-08T12:00:00Z");
  pdf.setTitle("Agenda do dia - Clínica Ortopédica Pinheiral (fictícia)");
  pdf.setCreationDate(fixa);
  pdf.setModificationDate(fixa);
  const page = pdf.addPage([595.28, 841.89]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const preto = rgb(0, 0, 0);
  let y = 800;
  page.drawText("Clínica Ortopédica Pinheiral", { x: 40, y, size: 16, font: bold, color: preto });
  y -= 18;
  page.drawText("Agenda do dia 13/10/2026 - Unidade Centro (dados fictícios)", { x: 40, y, size: 10, font, color: preto });
  y -= 28;
  const cols = [
    { titulo: "Hora", x: 40 },
    { titulo: "Paciente", x: 80 },
    { titulo: "Telefone", x: 230 },
    { titulo: "Atendimento", x: 330 },
    { titulo: "Profissional", x: 455 },
  ];
  for (const c of cols) page.drawText(c.titulo, { x: c.x, y, size: 9, font: bold, color: preto });
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.5, color: preto });
  y -= 14;
  for (const l of D) {
    const valores = [l.hora, l.nome, l.telefone, l.atendimento, l.profissional];
    valores.forEach((v, i) => { if (v) page.drawText(v, { x: cols[i].x, y, size: 8, font, color: preto }); });
    y -= 16;
  }
  y -= 10;
  page.drawText(`Total de agendamentos: ${D.length}`, { x: 40, y, size: 9, font, color: preto });
  return pdf.save({ useObjectStreams: false });
}

async function main() {
  mkdirSync(DESTINO, { recursive: true });
  writeFileSync(path.join(DESTINO, "agenda-clinica-a.xlsx"), gerarXlsxA());
  writeFileSync(path.join(DESTINO, "agenda-clinica-b.csv"), gerarCsvB());
  writeFileSync(path.join(DESTINO, "agenda-clinica-c.csv"), gerarCsvC());
  writeFileSync(path.join(DESTINO, "agenda-clinica-d.pdf"), await gerarPdfD());
  console.log(`Exemplos gerados em ${DESTINO}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
