"use client";

import Link from "next/link";
import { useRef, useState, type DragEvent } from "react";
import { CartaoNumero } from "@/components/cartao-numero";
import { chamarApi, ErroApiDetalhado, type LinhaInvalida, type ResultadoImportacao } from "@/lib/ui/api";
import { formatarTamanho, validarArquivo } from "@/lib/ui/arquivo";

export function Importador() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);
  const [detalhe, setDetalhe] = useState<{ invalidas: LinhaInvalida[]; avisos: string[] } | null>(null);

  function escolher(f: File | undefined) {
    if (!f) return;
    const problema = validarArquivo(f);
    setErro(problema);
    setArquivo(problema ? null : f);
    setResultado(null);
    setDetalhe(null);
  }

  function soltar(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setArrastando(false);
    escolher(e.dataTransfer.files[0]);
  }

  async function importar() {
    if (!arquivo) return;
    setErro(null);
    setDetalhe(null);
    setCarregando(true);
    try {
      const dados = new FormData();
      dados.append("arquivo", arquivo);
      setResultado(await chamarApi<ResultadoImportacao>("/api/importar", { method: "POST", body: dados }));
    } catch (e) {
      if (e instanceof ErroApiDetalhado) setDetalhe({ invalidas: e.invalidas, avisos: e.avisos });
      setErro(e instanceof Error ? e.message : "Não foi possível importar o arquivo.");
    } finally {
      setCarregando(false);
    }
  }

  function recomecar() {
    setArquivo(null);
    setResultado(null);
    setErro(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="mt-6 space-y-6">
      <div aria-live="polite" role="status" className="sr-only">
        {carregando ? "Lendo arquivo" : resultado ? "Arquivo lido. Confira o resumo." : ""}
      </div>

      {!resultado && (
        <section aria-labelledby="titulo-upload">
          <h2 id="titulo-upload" className="sr-only">Enviar arquivo</h2>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setArrastando(true);
            }}
            onDragLeave={() => setArrastando(false)}
            onDrop={soltar}
            className={`rounded-lg border-2 border-dashed bg-white p-8 text-center ${arrastando ? "border-gray-900 bg-gray-50" : "border-gray-300"}`}
          >
            <label htmlFor="arquivo" className="cursor-pointer text-sm font-medium text-gray-900 underline">
              Escolher arquivo
            </label>
            <input
              ref={inputRef}
              id="arquivo"
              name="arquivo"
              type="file"
              accept=".xlsx,.xls,.csv,.pdf"
              disabled={carregando}
              onChange={(e) => escolher(e.target.files?.[0])}
              className="sr-only"
            />
            <p className="mt-2 text-sm text-gray-600">ou arraste e solte aqui</p>
            <p className="mt-1 text-xs text-gray-500">Excel, CSV ou PDF · até 5 MB</p>
            {arquivo && (
              <p className="mt-4 text-sm" data-testid="arquivo-escolhido">
                <span className="font-medium">{arquivo.name}</span> · {formatarTamanho(arquivo.size)}
              </p>
            )}
          </div>

          {erro && (
            <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
              {erro}
            </p>
          )}
          {detalhe && (
            <div className="mt-4 space-y-4">
              <DetalheTriagem invalidas={detalhe.invalidas} avisos={detalhe.avisos} />
            </div>
          )}

          <button
            type="button"
            onClick={importar}
            disabled={!arquivo || carregando}
            className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {carregando ? "Lendo arquivo…" : "Importar agenda"}
          </button>
          {carregando && (
            <p className="mt-2 text-sm text-gray-600">Lendo arquivo… PDF pode levar até um minuto.</p>
          )}
        </section>
      )}

      {resultado && <Triagem resultado={resultado} aoRecomecar={recomecar} />}
    </div>
  );
}

function DetalheTriagem({ invalidas, avisos }: { invalidas: LinhaInvalida[]; avisos: string[] }) {
  return (
    <>
      {avisos.length > 0 && (
        <div role="region" aria-label="Avisos" className="rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">Atenção antes de enviar</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {invalidas.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Linhas que não foram importadas</h3>
          <div className="mt-2 overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                <tr>
                  <th scope="col" className="px-3 py-2">Linha</th>
                  <th scope="col" className="px-3 py-2">Motivo</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invalidas.map((l) => (
                  <tr key={l.linha}>
                    <td className="px-3 py-2 font-medium">{l.linha}</td>
                    <td className="px-3 py-2">{l.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function Triagem({ resultado, aoRecomecar }: { resultado: ResultadoImportacao; aoRecomecar: () => void }) {
  const { invalidas, avisos } = resultado;
  return (
    <section aria-labelledby="titulo-triagem" className="space-y-5">
      <h2 id="titulo-triagem" className="text-lg font-semibold">Triagem da importação</h2>

      {resultado.reaproveitado && (
        <p role="status" className="rounded-md bg-blue-50 p-3 text-sm text-blue-800">
          Este arquivo já foi importado antes. Mostramos o resultado anterior, sem ler de novo.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <CartaoNumero titulo="Linhas no arquivo" valor={resultado.totalLinhas} />
        <CartaoNumero titulo="Válidas" valor={resultado.validas} destaque="verde" />
        <CartaoNumero titulo="Repetidas" valor={resultado.duplicadas} destaque={resultado.duplicadas ? "amarelo" : undefined} />
        <CartaoNumero titulo="Com problema" valor={invalidas.length} destaque={invalidas.length ? "vermelho" : undefined} />
      </div>

      <DetalheTriagem invalidas={invalidas} avisos={avisos} />

      <div className="flex flex-wrap gap-3">
        <Link
          href={`/envios?lote=${encodeURIComponent(resultado.loteId)}`}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Ir para a Central de Envios
        </Link>
        <button
          type="button"
          onClick={aoRecomecar}
          className="rounded-md border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Importar outro arquivo
        </button>
      </div>
    </section>
  );
}
