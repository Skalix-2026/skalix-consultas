/**
 * Retenção LGPD (90 dias), dois alvos:
 * - `respostas`: `texto` vira o literal "[removido]" (NOT NULL; inclui o texto digitado pela recepção) e o `motivo`
 *   escrito pelo modelo (pode citar o paciente) vira NULL SÓ nas respostas de `origem='paciente'`. Nas ações humanas o
 *   motivo é um rótulo técnico ("acao:responder", ...) que a UI usa e sobrevive. Ficam intenção, confiança, datas, origem.
 * - `eventos_webhook`: `payload` (JSON bruto do WhatsApp, com texto e telefone completo) vira {"anonimizado":true}
 *   (NOT NULL). Ficam id, recebido_em, processado_em e erro.
 * Eventos com mais de 90 dias NÃO são reprocessados: nenhum código lê `payload` depois da gravação (o webhook só
 * grava e enfileira o evento Inngest com os dados extraídos; `marcarEventoProcessado`/`marcarEventoComErro` só
 * escrevem processado_em/erro). Um reprocesso manual futuro deve ignorar payload anonimizado.
 */
export const RETENCAO_RESPOSTAS_DIAS = 90;
export const TEXTO_REMOVIDO = "[removido]";

const DIA_MS = 24 * 60 * 60 * 1000;

/** Verdadeiro se a resposta tem MAIS de 90 dias (exatamente 90 ainda não vence). */
export function respostaVencida(recebidaEm: Date | string, agora: Date): boolean {
  const t = new Date(recebidaEm).getTime();
  return !Number.isNaN(t) && agora.getTime() - t > RETENCAO_RESPOSTAS_DIAS * DIA_MS;
}

export type DepsAnonimizar = {
  agora(): Date;
  /** UPDATE único em respostas (recebida_em < corte, ainda não anonimizadas); devolve a contagem. */
  anonimizarAnterioresA(corte: Date): Promise<number>;
  /** UPDATE único em eventos_webhook (recebido_em < corte, payload ainda não anonimizado); devolve a contagem. */
  anonimizarEventosAnterioresA(corte: Date): Promise<number>;
};

/** Anonimiza respostas e eventos vencidos; devolve e loga só as duas contagens. */
export async function rodarAnonimizarRespostas(deps: DepsAnonimizar): Promise<{ respostas: number; eventos: number }> {
  const corte = new Date(deps.agora().getTime() - RETENCAO_RESPOSTAS_DIAS * DIA_MS);
  const respostas = await deps.anonimizarAnterioresA(corte);
  const eventos = await deps.anonimizarEventosAnterioresA(corte);
  if (respostas > 0 || eventos > 0) console.log("[inngest] retenção: anonimizados", { respostas, eventos });
  return { respostas, eventos };
}
