export type ErroApi = { ok: false; erro: string; mensagem: string };

/** Agendamentos do lote por status (só os status presentes vêm no objeto). */
export type Contagem = Record<string, number>;
export type StatusLote = "importado" | "conferido" | "enviando" | "concluido";
export type Lote = {
  id: string;
  arquivoNome: string;
  criadoEm: string;
  status: StatusLote;
  totalLinhas: number;
  linhasValidas: number;
  contagens: Contagem;
};
export type Agendamento = {
  id: string;
  nome: string;
  telefone: string;
  atendimento: string;
  profissional: string | null;
  dataHora: string;
  status: string;
  mensagemStatus: "pendente" | "enviada" | "entregue" | "lida" | "falhou" | null;
  erroCodigo: number | null;
  erroMensagem: string | null;
};
export type LinhaInvalida = { linha: number; motivo: string; bruto: Record<string, string> };
export type ResultadoImportacao = {
  ok: true;
  loteId: string;
  reaproveitado: boolean;
  totalLinhas: number;
  validas: number;
  duplicadas: number;
  invalidas: LinhaInvalida[];
  avisos: string[];
};

const MSG_GENERICA = "Algo deu errado. Tente novamente em instantes.";

/** Erro da API que carrega os detalhes de triagem (ex.: 422 nenhuma_linha_valida). */
export class ErroApiDetalhado extends Error {
  constructor(
    mensagem: string,
    public readonly codigo: string,
    public readonly invalidas: LinhaInvalida[],
    public readonly avisos: string[],
  ) {
    super(mensagem);
    this.name = "ErroApiDetalhado";
  }
}

/** Chama a API e devolve o corpo ou lança Error com mensagem amigável. */
export async function chamarApi<T extends { ok: true }>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Falha de conexão. Verifique a internet e tente novamente.");
  }
  let corpo: unknown;
  try {
    corpo = await res.json();
  } catch {
    throw new Error(MSG_GENERICA);
  }
  const c = corpo as T | ErroApi | null;
  if (!res.ok || !c || c.ok !== true) {
    const e = c as (ErroApi & { invalidas?: LinhaInvalida[]; avisos?: string[] }) | null;
    const msg = e?.mensagem || MSG_GENERICA;
    if (e && (Array.isArray(e.invalidas) || Array.isArray(e.avisos))) {
      throw new ErroApiDetalhado(msg, e.erro, e.invalidas ?? [], e.avisos ?? []);
    }
    throw new Error(msg);
  }
  return c;
}
