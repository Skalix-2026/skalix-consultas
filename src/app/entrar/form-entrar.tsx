"use client";

import { useState, type FormEvent } from "react";
import type { RespostaEntrar } from "@/app/api/entrar/route";

const MENSAGENS: Record<string, string> = {
  senha_incorreta: "Senha incorreta.",
  entrada_invalida: "Digite a senha.",
  painel_indisponivel: "Painel indisponível no momento. Avise o responsável técnico.",
};

export function FormEntrar({ de }: { de?: string }) {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const res = await fetch("/api/entrar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ senha, de }),
      });
      const body = (await res.json()) as RespostaEntrar;
      if (body.ok) {
        // `destino` já vem validado pelo servidor (só caminho interno).
        window.location.assign(body.destino);
        return;
      }
      setErro(MENSAGENS[body.erro] ?? "Não foi possível entrar.");
    } catch {
      setErro("Falha de conexão. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="mt-6 space-y-4">
      <label className="block text-sm font-medium text-gray-700">
        Senha
        <input
          type="password"
          name="senha"
          autoComplete="current-password"
          autoFocus
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
        />
      </label>
      {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
      >
        {enviando ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
