import type { ConversaResumo, ErroAcao } from "@/lib/schemas-conversas";

/** Lógica pura da tela /conversas (sem React), para ser testada à parte. */

export const LIMITE_TEXTO = 1000;
export const INTERVALO_LISTA_MS = 15000;

export const AVISO_FORA_DA_JANELA =
  "Fora da janela de 24 h do WhatsApp: só é possível enviar por template após a verificação da empresa.";

const MSG_ERRO_ACAO: Record<ErroAcao, string> = {
  id_invalido: "Conversa inválida. Atualize a página.",
  entrada_invalida: "Confira os dados e tente de novo.",
  clinica_nao_configurada: "A clínica ainda não está configurada. Fale com o suporte.",
  paciente_nao_encontrado: "Paciente não encontrado. Atualize a lista.",
  agendamento_nao_encontrado: "Agendamento não encontrado. Atualize a conversa.",
  agendamento_de_outro_paciente: "Este agendamento não pertence a este paciente.",
  sem_agendamento: "Este paciente não tem agendamento para receber a mensagem.",
  fora_da_janela: AVISO_FORA_DA_JANELA,
  envio_nao_configurado: "O envio por WhatsApp ainda não está configurado.",
  envio_falhou: "Não foi possível enviar a mensagem agora. Tente de novo em instantes.",
  erro_interno: "Algo deu errado. Tente novamente em instantes.",
};

/** Mensagem amigável para o código de erro devolvido pela ação; cai na mensagem da API se o código for desconhecido. */
export function mensagemErroAcao(codigo: string | undefined, mensagemApi?: string): string {
  if (codigo && codigo in MSG_ERRO_ACAO) return MSG_ERRO_ACAO[codigo as ErroAcao];
  return mensagemApi || MSG_ERRO_ACAO.erro_interno;
}

/** Horário relativo curto ("agora", "há 5 min", "há 3 h", "ontem", "há 4 dias", ou data). */
export function horarioRelativo(iso: string, agora: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const seg = Math.max(0, Math.floor((agora.getTime() - d.getTime()) / 1000));
  if (seg < 60) return "agora";
  const min = Math.floor(seg / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.floor(h / 24);
  if (dias === 1) return "ontem";
  if (dias < 7) return `há ${dias} dias`;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(d);
}

type AgFoco = { id: string; dataHora: string; status: string };

/**
 * Agendamento padrão da conversa: o "em foco" da lista, se ainda existir; senão o primeiro em exceção;
 * senão o próximo futuro; senão o mais recente.
 */
export function agendamentoPadrao<T extends AgFoco>(ags: T[], focoId?: string | null, agora: Date = new Date()): T | null {
  if (ags.length === 0) return null;
  const foco = focoId ? ags.find((a) => a.id === focoId) : undefined;
  if (foco) return foco;
  const exc = ags.find((a) => a.status === "excecao");
  if (exc) return exc;
  const ord = [...ags].sort((a, b) => new Date(a.dataHora).getTime() - new Date(b.dataHora).getTime());
  return ord.find((a) => new Date(a.dataHora).getTime() >= agora.getTime()) ?? ord[ord.length - 1];
}

/** Ordena exceções primeiro (estável: mantém a ordem da API dentro de cada grupo). */
export function ordenarConversas(lista: ConversaResumo[], excecoesPrimeiro: boolean): ConversaResumo[] {
  if (!excecoesPrimeiro) return lista;
  return [...lista.filter((c) => c.temExcecao), ...lista.filter((c) => !c.temExcecao)];
}

export const contarExcecoes = (lista: ConversaResumo[]) => lista.filter((c) => c.temExcecao).length;

export function textoValido(texto: string): boolean {
  const t = texto.trim();
  return t.length >= 1 && t.length <= LIMITE_TEXTO;
}

const INTENCAO: Record<string, string> = {
  confirmou: "Confirmou",
  cancelou: "Cancelou",
  quer_remarcar: "Quer remarcar",
  duvida: "Dúvida",
  nao_sou_eu: "Não é o paciente",
  fora_de_escopo: "Fora do assunto",
};

export const rotuloIntencao = (i: string) => INTENCAO[i] ?? i;
export const percentual = (c: number) => `${Math.round(Math.min(1, Math.max(0, c)) * 100)}%`;

/** Marcador gravado pela rotina de retenção de 90 dias (`TEXTO_REMOVIDO` em src/lib/resposta/retencao.ts). */
export const ehTextoRemovido = (texto: string) => texto === "[removido]";
