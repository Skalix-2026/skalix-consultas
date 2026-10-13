import { BotaoSair } from "./botao-sair";

export default function Home() {
  const checks = [
    ["Banco de dados", Boolean(process.env.DATABASE_URL)],
    ["WhatsApp (token)", Boolean(process.env.WHATSAPP_TOKEN)],
    ["Webhook verify token", Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)],
    ["Chave secreta do app Meta", Boolean(process.env.META_APP_SECRET)],
    ["Anthropic API", Boolean(process.env.ANTHROPIC_API_KEY)],
    ["Modo de envio", process.env.WHATSAPP_FAKE === "1" ? "FAKE (desenvolvimento)" : "Meta real"],
  ] as const;

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Skalix Consultas</h1>
        <BotaoSair />
      </div>
      <p className="mt-1 text-sm text-gray-600">Fase 0 · Fundação. Esta página some quando o painel entrar.</p>
      <ul className="mt-6 divide-y rounded-lg border bg-white">
        {checks.map(([label, ok]) => (
          <li key={label} className="flex items-center justify-between px-4 py-3 text-sm">
            <span>{label}</span>
            <span className={typeof ok === "string" ? "text-gray-700" : ok ? "text-green-700" : "text-red-600"}>
              {typeof ok === "string" ? ok : ok ? "configurado" : "faltando"}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
