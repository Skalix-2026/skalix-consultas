import { NextResponse } from "next/server";
import { listarLotes } from "@/db/queries/lotes";
import { RespostaListaLotes } from "@/lib/schemas-lotes";

export async function GET() {
  try {
    const lotes = await listarLotes();
    const body = RespostaListaLotes.parse({
      ok: true,
      lotes: lotes.map((l) => ({
        id: l.id, arquivoNome: l.arquivoNome, totalLinhas: l.totalLinhas, linhasValidas: l.linhasValidas,
        status: l.status, criadoEm: l.criadoEm.toISOString(), contagens: l.contagens,
      })),
    });
    return NextResponse.json(body);
  } catch (e) {
    console.error("[lotes] falha ao listar", (e as Error).name);
    return NextResponse.json<RespostaListaLotes>(
      { ok: false, erro: "erro_interno", mensagem: "Não foi possível listar os lotes." }, { status: 500 });
  }
}
