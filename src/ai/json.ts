import type Anthropic from "@anthropic-ai/sdk";

/** Texto do primeiro bloco `text` da resposta. */
export function textoDaResposta(res: Anthropic.Message): string {
  const bloco = res.content.find((c) => c.type === "text");
  return bloco && bloco.type === "text" ? bloco.text : "";
}

/** Extrai o objeto JSON entre a primeira `{` e a última `}`. Erro explícito se não houver JSON válido. */
export function extrairJson(texto: string, tarefa: string): unknown {
  const ini = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (ini < 0 || fim <= ini) throw new Error(`${tarefa}: a IA não retornou JSON`);
  try {
    return JSON.parse(texto.slice(ini, fim + 1));
  } catch {
    throw new Error(`${tarefa}: a IA retornou JSON malformado`);
  }
}
