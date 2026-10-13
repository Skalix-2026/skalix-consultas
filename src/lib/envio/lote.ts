import { NonRetriableError } from "inngest";
import { enviarBloco, intervaloDoDia, resolverToken, type AgendamentoEnvio, type DepsEnvio, type ResumoLote } from "./confirmacao";

/**
 * Orquestração do envio de um lote, desacoplada do Inngest/banco para ser testável:
 * `step` só precisa de run/sleep e as consultas entram por `DepsLote`.
 *
 * LGPD: os `step.run` devolvem só ids e contagens — o estado dos steps fica guardado no Inngest,
 * então nome/telefone são lidos de novo do banco dentro de cada bloco e nunca saem dele.
 */

export const TAMANHO_BLOCO = 10;
export const PAUSA_ENTRE_BLOCOS = "2s";

export type StepLike = {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  sleep(id: string, duration: string): Promise<unknown>;
};

export type ClinicaEnvio = { phoneNumberId: string; fuso: string; tokenRef: string | null };

export type DepsLote = DepsEnvio & {
  agora(): Date;
  carregarClinicaDoLote(loteId: string): Promise<ClinicaEnvio | null>;
  /** Só ids: inserido + futuro (+ dia, se informado). */
  listarIdsParaEnvio(loteId: string, filtro: { agora: Date; de?: Date; ate?: Date }): Promise<string[]>;
  /** Dados de contato por ids, já filtrados (inserido + futuro). */
  carregarAgendamentos(ids: string[], agora: Date): Promise<AgendamentoEnvio[]>;
  definirStatusLote(loteId: string, status: "importado" | "concluido"): Promise<void>;
  env?: Record<string, string | undefined>;
};

export type ResultadoLote = ResumoLote & { total: number };

/** Configuração faltando não se resolve com retry. */
export class EnvioNaoConfiguradoError extends NonRetriableError {
  constructor(msg: string) { super(msg); this.name = "EnvioNaoConfiguradoError"; }
}

export async function rodarEnviarLote(
  step: StepLike,
  entrada: { loteId: string; data?: string },
  deps: DepsLote,
): Promise<ResultadoLote> {
  const env = deps.env ?? process.env;

  const plano = await step.run("planejar", async () => {
    const clinica = await deps.carregarClinicaDoLote(entrada.loteId);
    if (!clinica) throw new EnvioNaoConfiguradoError("lote ou clínica não encontrados");
    const token = env.WHATSAPP_FAKE === "1" ? "fake" : resolverToken(clinica.tokenRef, env);
    if (!token) {
      // configuração faltando não se resolve com retry: devolve o lote ao status anterior e falha
      await deps.definirStatusLote(entrada.loteId, "importado");
      throw new EnvioNaoConfiguradoError("token do WhatsApp não configurado (token_ref / WHATSAPP_TOKEN)");
    }
    const agora = deps.agora();
    const intervalo = entrada.data ? intervaloDoDia(entrada.data, clinica.fuso) : {};
    const ids = await deps.listarIdsParaEnvio(entrada.loteId, { agora, ...intervalo });
    return { ids };
  });

  const total: ResultadoLote = { enviadas: 0, puladas: 0, falhas: 0, total: plano.ids.length };

  for (let i = 0; i * TAMANHO_BLOCO < plano.ids.length; i++) {
    const ids = plano.ids.slice(i * TAMANHO_BLOCO, (i + 1) * TAMANHO_BLOCO);
    if (i > 0) await step.sleep(`pausa-${i}`, PAUSA_ENTRE_BLOCOS);
    const r = await step.run(`bloco-${i}`, async () => {
      const clinica = await deps.carregarClinicaDoLote(entrada.loteId);
      if (!clinica) throw new EnvioNaoConfiguradoError("lote ou clínica não encontrados");
      const token = env.WHATSAPP_FAKE === "1" ? "fake" : resolverToken(clinica.tokenRef, env)!;
      const ags = await deps.carregarAgendamentos(ids, deps.agora());
      return enviarBloco(deps, ags, clinica, token);
    });
    total.enviadas += r.enviadas;
    total.puladas += r.puladas;
    total.falhas += r.falhas;
  }

  await step.run("concluir", () => deps.definirStatusLote(entrada.loteId, "concluido"));
  console.log("[inngest] lote concluído", { loteId: entrada.loteId, ...total });
  return total;
}
