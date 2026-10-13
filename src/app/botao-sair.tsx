"use client";

export function BotaoSair() {
  async function sair() {
    await fetch("/api/sair", { method: "POST" }).catch(() => undefined);
    window.location.assign("/entrar");
  }
  return (
    <button type="button" onClick={sair} className="text-sm text-gray-600 underline hover:text-gray-900">
      Sair
    </button>
  );
}
