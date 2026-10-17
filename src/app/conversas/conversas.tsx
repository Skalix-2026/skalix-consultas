"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/badge";
import type { AcaoConversa, EventoHistorico, RespostaAcao, RespostaHistorico, RespostaListaConversas } from "@/lib/schemas-conversas";
import { chamarApi } from "@/lib/ui/api";
import {
  agendamentoPadrao,
  AVISO_FORA_DA_JANELA,
  contarExcecoes,
  horarioRelativo,
  INTERVALO_LISTA_MS,
  LIMITE_TEXTO,
  mensagemErroAcao,
  ordenarConversas,
  percentual,
  rotuloIntencao,
  textoValido,
  ehTextoRemovido,
} from "@/lib/ui/conversas";
import { formatarDataHora } from "@/lib/ui/formatar";
import { infoAgendamento, infoMensagem } from "@/lib/ui/status";

type CorpoAcao = AcaoConversa extends infer U ? (U extends unknown ? Omit<U, "chaveIdempotencia"> : never) : never;
type ListaOk = Extract<RespostaListaConversas, { ok: true }>;
type HistoricoOk = Extract<RespostaHistorico, { ok: true }>;

function BadgeAgendamento({ status }: { status: string }) {
  const info = infoAgendamento(status);
  // Exceção ganha destaque forte (vermelho) em vez do amarelo padrão.
  return <Badge rotulo={info.rotulo} tom={status === "excecao" ? "vermelho" : info.tom} />;
}

export function Conversas() {
  const [lista, setLista] = useState<ListaOk["conversas"] | null>(null);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [excecoesPrimeiro, setExcecoesPrimeiro] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);

  const carregarLista = useCallback(async () => {
    try {
      const r = await chamarApi<ListaOk>(`/api/conversas?excecoesPrimeiro=${excecoesPrimeiro ? "1" : "0"}`);
      setLista(r.conversas);
      setErroLista(null);
    } catch (e) {
      setErroLista(e instanceof Error ? e.message : "Não foi possível carregar as conversas.");
    }
  }, [excecoesPrimeiro]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregarLista();
  }, [carregarLista]);

  // Atualização leve: só com a aba visível; não mexe na conversa aberta nem no texto digitado.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void carregarLista();
    }, INTERVALO_LISTA_MS);
    return () => clearInterval(t);
  }, [carregarLista]);

  if (lista === null && erroLista) {
    return (
      <div role="alert" className="mt-6 rounded-md bg-red-50 p-4 text-sm text-red-700">
        {erroLista}{" "}
        <button type="button" onClick={carregarLista} className="font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          Tentar de novo
        </button>
      </div>
    );
  }
  if (!lista) return <p role="status" className="mt-6 text-sm text-gray-600">Carregando conversas…</p>;

  const visiveis = ordenarConversas(lista, excecoesPrimeiro);
  const excecoes = contarExcecoes(lista);
  const atual = lista.find((c) => c.pacienteId === aberto) ?? null;

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[340px_1fr]">
      <section aria-label="Lista de conversas" className={`min-w-0 ${aberto ? "hidden lg:block" : ""}`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={excecoesPrimeiro} onChange={(e) => setExcecoesPrimeiro(e.target.checked)} className="h-4 w-4" />
            Exceções primeiro
          </label>
          <span aria-live="polite" className={`text-sm ${excecoes > 0 ? "font-medium text-red-700" : "text-gray-600"}`}>
            {excecoes === 0 ? "Nenhuma precisa de atenção" : excecoes === 1 ? "1 precisa de atenção" : `${excecoes} precisam de atenção`}
          </span>
        </div>
        {erroLista && (
          <p role="alert" className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {erroLista}{" "}
            <button type="button" onClick={carregarLista} className="font-medium underline">Tentar de novo</button>
          </p>
        )}
        {visiveis.length === 0 ? (
          <div className="rounded-lg border bg-white p-8 text-center">
            <p className="font-medium">Nenhuma conversa ainda</p>
            <p className="mt-1 text-sm text-gray-600">As respostas dos pacientes aparecem aqui depois que as confirmações forem enviadas.</p>
          </div>
        ) : (
          <ul aria-label="Pacientes" className="space-y-2">
            {visiveis.map((c) => {
              const ativo = c.pacienteId === aberto;
              return (
                <li key={c.pacienteId}>
                  <button
                    type="button"
                    onClick={() => setAberto(c.pacienteId)}
                    aria-pressed={ativo}
                    className={`w-full rounded-lg border p-3 text-left hover:border-gray-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                      c.temExcecao ? "border-l-4 border-l-red-600 bg-red-50" : "bg-white"
                    } ${ativo ? "ring-2 ring-gray-900" : ""}`}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="truncate text-sm font-medium">{c.nome}</span>
                      <span className="shrink-0 text-xs text-gray-500">{horarioRelativo(c.ultimaMensagem.quando)}</span>
                    </span>
                    <span className="block text-xs text-gray-500">{c.telefone}</span>
                    <span className="mt-1 block truncate text-sm text-gray-700">
                      <span className="text-gray-500">{c.ultimaMensagem.direcao === "enviada" ? "Você: " : ""}</span>
                      {c.ultimaMensagem.trecho}
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-2">
                      {c.agendamento && <BadgeAgendamento status={c.agendamento.status} />}
                      {c.temExcecao && !(c.agendamento?.status === "excecao") && <Badge rotulo="Precisa de atenção" tom="vermelho" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {aberto ? (
        <Detalhe
          key={aberto}
          pacienteId={aberto}
          agendamentoFocoId={atual?.agendamento?.id ?? null}
          aoVoltar={() => setAberto(null)}
          aoMudar={carregarLista}
        />
      ) : (
        <p className="hidden rounded-lg border bg-white p-8 text-center text-sm text-gray-600 lg:block">
          Escolha uma conversa ao lado para ver o histórico.
        </p>
      )}
    </div>
  );
}

function Detalhe({
  pacienteId,
  agendamentoFocoId,
  aoVoltar,
  aoMudar,
}: {
  pacienteId: string;
  agendamentoFocoId: string | null;
  aoVoltar: () => void;
  aoMudar: () => Promise<void>;
}) {
  const [dados, setDados] = useState<HistoricoOk | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [agSel, setAgSel] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [confirmandoCancelar, setConfirmandoCancelar] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  // Mesma chave enquanto a "mesma tentativa" se repete (erro de rede); nova chave para nova ação/mensagem.
  const tentativa = useRef<{ assinatura: string; chave: string } | null>(null);
  const fimChat = useRef<HTMLDivElement>(null);
  const botaoNao = useRef<HTMLButtonElement>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await chamarApi<HistoricoOk>(`/api/conversas/${encodeURIComponent(pacienteId)}`);
      setDados(r);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar a conversa.");
    }
  }, [pacienteId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar();
  }, [carregar]);

  const totalEventos = dados?.eventos.length ?? 0;
  useEffect(() => {
    fimChat.current?.scrollIntoView?.({ block: "end" });
  }, [totalEventos]);

  useEffect(() => {
    if (confirmandoCancelar) botaoNao.current?.focus();
  }, [confirmandoCancelar]);

  const escolhido = dados ? (dados.agendamentos.find((a) => a.id === agSel) ?? agendamentoPadrao(dados.agendamentos, agendamentoFocoId)) : null;

  async function executar(corpo: CorpoAcao, mensagemOk: string): Promise<boolean> {
    const assinatura = JSON.stringify(corpo);
    if (tentativa.current?.assinatura !== assinatura) tentativa.current = { assinatura, chave: crypto.randomUUID() };
    setOcupado(true);
    setAviso(null);
    let ok = false;
    try {
      let res: Response;
      try {
        res = await fetch(`/api/conversas/${encodeURIComponent(pacienteId)}/acao`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...corpo, chaveIdempotencia: tentativa.current.chave }),
        });
      } catch {
        setAviso({ tipo: "erro", texto: "Falha de conexão. Verifique a internet e tente novamente." });
        return false;
      }
      const j = (await res.json().catch(() => null)) as RespostaAcao | null;
      if (res.ok && j && j.ok) {
        ok = true;
        tentativa.current = null;
        setAviso({ tipo: "ok", texto: mensagemOk });
      } else {
        const e = j && !j.ok ? j : null;
        // Erro definitivo do servidor: a próxima tentativa já é uma nova decisão do usuário.
        if (e && e.erro !== "envio_falhou" && e.erro !== "erro_interno") tentativa.current = null;
        setAviso({ tipo: "erro", texto: mensagemErroAcao(e?.erro, e?.mensagem) });
      }
    } finally {
      setOcupado(false);
    }
    await Promise.all([carregar(), aoMudar()]);
    return ok;
  }

  async function enviarTexto() {
    if (ocupado || !textoValido(texto)) return;
    const ok = await executar(
      { acao: "responder", texto: texto.trim(), ...(escolhido ? { agendamentoId: escolhido.id } : {}) },
      "Mensagem enviada.",
    );
    if (ok) setTexto("");
  }

  if (erro && !dados) {
    return (
      <div role="alert" className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        {erro}{" "}
        <button type="button" onClick={carregar} className="font-medium underline">Tentar de novo</button>
      </div>
    );
  }
  if (!dados) return <p role="status" className="text-sm text-gray-600">Carregando conversa…</p>;

  const janela = dados.janelaAberta;
  const semAg = !escolhido;

  return (
    <section aria-labelledby="titulo-conversa" className="flex min-w-0 flex-col gap-3 rounded-lg border bg-white p-4">
      <div>
        <button type="button" onClick={aoVoltar} className="mb-2 text-sm font-medium underline lg:hidden">
          ← Voltar para a lista
        </button>
        <h2 id="titulo-conversa" className="text-lg font-semibold">{dados.paciente.nome}</h2>
        <p className="text-sm text-gray-600">{dados.paciente.telefone}</p>
        {dados.agendamentos.length > 0 && (
          <ul aria-label="Agendamentos" className="mt-2 space-y-1">
            {dados.agendamentos.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span>{a.atendimento}{a.profissional ? ` · ${a.profissional}` : ""} · {formatarDataHora(a.dataHora)}</span>
                <BadgeAgendamento status={a.status} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {erro && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{erro}</p>}

      <div role="log" aria-label="Histórico da conversa" className="max-h-[50vh] min-h-40 space-y-3 overflow-y-auto rounded-md bg-gray-50 p-3">
        {dados.eventos.length === 0 ? (
          <p className="text-center text-sm text-gray-600">Nenhuma mensagem nesta conversa.</p>
        ) : (
          dados.eventos.map((ev) => <Evento key={`${ev.tipo}-${ev.id}`} ev={ev} />)
        )}
        <div ref={fimChat} />
      </div>

      <div className="space-y-2 border-t pt-3">
        {dados.agendamentos.length > 1 && escolhido && (
          <label className="flex flex-wrap items-center gap-2 text-sm">
            Agendamento:
            <select
              value={escolhido.id}
              onChange={(e) => setAgSel(e.target.value)}
              className="rounded-md border px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2"
            >
              {dados.agendamentos.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.atendimento} · {formatarDataHora(a.dataHora)} · {infoAgendamento(a.status).rotulo}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={ocupado || semAg}
            onClick={() => escolhido && void executar({ acao: "confirmar", agendamentoId: escolhido.id }, "Consulta confirmada.")}
            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Confirmar
          </button>
          <button
            type="button"
            disabled={ocupado || semAg}
            onClick={() => setConfirmandoCancelar(true)}
            className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-50 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={ocupado || semAg}
            onClick={() => escolhido && void executar({ acao: "resolver", agendamentoId: escolhido.id }, "Marcado como resolvido.")}
            className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Marcar como resolvido
          </button>
        </div>

        {confirmandoCancelar && escolhido && (
          <div role="alertdialog" aria-labelledby="titulo-cancelar" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm">
            <p id="titulo-cancelar" className="font-medium text-red-900">Cancelar a consulta de {formatarDataHora(escolhido.dataHora)}?</p>
            <p className="mt-1 text-red-800">O agendamento ficará como cancelado.</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={ocupado}
                onClick={async () => {
                  await executar({ acao: "cancelar", agendamentoId: escolhido.id }, "Consulta cancelada.");
                  setConfirmandoCancelar(false);
                }}
                className="rounded-md bg-red-700 px-3 py-1.5 font-medium text-white hover:bg-red-800 disabled:opacity-60"
              >
                Sim, cancelar consulta
              </button>
              <button ref={botaoNao} type="button" disabled={ocupado} onClick={() => setConfirmandoCancelar(false)} className="rounded-md border bg-white px-3 py-1.5 hover:bg-gray-50">
                Não cancelar
              </button>
            </div>
          </div>
        )}

        <div role="status" aria-live="polite">
          {aviso && (
            <p className={`rounded-md p-2 text-sm ${aviso.tipo === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{aviso.texto}</p>
          )}
        </div>

        {!janela && (
          <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900">{AVISO_FORA_DA_JANELA}</p>
        )}
        <div>
          <label htmlFor="resposta" className="text-sm font-medium">Responder</label>
          <textarea
            id="resposta"
            value={texto}
            maxLength={LIMITE_TEXTO}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void enviarTexto();
              }
            }}
            rows={3}
            className="mt-1 w-full rounded-md border p-2 text-sm focus-visible:outline focus-visible:outline-2"
            placeholder="Escreva a mensagem para o paciente"
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-xs text-gray-600">{texto.length}/{LIMITE_TEXTO} · Ctrl+Enter envia</span>
            <button
              type="button"
              disabled={ocupado || !textoValido(texto) || !janela}
              onClick={() => void enviarTexto()}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {ocupado ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Evento({ ev }: { ev: EventoHistorico }) {
  if (ev.tipo === "acao_recepcao") {
    return (
      <p className="text-center text-xs text-gray-600">
        {ev.texto} · {formatarDataHora(ev.quando)}
      </p>
    );
  }
  if (ev.tipo === "mensagem_enviada") {
    const sm = infoMensagem(ev.status);
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg bg-gray-900 px-3 py-2 text-sm text-white">
          <p className="whitespace-pre-wrap break-words">{ev.texto}</p>
          <p className="mt-1 flex items-center justify-end gap-2 text-xs text-gray-300">
            {formatarDataHora(ev.quando)}
            <span className="rounded bg-white/90 px-1.5 text-gray-900">{sm.rotulo}</span>
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] rounded-lg border bg-white px-3 py-2 text-sm">
        {ehTextoRemovido(ev.texto) ? (
          <p className="italic text-gray-500">mensagem removida (retenção de 90 dias)</p>
        ) : (
          <p className="whitespace-pre-wrap break-words">{ev.texto}</p>
        )}
        <p className="mt-1 text-xs text-gray-600">
          {formatarDataHora(ev.quando)}
          {ev.intencao && (
            <span>
              {" "}· IA: {rotuloIntencao(ev.intencao)}
              {ev.confianca != null && ` (${percentual(ev.confianca)})`}
            </span>
          )}
          {ev.precisaHumano && !ev.resolvida && <span className="font-medium text-red-700"> · Precisa de atenção</span>}
        </p>
      </div>
    </div>
  );
}
