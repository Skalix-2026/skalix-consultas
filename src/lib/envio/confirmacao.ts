import { mask, mascararNumerosNoTexto, type Sender } from "@/lib/whatsapp";
import { offsetDoFuso } from "@/lib/importacao/normalizar";

/**
 * Envio da confirmação de um agendamento. Lógica pura com dependências injetadas
 * (banco e Sender), para testar idempotência e falhas sem banco nem Meta.
 * Só é chamada de dentro de uma função Inngest.
 */

export type AgendamentoEnvio = {
  id: string; nome: string; telefone: string; atendimento: string; profissional: string | null; dataHora: Date;
};

export type DepsEnvio = {
  sender: Sender;
  /**
   * INSERT ... ON CONFLICT DO NOTHING RETURNING: id se reservou, null se já existia.
   * Com `reabrirFalhasAntesDe` (reenvio manual), uma mensagem `falhou` SEM wamid e com `atualizadaEm` anterior
   * a esse instante é reaberta atomicamente (volta a `pendente`) e o id dela é devolvido.
   */
  reservarMensagem(agendamentoId: string, tipo: "confirmacao", opcoes?: OpcoesReserva): Promise<string | null>;
  marcarMensagemEnviada(id: string, d: { wamid: string; corpo: string }): Promise<void>;
  marcarMensagemFalhou(id: string, d: { erroCodigo: number | null; erroMensagem: string }): Promise<void>;
  marcarAgendamentoEnviado(agendamentoId: string): Promise<void>;
  /** Espera entre tentativas de gravar o wamid (injetável em testes). */
  esperar?: (ms: number) => Promise<void>;
};

export type OpcoesReserva = { reabrirFalhasAntesDe?: Date };

export type ResultadoEnvio = "enviada" | "pulada" | "falhou";

export function primeiroNome(nome: string): string {
  const p = nome.trim().split(/\s+/)[0] ?? "";
  return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : "";
}

/** "terça-feira, 14/10/2026 às 14:30" no fuso da clínica. */
export function formatarDataHora(d: Date, fuso: string): string {
  const data = new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(d);
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${data} às ${hora}`;
}

/** Texto livre de confirmação (janela de 24 h; decisão 2026-10-02). Não é template da Meta. */
export function montarTextoConfirmacao(ag: AgendamentoEnvio, fuso: string): string {
  const com = ag.profissional ? ` com ${ag.profissional}` : "";
  return (
    `Olá, ${primeiroNome(ag.nome)}! Aqui é da clínica. Passando para confirmar seu atendimento: ` +
    `${ag.atendimento}${com}, ${formatarDataHora(ag.dataHora, fuso)}.\n\n` +
    `Você confirma? Responda SIM para confirmar ou NÃO para cancelar.`
  );
}

/** Token da clínica: `process.env[token_ref]`, com fallback para WHATSAPP_TOKEN. */
export function resolverToken(tokenRef: string | null, env: Record<string, string | undefined> = process.env): string | undefined {
  return (tokenRef ? env[tokenRef] : undefined) || env.WHATSAPP_TOKEN || undefined;
}

function codigoDoErro(e: unknown): number | null {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "number" ? c : null;
}

/**
 * Reserva → envia → registra. Nunca lança por falha de envio (o lote segue).
 * "pulada": a reserva já existia (reenvio do Inngest, outro disparo do lote) — nada é enviado.
 * Se o processo morrer entre reservar e enviar, a mensagem fica "pendente"; a rotina `recuperar-pendentes`
 * a marca "falhou" após 15 min e ela só volta a ser enviada por reenvio manual (`reabrirFalhasAntesDe`),
 * e apenas se não tiver wamid (preferimos não enviar a enviar duas vezes).
 */
export async function enviarConfirmacao(
  deps: DepsEnvio,
  ag: AgendamentoEnvio,
  clinica: { phoneNumberId: string; fuso: string },
  token: string,
  opcoes: OpcoesReserva = {},
): Promise<ResultadoEnvio> {
  const mensagemId = await deps.reservarMensagem(ag.id, "confirmacao", opcoes);
  if (!mensagemId) return "pulada";

  const corpo = montarTextoConfirmacao(ag, clinica.fuso);
  let wamid: string;
  try {
    ({ wamid } = await deps.sender.sendText({ phoneNumberId: clinica.phoneNumberId, token, to: ag.telefone }, corpo));
  } catch (e) {
    const erroCodigo = codigoDoErro(e);
    // a mensagem do erro da Meta pode citar o número: mascarar antes de gravar/logar
    const erroMensagem = mascararNumerosNoTexto((e as Error)?.message ?? "erro desconhecido");
    console.error("[envio] falhou", { agendamentoId: ag.id, para: mask(ag.telefone), erroCodigo });
    try {
      await deps.marcarMensagemFalhou(mensagemId, { erroCodigo, erroMensagem });
    } catch (e2) {
      console.error("[envio] não gravou a falha", { agendamentoId: ag.id, erro: (e2 as Error).name });
    }
    return "falhou";
  }

  // A mensagem JÁ foi enviada: o wamid é a chave dos status do webhook, então a gravação tem retry curto.
  // Se ainda assim falhar, o wamid vai para o log (id técnico) para reconciliação manual; nunca reenviar.
  const gravado = await comRetry(async () => {
    await deps.marcarMensagemEnviada(mensagemId, { wamid, corpo });
    await deps.marcarAgendamentoEnviado(ag.id);
  }, deps.esperar);
  if (!gravado) console.error("[envio] enviada mas NÃO gravou o wamid", { agendamentoId: ag.id, mensagemId, wamid });
  return "enviada";
}

/** 3 tentativas com espera crescente (200 ms, 600 ms). */
async function comRetry(fn: () => Promise<void>, esperar: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    try { await fn(); return true; }
    catch { if (i < 2) await esperar(200 * 3 ** i); }
  }
  return false;
}

export type ResumoLote = { enviadas: number; puladas: number; falhas: number };

/** Processa um bloco em sequência; um erro inesperado em um agendamento não impede os demais. */
export async function enviarBloco(
  deps: DepsEnvio,
  bloco: AgendamentoEnvio[],
  clinica: { phoneNumberId: string; fuso: string },
  token: string,
  opcoes: OpcoesReserva = {},
): Promise<ResumoLote> {
  const r: ResumoLote = { enviadas: 0, puladas: 0, falhas: 0 };
  for (const ag of bloco) {
    try {
      const res = await enviarConfirmacao(deps, ag, clinica, token, opcoes);
      if (res === "enviada") r.enviadas++;
      else if (res === "pulada") r.puladas++;
      else r.falhas++;
    } catch (e) {
      r.falhas++;
      console.error("[envio] erro inesperado", { agendamentoId: ag.id, erro: (e as Error).name });
    }
  }
  return r;
}

/** Intervalo [de, ate) do dia `yyyy-MM-dd` no fuso da clínica. */
export function intervaloDoDia(data: string, fuso: string) {
  const [y, m, d] = data.split("-").map(Number);
  const inicio = new Date(`${data}T00:00:00${offsetDoFuso(fuso, { y, m, d }, { hh: 0, mm: 0 })}`);
  const prox = new Date(Date.UTC(y, m - 1, d + 1));
  const [y2, m2, d2] = [prox.getUTCFullYear(), prox.getUTCMonth() + 1, prox.getUTCDate()];
  const p = (n: number) => String(n).padStart(2, "0");
  const fim = new Date(`${y2}-${p(m2)}-${p(d2)}T00:00:00${offsetDoFuso(fuso, { y: y2, m: m2, d: d2 }, { hh: 0, mm: 0 })}`);
  return { de: inicio, ate: fim };
}
