import { LIMIAR_CONFIANCA, type Entrada as EntradaClassificacao, type Saida } from "@/ai/harness/classificar-resposta";
import { mask, mascararNumerosNoTexto, type Sender } from "@/lib/whatsapp";
import { variantesTelefone } from "@/lib/telefone";
import { formatarDataHora, resolverToken } from "@/lib/envio/confirmacao";
import type { StepLike } from "@/lib/envio/lote";
import { textoResposta } from "@/lib/resposta/textos";
import { montarContexto, type ContextoClinica, type LinhaConhecimento, type RegrasClinica } from "@/ai/rag/contexto-clinica";

/**
 * Resposta do paciente → status do agendamento. Lógica pura com dependências injetadas (mesmo padrão
 * de `lib/envio/lote.ts`): o banco, a IA e o Sender entram por `DepsResposta`; a função Inngest só costura.
 * A IA nunca escreve no banco: ela devolve JSON e é este código que decide.
 *
 * Idempotência por wamid (`respostas.wamid` é unique):
 *  - a resposta é gravada ANTES de chamar a IA (INSERT ... ON CONFLICT DO NOTHING);
 *  - se o wamid já existe e já foi processada (classificada, sem agendamento ou sem texto), retorna "duplicada"
 *    sem reclassificar nem reenviar — cobre retry do Inngest e reentrega do webhook da Meta;
 *  - se existe mas NÃO foi classificada (crash/erro da IA antes de gravar a decisão), segue e classifica uma vez;
 *  - a resposta automática é reservada (`mensagens.resposta_a_wamid` unique) antes do envio: um retry nunca duplica o texto.
 *
 * Latência (meta: webhook → status < 10 s): só 2 steps e nenhum sleep. O gargalo esperado é a chamada ao Haiku
 * (~1–3 s com max_tokens 400), mais o envio do texto (~0,5 s); consultas ao banco são de ~10–50 ms cada.
 * O status do agendamento é gravado no 1º step, ANTES do envio ao paciente.
 */

export type PacienteLocalizado = {
  pacienteId: string; nome: string;
  clinicaId: string; clinicaNome: string; fuso: string; phoneNumberId: string; tokenRef: string | null;
  regras?: RegrasClinica | null;
};

export type AgendamentoAberto = { id: string; atendimento: string; dataHora: Date; status: string; profissional?: string | null };

export type StatusDecidido = "confirmado" | "cancelado" | "excecao";

export type DecisaoGravada = {
  respostaId: string;
  agendamentoId: string;
  intencao: Saida["intencao"] | null;
  confianca: number | null;
  motivo: string | null;
  classificadaPor: string;
  precisaHumano: boolean;
  novoStatus: StatusDecidido;
};

export type DepsResposta = {
  sender: Sender;
  agora(): Date;
  env?: Record<string, string | undefined>;
  /** Paciente com esse telefone (qualquer uma das variantes) na clínica dona do `phoneNumberId`. */
  localizarPaciente(phoneNumberId: string, telefones: string[]): Promise<PacienteLocalizado | null>;
  /** Agendamentos futuros em `inserido`/`enviado` do paciente (a escolha do mais próximo é feita em `escolherAgendamento`). */
  listarAgendamentosAbertos(pacienteId: string, agora: Date): Promise<AgendamentoAberto[]>;
  /** INSERT ... ON CONFLICT (wamid) DO NOTHING; se já existia, informa se já foi processada. */
  registrarResposta(d: {
    wamid: string; pacienteId: string; agendamentoId: string | null; texto: string;
    precisaHumano: boolean;
  }): Promise<{ id: string; jaProcessada: boolean }>;
  /** `token_ref` da clínica dona do `phoneNumberId`. */
  buscarTokenRef(phoneNumberId: string): Promise<string | null>;
  /** Sem paciente: nada a gravar em `respostas` (pacienteId é NOT NULL); fica só o aviso no evento bruto. */
  registrarSemPaciente(eventoId: string | undefined): Promise<void>;
  /** Conhecimento da clínica (+ globais) para o RAG leve; falha aqui não derruba a classificação. */
  buscarConhecimento(clinicaId: string): Promise<LinhaConhecimento[]>;
  classificar(entrada: EntradaClassificacao): Promise<Saida>;
  /**
   * Grava classificação na resposta + status do agendamento (transação). O status só é aplicado se o agendamento ainda
   * estiver aberto; devolve `false` se um humano já decidiu (a decisão da IA fica só em `respostas`).
   */
  gravarDecisao(d: DecisaoGravada): Promise<boolean>;
  /** Reserva (resposta_a_wamid unique) o texto automático como `texto_livre` pendente; null se já existia. */
  reservarRespostaAutomatica(agendamentoId: string, wamidResposta: string, corpo: string): Promise<string | null>;
  /** Corpo da mensagem reservada, só se ainda `pendente` e sem wamid. */
  carregarCorpoPendente(mensagemId: string): Promise<string | null>;
  marcarMensagemEnviada(id: string, d: { wamid: string; corpo: string }): Promise<void>;
  marcarMensagemFalhou(id: string, d: { erroCodigo: number | null; erroMensagem: string }): Promise<void>;
};

export type EntradaResposta = {
  eventoId?: string; from: string; wamid: string; texto?: string; botao?: string; phoneNumberId: string;
};

export type ResultadoResposta = {
  resultado: "duplicada" | "sem_paciente" | "sem_agendamento" | StatusDecidido;
  agendamentoId?: string;
  mensagemId?: string;
  enviada?: boolean;
};

/** Agendamento aberto mais próximo: futuro, `inserido`/`enviado`, por data crescente. */
export function escolherAgendamento(ags: AgendamentoAberto[], agora: Date): AgendamentoAberto | null {
  return ags
    .filter((a) => (a.status === "enviado" || a.status === "inserido") && a.dataHora.getTime() > agora.getTime())
    .sort((a, b) => a.dataHora.getTime() - b.dataHora.getTime())[0] ?? null;
}

/**
 * Regra de decisão (código, não IA): só confirmou/cancelou com confiança >= LIMIAR muda o status e recebe resposta
 * automática. Todo o resto (inclui nao_sou_eu, que também vira `excecao`) cai na fila humana, sem nada enviado.
 */
export function decidirResposta(s: Pick<Saida, "intencao" | "confianca">): { novoStatus: StatusDecidido; responder: boolean } {
  if (s.confianca >= LIMIAR_CONFIANCA) {
    if (s.intencao === "confirmou") return { novoStatus: "confirmado", responder: true };
    if (s.intencao === "cancelou") return { novoStatus: "cancelado", responder: true };
  }
  return { novoStatus: "excecao", responder: false };
}

/** Só letras do primeiro nome (o harness rejeita outra coisa); nunca sobrenome. */
export function primeiroNomeParaIA(nome: string): string {
  const p = (nome.trim().split(/\s+/)[0] ?? "").replace(/[^\p{L}]/gu, "").slice(0, 40);
  return p || "Paciente";
}

function codigoDoErro(e: unknown): number | null {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "number" ? c : null;
}

export async function rodarProcessarResposta(
  step: Pick<StepLike, "run">,
  entrada: EntradaResposta,
  deps: DepsResposta,
): Promise<ResultadoResposta> {
  const env = deps.env ?? process.env;
  const log = { wamid: entrada.wamid, de: mask(entrada.from), tamanho: (entrada.texto ?? entrada.botao ?? "").length };

  // Step 1: localizar → gravar resposta → classificar → gravar decisão/status → reservar texto. Devolve só ids.
  const plano = await step.run("classificar-e-decidir", async (): Promise<ResultadoResposta> => {
    const texto = entrada.texto ?? entrada.botao ?? "";
    const agora = deps.agora();

    const paciente = await deps.localizarPaciente(entrada.phoneNumberId, variantesTelefone(entrada.from));
    if (!paciente) {
      await deps.registrarSemPaciente(entrada.eventoId);
      console.warn("[resposta] paciente não localizado", log);
      return { resultado: "sem_paciente" };
    }

    const ag = escolherAgendamento(await deps.listarAgendamentosAbertos(paciente.pacienteId, agora), agora);

    // Sem agendamento aberto ou sem texto (figurinha, áudio...): grava e deixa para a fila humana; nunca responde.
    const semClassificar = !ag || texto.trim() === "";
    const reg = await deps.registrarResposta({
      wamid: entrada.wamid, pacienteId: paciente.pacienteId, agendamentoId: ag?.id ?? null, texto,
      precisaHumano: true,
    });
    if (reg.jaProcessada) {
      console.log("[resposta] wamid já processado; ignorado", log);
      return { resultado: "duplicada" };
    }
    if (!ag) {
      console.warn("[resposta] sem agendamento aberto", log);
      return { resultado: "sem_agendamento" };
    }
    if (semClassificar) {
      await deps.gravarDecisao({
        respostaId: reg.id, agendamentoId: ag.id, intencao: null, confianca: null, motivo: "mensagem sem texto",
        classificadaPor: "sistema", precisaHumano: true, novoStatus: "excecao",
      });
      return { resultado: "excecao", agendamentoId: ag.id, enviada: false };
    }

    // Contexto da clínica (RAG leve). Falha na busca: só o nome do erro no log e segue com contexto vazio.
    let contexto: ContextoClinica = { regras: [], exemplos: [] };
    try {
      const conhecimento = await deps.buscarConhecimento(paciente.clinicaId);
      contexto = montarContexto({ regras: paciente.regras, conhecimento, atendimento: ag.atendimento });
    } catch (e) {
      console.warn("[resposta] contexto da clínica indisponível; seguindo sem regras/exemplos", { ...log, erro: (e as Error)?.name ?? "Error" });
    }

    // IA: só primeiro nome, atendimento, data legível, nome da clínica e o contexto (regras/exemplos).
    const saida = await deps.classificar({
      textoPaciente: texto,
      primeiroNome: primeiroNomeParaIA(paciente.nome),
      atendimento: ag.atendimento,
      dataHoraLegivel: formatarDataHora(ag.dataHora, paciente.fuso),
      clinicaNome: paciente.clinicaNome,
      regras: contexto.regras,
      exemplos: contexto.exemplos,
      agendamentoId: ag.id,
    });

    const { novoStatus, responder } = decidirResposta(saida);
    // status gravado ANTES de qualquer envio: falha do envio não desfaz nem reclassifica
    const aplicou = await deps.gravarDecisao({
      respostaId: reg.id, agendamentoId: ag.id, intencao: saida.intencao, confianca: saida.confianca, motivo: saida.motivo,
      classificadaPor: "haiku", precisaHumano: !responder, novoStatus,
    });
    console.log("[resposta] classificada", { ...log, intencao: saida.intencao, confianca: saida.confianca, status: novoStatus });

    // humano decidiu durante a classificação: o status dele vale e o paciente não recebe texto automático
    if (!aplicou) {
      console.warn("[resposta] status já decidido por humano; texto automático não enviado", log);
      return { resultado: novoStatus, agendamentoId: ag.id, enviada: false };
    }
    // texto FIXO por intenção: nada do que o modelo devolveu (fora a intenção) chega ao paciente
    const textoAuto = responder
      ? textoResposta(saida.intencao, {
          primeiroNome: primeiroNomeParaIA(paciente.nome), dataHora: ag.dataHora, fuso: paciente.fuso, profissional: ag.profissional,
        })
      : null;
    if (!textoAuto) return { resultado: novoStatus, agendamentoId: ag.id, enviada: false };
    const mensagemId = await deps.reservarRespostaAutomatica(ag.id, entrada.wamid, textoAuto);
    return { resultado: novoStatus, agendamentoId: ag.id, ...(mensagemId ? { mensagemId } : { enviada: false }) };
  });

  if (!plano.mensagemId) return plano;
  const mensagemId = plano.mensagemId;

  // Step 2: envio do texto livre (janela de 24 h aberta pela resposta do paciente). Nunca lança por falha de envio.
  const enviada = await step.run("enviar-resposta", async () => {
    const corpo = await deps.carregarCorpoPendente(mensagemId);
    if (!corpo) return false; // já enviada/falhou em execução anterior: nunca duplicar
    const clinicaToken = await tokenDaClinica(deps, entrada, env);
    if (!clinicaToken.ok) {
      await deps.marcarMensagemFalhou(mensagemId, { erroCodigo: null, erroMensagem: clinicaToken.erro });
      return false;
    }
    try {
      const { wamid } = await deps.sender.sendText(
        { phoneNumberId: entrada.phoneNumberId, token: clinicaToken.token, to: entrada.from }, corpo,
      );
      await deps.marcarMensagemEnviada(mensagemId, { wamid, corpo });
      return true;
    } catch (e) {
      const erroCodigo = codigoDoErro(e);
      console.error("[resposta] envio falhou", { ...log, erroCodigo });
      await deps.marcarMensagemFalhou(mensagemId, {
        erroCodigo, erroMensagem: mascararNumerosNoTexto((e as Error)?.message ?? "erro desconhecido"),
      });
      return false;
    }
  });

  return { ...plano, enviada };
}

/** Token da clínica do `phoneNumberId` (token_ref → WHATSAPP_TOKEN); "fake" com WHATSAPP_FAKE=1. */
async function tokenDaClinica(
  deps: DepsResposta, entrada: EntradaResposta, env: Record<string, string | undefined>,
): Promise<{ ok: true; token: string } | { ok: false; erro: string }> {
  if (env.WHATSAPP_FAKE === "1") return { ok: true, token: "fake" };
  const token = resolverToken(await deps.buscarTokenRef(entrada.phoneNumberId), env);
  return token ? { ok: true, token } : { ok: false, erro: "token do WhatsApp não configurado (token_ref / WHATSAPP_TOKEN)" };
}
