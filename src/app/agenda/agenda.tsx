"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgendamentoDoDia, RespostaAgenda } from "@/lib/schemas-agenda";
import { chamarApi } from "@/lib/ui/api";
import {
  agruparPorHora,
  contarPorGrupo,
  dataPorExtenso,
  dataValida,
  GRUPOS_LEGENDA,
  INTERVALO_AGENDA_MS,
  rotuloHora,
  somarDias,
  visualDoGrupo,
  visualDoStatus,
  type GrupoStatus,
} from "@/lib/ui/agenda";

type Ok = Extract<RespostaAgenda, { ok: true }>;

const FOCO = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";
const BOTAO = `rounded-md border bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${FOCO}`;

function urlAgenda(data: string | undefined, profissional: string | undefined): string {
  const p = new URLSearchParams();
  if (data) p.set("data", data);
  if (profissional) p.set("profissional", profissional);
  const qs = p.toString();
  return qs ? `/agenda?${qs}` : "/agenda";
}

function horaAgora(): string {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date());
}

/** `data` e `profissional` vêm da URL (página servidor); mudar a tela navega e a página reenvia as props. */
export function Agenda({ data, profissional }: { data?: string; profissional?: string }) {
  const router = useRouter();
  const chave = data ?? "hoje";
  const [estado, setEstado] = useState<{ chave: string; resp: Ok } | null>(null);
  const [erro, setErro] = useState<{ chave: string; mensagem: string } | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null);
  const [destaque, setDestaque] = useState<GrupoStatus | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    let emVoo = false;
    const carregar = async () => {
      if (emVoo) return;
      emVoo = true;
      const qs = new URLSearchParams();
      if (data) qs.set("data", data);
      if (profissional) qs.set("profissional", profissional);
      try {
        const resp = await chamarApi<Ok>(`/api/agenda${qs.size ? `?${qs}` : ""}`, { signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        setEstado({ chave, resp });
        setErro(null);
        setAtualizadoEm(horaAgora());
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setErro({ chave, mensagem: e instanceof Error ? e.message : "Não foi possível carregar a agenda." });
      } finally {
        emVoo = false;
      }
    };
    void carregar();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void carregar();
    }, INTERVALO_AGENDA_MS);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void carregar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      ctrl.abort();
      clearInterval(t);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [data, profissional, chave, tentativa]);

  // Dados só valem para o dia da URL: ao trocar de dia mostramos "carregando"; ao refrescar, mantemos o anterior.
  const dados = estado && estado.chave === chave ? estado.resp : null;
  const erroAtual = erro && erro.chave === chave ? erro.mensagem : null;
  const dataAtual = dados?.data ?? data;

  const ir = (d: string | undefined, p: string | undefined = profissional) => router.push(urlAgenda(d, p), { scroll: false });

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2" role="group" aria-label="Navegar entre os dias">
          <button type="button" className={BOTAO} aria-label="Dia anterior" disabled={!dataAtual} onClick={() => dataAtual && ir(somarDias(dataAtual, -1))}>
            ◀
          </button>
          <button type="button" className={BOTAO} onClick={() => ir(undefined)}>Hoje</button>
          <button type="button" className={BOTAO} aria-label="Próximo dia" disabled={!dataAtual} onClick={() => dataAtual && ir(somarDias(dataAtual, 1))}>
            ▶
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Data
          <input
            type="date"
            value={dataAtual ?? ""}
            onChange={(e) => dataValida(e.target.value) && ir(e.target.value)}
            className={`rounded-md border bg-white px-2 py-1.5 text-sm ${FOCO}`}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Profissional
          <select
            value={profissional ?? ""}
            onChange={(e) => ir(data, e.target.value || undefined)}
            className={`rounded-md border bg-white px-2 py-1.5 text-sm ${FOCO}`}
          >
            <option value="">Todos</option>
            {[...new Set([...(dados?.profissionais ?? []), ...(profissional ? [profissional] : [])])].sort((a, b) => a.localeCompare(b, "pt-BR")).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <p aria-live="polite" className="ml-auto text-xs text-gray-500">
          {atualizadoEm ? `Atualizado às ${atualizadoEm}` : ""}
        </p>
      </div>

      <h2 className="mt-5 text-lg font-semibold capitalize">{dataAtual ? dataPorExtenso(dataAtual) : "Carregando…"}</h2>

      {erroAtual && dados && (
        <div role="alert" className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          Não foi possível atualizar agora. Mostrando os últimos dados carregados.
        </div>
      )}

      {!dados && erroAtual && (
        <div role="alert" className="mt-4 rounded-md bg-red-50 p-4 text-sm text-red-700">
          {erroAtual}{" "}
          <button type="button" onClick={() => setTentativa((n) => n + 1)} className={`font-medium underline ${FOCO}`}>
            Tentar de novo
          </button>
        </div>
      )}

      {!dados && !erroAtual && <p role="status" className="mt-4 text-sm text-gray-600">Carregando agenda…</p>}

      {dados && (
        <>
          <Legenda contagem={dados.contagemPorStatus} destaque={destaque} onDestaque={setDestaque} />
          {dados.agendamentos.length === 0 ? (
            <p className="mt-6 rounded-md border border-dashed p-8 text-center text-sm text-gray-600">Nenhum agendamento neste dia</p>
          ) : (
            <Grade agendamentos={dados.agendamentos} destaque={destaque} />
          )}
        </>
      )}
    </div>
  );
}

function Legenda({ contagem, destaque, onDestaque }: { contagem: Record<string, number>; destaque: GrupoStatus | null; onDestaque: (g: GrupoStatus | null) => void }) {
  const porGrupo = contarPorGrupo(contagem);
  return (
    <section aria-label="Legenda por status" className="mt-4">
      <ul className="flex flex-wrap gap-2">
        {GRUPOS_LEGENDA.filter((g) => g !== "respondido" || porGrupo[g] > 0).map((g) => {
          const v = visualDoGrupo(g);
          const ativo = destaque === g;
          return (
            <li key={g}>
              <button
                type="button"
                aria-pressed={ativo}
                title="Clique para destacar este status"
                onClick={() => onDestaque(ativo ? null : g)}
                className={`flex items-center gap-2 rounded-lg border bg-white px-3 py-1.5 text-sm ${ativo ? "ring-2 ring-gray-900" : ""} ${FOCO}`}
              >
                <span aria-hidden="true" className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${v.badge}`}>{v.icone}</span>
                <span>{v.rotulo}</span>
                <span className="font-semibold tabular-nums" aria-label={`${porGrupo[g]} agendamentos`}>{porGrupo[g]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Grade({ agendamentos, destaque }: { agendamentos: AgendamentoDoDia[]; destaque: GrupoStatus | null }) {
  const horas = agruparPorHora(agendamentos);
  return (
    <ol aria-label="Agendamentos do dia por horário" className="mt-4 divide-y rounded-lg border bg-white">
      {horas.map(({ hora, itens }) => (
        <li key={hora} className={`grid-cols-[3.5rem_1fr] gap-3 px-3 py-2 sm:grid sm:min-h-14 ${itens.length === 0 ? "hidden" : "grid"}`}>
          <span className="pt-1 text-sm font-medium text-gray-500">{rotuloHora(hora)}</span>
          <ul aria-label={`Agendamentos das ${rotuloHora(hora)}`} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {itens.map((a) => (
              <Bloco key={a.id} a={a} apagado={destaque !== null && visualDoStatus(a.status).grupo !== destaque} />
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function Bloco({ a, apagado }: { a: AgendamentoDoDia; apagado: boolean }) {
  const v = visualDoStatus(a.status);
  return (
    <li className={`min-w-0 rounded-md border border-l-4 bg-white p-2 text-sm shadow-sm sm:w-56 ${v.borda} ${apagado ? "opacity-40" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold tabular-nums">{a.horaLocal}</span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${v.badge}`}>
          <span aria-hidden="true">{v.icone}</span>
          {v.rotulo}
        </span>
      </div>
      <p className="mt-1 truncate font-medium">{a.pacienteNome}</p>
      <p className="truncate text-gray-700">{a.atendimento}</p>
      {a.profissional && <p className="truncate text-xs text-gray-500">{a.profissional}</p>}
      <p className="text-xs text-gray-500">{a.telefone}</p>
    </li>
  );
}
