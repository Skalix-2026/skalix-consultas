const COR = { verde: "text-green-700", amarelo: "text-amber-700", vermelho: "text-red-700" } as const;

export function CartaoNumero({
  titulo,
  valor,
  destaque,
}: {
  titulo: string;
  valor: number;
  destaque?: keyof typeof COR;
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-sm text-gray-600">{titulo}</p>
      <p className={`mt-1 text-3xl font-semibold ${destaque ? COR[destaque] : "text-gray-900"}`}>{valor}</p>
    </div>
  );
}
