import Link from "next/link";

export function CabecalhoPainel({ atual }: { atual: "importar" | "envios" }) {
  const item = (href: string, texto: string, ativo: boolean) => (
    <Link
      href={href}
      aria-current={ativo ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-sm ${ativo ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-100"}`}
    >
      {texto}
    </Link>
  );
  return (
    <header className="border-b bg-white">
      <nav aria-label="Principal" className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-3">
        <Link href="/" className="mr-4 font-semibold">
          Skalix Consultas
        </Link>
        {item("/importar", "Importar agenda", atual === "importar")}
        {item("/envios", "Central de Envios", atual === "envios")}
      </nav>
    </header>
  );
}
