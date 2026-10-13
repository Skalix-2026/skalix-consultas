"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/badge";
import { chamarApi, type Agendamento, type Lote } from "@/lib/ui/api";
import { formatarData, formatarDataHora } from "@/lib/ui/formatar";
import {
  DICA_PENDENTE,
  explicarErro,
  infoAgendamento,
  infoLote,
  infoMensagem,
  intervaloPolling,
  podeEnviar,
  textoBotaoEnviar,
} from "@/lib/ui/status";

export function CentralEnvios({ loteInicial }: { loteInicial?: string }) {
  const [lotes, setLotes] = useState<Lote[] | null>(null);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<string | undefined>(loteInicial);

  const carregarLotes = useCallback(async () => {
    try {
      const r = await chamarApi<{ ok: true; lotes: Lote[] }>("/api/lotes");
      setLotes(r.lotes);
      setErroLista(null);
    } catch (e) {
      setErroLista(e instanceof Error ? e.message : "Não foi possível carregar as agendas.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregarLotes();
  }, [carregarLotes]);

  if (erroLista) {
    return (
      <div role="alert" className="mt-6 rounded-md bg-red-50 p-4 text-sm text-red-700">
        {erroLista}{" "}
        <button type="button" onClick={carregarLotes} className="font-medium underline">
          Tentar de novo
        </button>
      </div>
    );
  }
  if (!lotes) return <p role="status" className="mt-6 text-sm text-gray-600">Carregando agendas…</p>;
  if (lotes.length === 0) {
    return (
      <div className="mt-6 rounded-lg border bg-white p-8 text-center">
        <p className="font-medium">Nenhuma agenda importada ainda</p>
        <p className="mt-1 text-sm text-gray-600">Importe uma agenda para poder enviar as confirmações.</p>
        <Link href="/importar" className="mt-4 inline-block rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800">
          Importar agenda
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
      <ul aria-label="Agendas importadas" className="space-y-2">
        {lotes.map((l) => {
          const info = infoLote(l.status);
          const feitos = l.linhasValidas - (l.contagens.inserido ?? 0);
          const pct = l.linhasValidas ? Math.round((feitos / l.linhasValidas) * 100) : 0;
          const ativo = l.id === selecionado;
          return (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => setSelecionado(l.id)}
                aria-pressed={ativo}
                className={`w-full rounded-lg border bg-white p-3 text-left hover:border-gray-400 ${ativo ? "border-gray-900 ring-1 ring-gray-900" : ""}`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="truncate text-sm font-medium">{l.arquivoNome}</span>
                  <Badge rotulo={info.rotulo} tom={info.tom} />
                </span>
                <span className="mt-1 block text-xs text-gray-500">{formatarData(l.criadoEm)}</span>
                <span className="mt-2 block h-1.5 overflow-hidden rounded bg-gray-100">
                  <span className="block h-full bg-green-600" style={{ width: `${pct}%` }} />
                </span>
                <span className="mt-1 block text-xs text-gray-600">
                  {feitos} de {l.linhasValidas} enviados
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {selecionado ? (
        <DetalheLote key={selecionado} id={selecionado} aoMudar={carregarLotes} />
      ) : (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-gray-600">
          Escolha uma agenda ao lado para ver os pacientes.
        </p>
      )}
    </div>
  );
}

function DetalheLote({ id, aoMudar }: { id: string; aoMudar: () => void }) {
  const [lote, setLote] = useState<Lote | null>(null);
  const [ags, setAgs] = useState<Agendamento[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const botaoCancelar = useRef<HTMLButtonElement>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await chamarApi<{ ok: true; lote: Lote; agendamentos: Agendamento[] }>(`/api/lotes/${encodeURIComponent(id)}`);
      setLote(r.lote);
      setAgs(r.agendamentos);
      setErro(null);
      return r.lote.status;
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar esta agenda.");
      return null;
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar();
  }, [carregar]);

  // Rápido enquanto envia; depois mais lento até as mensagens evoluírem (entregue/lida).
  const intervalo = lote ? intervaloPolling(lote.status, ags.map((a) => a.mensagemStatus)) : null;
  useEffect(() => {
    if (intervalo == null) return;
    const t = setInterval(async () => {
      await carregar();
      aoMudar();
    }, intervalo);
    return () => clearInterval(t);
  }, [intervalo, carregar, aoMudar]);

  useEffect(() => {
    if (confirmando) botaoCancelar.current?.focus();
  }, [confirmando]);

  async function enviar() {
    setEnviando(true);
    setErroEnvio(null);
    try {
      await chamarApi<{ ok: true }>(`/api/lotes/${encodeURIComponent(id)}/enviar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      setConfirmando(false);
      await carregar();
      aoMudar();
    } catch (e) {
      setErroEnvio(e instanceof Error ? e.message : "Não foi possível iniciar o envio.");
      setConfirmando(false);
    } finally {
      setEnviando(false);
    }
  }

  if (erro) {
    return (
      <div role="alert" className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        {erro}{" "}
        <button type="button" onClick={carregar} className="font-medium underline">
          Tentar de novo
        </button>
      </div>
    );
  }
  if (!lote) return <p role="status" className="text-sm text-gray-600">Carregando pacientes…</p>;

  const info = infoLote(lote.status);
  const pendentes = lote.contagens.inserido ?? 0;
  const habilitado = podeEnviar(lote.status, pendentes);
  const c: Record<string, number> = { inserido: 0, enviado: 0, confirmado: 0, cancelado: 0, ...lote.contagens };
  const resumo: [string, number][] = [
    ["Aguardando", c.inserido],
    ["Enviados", c.enviado],
    ["Confirmados", c.confirmado],
    ["Cancelados", c.cancelado],
    ["Sem resposta", c.sem_resposta],
  ];

  return (
    <section aria-labelledby="titulo-lote" className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="titulo-lote" className="text-lg font-semibold">{lote.arquivoNome}</h2>
          <p className="mt-1 flex items-center gap-2 text-sm text-gray-600">
            <Badge rotulo={info.rotulo} tom={info.tom} />
            <span>{lote.linhasValidas} agendamentos</span>
          </p>
        </div>
        <button
          type="button"
          disabled={!habilitado || enviando}
          onClick={() => setConfirmando(true)}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {textoBotaoEnviar(lote.status)}
        </button>
      </div>

      <div role="status" aria-live="polite" className="text-sm text-amber-800">
        {lote.status === "enviando" && "Enviando as confirmações… esta tela atualiza sozinha."}
      </div>
      {erroEnvio && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{erroEnvio}</p>}

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {resumo.map(([nome, n]) => (
          <div key={nome} className="flex gap-1">
            <dt className="text-gray-600">{nome}:</dt>
            <dd className="font-medium">{n}</dd>
          </div>
        ))}
      </dl>

      {confirmando && (
        <div role="dialog" aria-modal="true" aria-labelledby="titulo-confirmar" className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg">
            <h3 id="titulo-confirmar" className="font-semibold">Enviar para {pendentes} pacientes?</h3>
            <p className="mt-2 text-sm text-gray-600">As mensagens de confirmação serão enviadas por WhatsApp. Isso não pode ser desfeito.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={botaoCancelar}
                type="button"
                onClick={() => setConfirmando(false)}
                disabled={enviando}
                className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={enviar}
                disabled={enviando}
                className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
              >
                {enviando ? "Enviando…" : "Sim, enviar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {ags.length === 0 ? (
        <p className="rounded-lg border bg-white p-6 text-center text-sm text-gray-600">Esta agenda não tem agendamentos.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                {["Paciente", "Telefone", "Atendimento", "Profissional", "Data e hora", "Situação", "Mensagem"].map((h) => (
                  <th key={h} scope="col" className="whitespace-nowrap px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {ags.map((a) => {
                const sa = infoAgendamento(a.status);
                const sm = a.mensagemStatus ? infoMensagem(a.mensagemStatus) : null;
                const textoErro = a.mensagemStatus ? explicarErro(a.erroCodigo, a.erroMensagem) : null;
                return (
                  <tr key={a.id}>
                    <td className="px-3 py-2 font-medium">{a.nome}</td>
                    <td className="whitespace-nowrap px-3 py-2">{a.telefone}</td>
                    <td className="px-3 py-2">{a.atendimento}</td>
                    <td className="px-3 py-2">{a.profissional ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{formatarDataHora(a.dataHora)}</td>
                    <td className="px-3 py-2"><Badge rotulo={sa.rotulo} tom={sa.tom} /></td>
                    <td className="px-3 py-2">
                      {sm ? (
                        <span title={a.mensagemStatus === "pendente" ? DICA_PENDENTE : undefined}>
                          <Badge rotulo={sm.rotulo} tom={sm.tom} />
                        </span>
                      ) : <span className="text-gray-400">—</span>}
                      {textoErro && <p className="mt-1 text-xs text-red-700">{textoErro}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
