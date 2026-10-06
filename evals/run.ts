import "dotenv/config";
import { readFileSync } from "node:fs";
import { classificarResposta } from "../src/ai/harness/classificar-resposta";

/**
 * Roda os casos de evals/respostas.jsonl contra o harness e imprime o acerto.
 * Meta: >= 97% em confirmou/cancelou; >= 90% no geral.
 */
type Caso = { texto: string; esperado: string };
const casos: Caso[] = readFileSync("evals/respostas.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));

const base = { primeiroNome: "Maria", atendimento: "exame de Ultrassonografia", dataHoraLegivel: "seg, 31 ago, 14:12", clinicaNome: "Clínica Aurora" };

let ok = 0, okCore = 0, totalCore = 0;
const erros: string[] = [];
for (const c of casos) {
  const r = await classificarResposta({ ...base, textoPaciente: c.texto });
  const acertou = r.intencao === c.esperado;
  if (acertou) ok++;
  if (c.esperado === "confirmou" || c.esperado === "cancelou") { totalCore++; if (acertou) okCore++; }
  if (!acertou) erros.push(`"${c.texto}" → esperado ${c.esperado}, veio ${r.intencao} (conf ${r.confianca})`);
}
console.log(`Geral: ${ok}/${casos.length} (${((ok / casos.length) * 100).toFixed(1)}%)`);
console.log(`Confirmou/cancelou: ${okCore}/${totalCore} (${((okCore / totalCore) * 100).toFixed(1)}%)`);
if (erros.length) console.log("\nErros:\n- " + erros.join("\n- "));
const meta = okCore / totalCore >= 0.97;
process.exit(meta ? 0 : 1);
