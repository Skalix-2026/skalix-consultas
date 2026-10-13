import { z } from "zod";
import { Langfuse } from "langfuse";
import { MODELO_CLASSIFICACAO, MODELO_EXTRACAO_PDF, MODELO_MAPEAMENTO } from "./modelos";

/**
 * Registro de custo de toda chamada de IA.
 * Envia ao Langfuse só se LANGFUSE_PUBLIC_KEY e LANGFUSE_SECRET_KEY existirem; senão faz console.log.
 * NUNCA passar dados pessoais aqui: só tarefa, modelo, contagem de tokens e metadados técnicos
 * (ex.: agendamento_id, lote_id). Falha de registro nunca derruba o harness.
 */

/** US$ por milhão de tokens (entrada / saída). */
const PRECOS: Record<string, { entrada: number; saida: number }> = {
  "claude-haiku-4-5": { entrada: 1, saida: 5 },
  "claude-sonnet-4-6": { entrada: 3, saida: 15 },
};
// Garante que todo modelo em uso tem preço cadastrado (falha de import em teste se esquecer).
for (const m of [MODELO_CLASSIFICACAO, MODELO_MAPEAMENTO, MODELO_EXTRACAO_PDF]) {
  if (!PRECOS[m]) throw new Error(`custo.ts: modelo sem preço cadastrado: ${m}`);
}

export type UsoTokens = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/**
 * Metadados permitidos no Langfuse: chaves FECHADAS, só identificadores técnicos.
 * Nunca nome, telefone ou texto do paciente. Inválido → descartado com aviso (sem o valor), nunca derruba o harness.
 */
export const Metadados = z
  .object({
    lote_id: z.uuid().optional(),
    agendamento_id: z.uuid().optional(),
    clinica_id: z.uuid().optional(),
    linhas_estimadas: z.number().int().nonnegative().optional(),
  })
  .strict();
export type Metadados = z.infer<typeof Metadados>;

export type RegistroUso = {
  tarefa: string;
  modelo: string;
  usage: UsoTokens;
  metadados?: Metadados;
};

/** Valida os metadados; se inválidos, descarta TODOS e loga só os códigos do erro (nunca valores nem chaves desconhecidas). */
export function metadadosSeguros(tarefa: string, metadados: unknown): Metadados {
  if (metadados === undefined) return {};
  const r = Metadados.safeParse(metadados);
  if (r.success) return r.data;
  const codigos = [...new Set(r.error.issues.map((i) => i.code))].join(", ");
  console.warn(`[ia] ${tarefa}: metadados inválidos descartados (${codigos})`);
  return {};
}

/** Custo em US$. Cache write = 1,25x entrada; cache read = 0,1x entrada. `null` se o modelo não tem preço. */
export function calcularCustoUsd(modelo: string, usage: UsoTokens): { entrada: number; saida: number; total: number } | null {
  const p = PRECOS[modelo];
  if (!p) return null;
  const tokensEntrada =
    usage.input_tokens + 1.25 * (usage.cache_creation_input_tokens ?? 0) + 0.1 * (usage.cache_read_input_tokens ?? 0);
  const entrada = (tokensEntrada * p.entrada) / 1_000_000;
  const saida = (usage.output_tokens * p.saida) / 1_000_000;
  return { entrada, saida, total: entrada + saida };
}

let langfuse: Langfuse | null | undefined;
function clienteLangfuse(): Langfuse | null {
  if (langfuse !== undefined) return langfuse;
  const { LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST } = process.env;
  langfuse =
    LANGFUSE_PUBLIC_KEY && LANGFUSE_SECRET_KEY
      ? new Langfuse({ publicKey: LANGFUSE_PUBLIC_KEY, secretKey: LANGFUSE_SECRET_KEY, baseUrl: LANGFUSE_HOST || undefined })
      : null;
  return langfuse;
}

export async function registrarUso({ tarefa, modelo, usage, metadados }: RegistroUso): Promise<void> {
  const custo = calcularCustoUsd(modelo, usage);
  try {
    const meta = metadadosSeguros(tarefa, metadados);
    const lf = clienteLangfuse();
    if (!lf) {
      console.log(
        `[ia] ${tarefa} ${modelo} in=${usage.input_tokens} out=${usage.output_tokens} ` +
          `usd=${custo ? custo.total.toFixed(6) : "?"}`,
      );
      return;
    }
    lf.generation({
      name: tarefa,
      model: modelo,
      usageDetails: { input: usage.input_tokens, output: usage.output_tokens },
      costDetails: custo ?? undefined,
      metadata: { tarefa, ...meta },
    });
    await lf.flushAsync(); // serverless: não deixar evento pendente no fim da função
  } catch (err) {
    console.warn(`[ia] falha ao registrar uso de ${tarefa}: ${(err as Error).message}`);
  }
}
