export type Tom = "cinza" | "azul" | "verde" | "amarelo" | "vermelho";

export const CLASSES_TOM: Record<Tom, string> = {
  cinza: "bg-gray-100 text-gray-700",
  azul: "bg-blue-100 text-blue-800",
  verde: "bg-green-100 text-green-800",
  amarelo: "bg-amber-100 text-amber-800",
  vermelho: "bg-red-100 text-red-800",
};

type Info = { rotulo: string; tom: Tom };

const LOTE: Record<string, Info> = {
  importado: { rotulo: "Importado", tom: "cinza" },
  conferido: { rotulo: "Conferido", tom: "azul" },
  enviando: { rotulo: "Enviando…", tom: "amarelo" },
  concluido: { rotulo: "Concluído", tom: "verde" },
};
const AGENDAMENTO: Record<string, Info> = {
  inserido: { rotulo: "Aguardando envio", tom: "cinza" },
  enviado: { rotulo: "Enviado", tom: "azul" },
  respondido: { rotulo: "Respondido", tom: "azul" },
  confirmado: { rotulo: "Confirmado", tom: "verde" },
  cancelado: { rotulo: "Cancelado", tom: "vermelho" },
  sem_resposta: { rotulo: "Sem resposta", tom: "amarelo" },
  nao_sou_eu: { rotulo: "Não é o paciente", tom: "amarelo" },
  excecao: { rotulo: "Precisa de atenção", tom: "amarelo" },
};
const MENSAGEM: Record<string, Info> = {
  pendente: { rotulo: "Pendente", tom: "cinza" },
  enviada: { rotulo: "Enviada", tom: "azul" },
  entregue: { rotulo: "Entregue", tom: "azul" },
  lida: { rotulo: "Lida", tom: "verde" },
  falhou: { rotulo: "Falhou", tom: "vermelho" },
};

const pegar = (m: Record<string, Info>, k: string): Info => m[k] ?? { rotulo: k, tom: "cinza" };
export const infoLote = (s: string) => pegar(LOTE, s);
export const infoAgendamento = (s: string) => pegar(AGENDAMENTO, s);
export const infoMensagem = (s: string) => pegar(MENSAGEM, s);

const ERROS_MENSAGEM: Record<number, string> = {
  130497: "Conta Meta ainda não verificada",
  131026: "Número sem WhatsApp ou mensagem não entregável",
  131047: "Fora da janela de 24 horas",
  131049: "A Meta bloqueou o envio para este número",
};

export function explicarErro(codigo: number | null, mensagem: string | null): string | null {
  if (codigo == null && !mensagem) return null;
  const texto = (codigo != null && ERROS_MENSAGEM[codigo]) || mensagem || "Erro no envio";
  return codigo != null ? `${texto} (código ${codigo})` : texto;
}

export function podeEnviar(status: string, inseridos: number, travado = false): boolean {
  return (status === "importado" || status === "conferido" || status === "concluido" || (status === "enviando" && travado)) && inseridos > 0;
}

export function textoBotaoEnviar(status: string): string {
  if (status === "enviando") return "Reenviar pendentes";
  return status === "concluido" ? "Reenviar pendentes" : "Enviar confirmações";
}

export const INTERVALO_RAPIDO_MS = 3000;
export const INTERVALO_LENTO_MS = 10000;

/** Intervalo de atualização da tela, ou null quando não há mais o que acompanhar. */
export function intervaloPolling(status: string, mensagens: (string | null)[]): number | null {
  if (status === "enviando") return INTERVALO_RAPIDO_MS;
  return mensagens.some((m) => m === "enviada" || m === "pendente") ? INTERVALO_LENTO_MS : null;
}

export const DICA_PENDENTE = "Aguardando envio; se persistir, contate o suporte";
