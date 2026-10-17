/**
 * Recuperação de mensagens "pendentes" por crash (reservadas, sem confirmação do envio).
 * `mensagens.atualizada_em` nasce com now() na reserva (`reservarMensagem`) e só muda depois, ao enviar/falhar.
 */
export const PENDENTE_VENCE_MS = 15 * 60 * 1000;

/** Texto fixo gravado em `erro_mensagem`: nunca inclui dados de paciente. */
export const ERRO_PENDENTE_VENCIDA = "Envio interrompido (sem confirmação); reenvio manual";

/** Verdadeiro se a reserva tem mais de 15 min (exatamente 15 ainda não vence). */
export function pendenteVencida(atualizadaEm: Date | string, agora: Date): boolean {
  const t = new Date(atualizadaEm).getTime();
  return !Number.isNaN(t) && agora.getTime() - t > PENDENTE_VENCE_MS;
}

export type DepsRecuperar = {
  agora(): Date;
  /** UPDATE único ... WHERE status='pendente' AND atualizada_em < corte; devolve a contagem. */
  marcarVencidas(corte: Date, erroMensagem: string): Promise<number>;
};

/** Marca como `falhou` as pendentes vencidas e devolve só a contagem (o log também só tem a contagem). */
export async function rodarRecuperarPendentes(deps: DepsRecuperar): Promise<{ recuperadas: number }> {
  const corte = new Date(deps.agora().getTime() - PENDENTE_VENCE_MS);
  const recuperadas = await deps.marcarVencidas(corte, ERRO_PENDENTE_VENCIDA);
  if (recuperadas > 0) console.log("[inngest] pendentes vencidas marcadas como falhou", { recuperadas });
  return { recuperadas };
}
