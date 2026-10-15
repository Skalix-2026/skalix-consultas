/**
 * Lote em "enviando" há mais que isso é considerado travado (a função Inngest morreu ou o evento se perdeu).
 * Compartilhado entre a rota de envio (decide) e a Central de Envios (habilita "Reenviar pendentes").
 */
export const ENVIO_PARADO_MS = 10 * 60 * 1000;

/** `enviandoDesde` ausente (dado antigo) em "enviando" também conta como travado. */
export function envioTravado(
  status: string,
  enviandoDesde: Date | string | null | undefined,
  agoraMs: number = Date.now(),
): boolean {
  if (status !== "enviando") return false;
  if (!enviandoDesde) return true;
  const desde = new Date(enviandoDesde).getTime();
  return Number.isNaN(desde) || agoraMs - desde > ENVIO_PARADO_MS;
}
