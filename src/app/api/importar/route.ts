import { NextResponse, type NextRequest } from "next/server";
import { RespostaImportar, LIMITE_BYTES } from "@/lib/schemas-importar";
import { extensaoSuportada, importarAgenda, type DepsImportacao } from "@/lib/importacao/servico";
import { buscarClinicaPadrao, buscarLotePorHash, criarLoteComAgendamentos } from "@/db/queries/lotes";
import { extrairTextoPdf } from "@/lib/importacao/ler-arquivo";

/**
 * POST /api/importar — multipart/form-data, campo `arquivo` (xlsx/xls/csv/pdf, até 5 MB).
 * Autenticação: src/proxy.ts. Nunca registrar conteúdo de paciente em log.
 */

// Harnesses de IA só são carregados quando usados (a maioria dos arquivos mapeia por heurística, sem IA).
const depsReais = (): DepsImportacao => ({
  buscarLotePorHash,
  criarLote: criarLoteComAgendamentos,
  mapearColunas: async (...a) => (await import("@/ai/harness/mapear-colunas")).mapearColunas(...a),
  extrairAgendaPdf: async (...a) => (await import("@/ai/harness/extrair-agenda-pdf")).extrairAgendaPdf(...a),
  extrairTextoPdf,
});

function responder(status: number, corpo: RespostaImportar) {
  return NextResponse.json(RespostaImportar.parse(corpo), { status });
}
const erro = (status: number, e: Extract<RespostaImportar, { ok: false }>["erro"], mensagem: string) =>
  responder(status, { ok: false, erro: e, mensagem });

export async function POST(req: NextRequest) {
  try {
    // recusa cedo, sem ler o corpo, se o Content-Length já passa do limite (+ folga do multipart)
    const tamanhoDeclarado = Number(req.headers.get("content-length") ?? 0);
    if (tamanhoDeclarado > LIMITE_BYTES + 64 * 1024) return erro(413, "arquivo_grande", "Arquivo acima de 5 MB.");

    let form: FormData;
    try { form = await req.formData(); }
    catch { return erro(400, "arquivo_ausente", "Envie o arquivo no campo \"arquivo\" (multipart/form-data)."); }

    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File)) return erro(400, "arquivo_ausente", "Envie o arquivo no campo \"arquivo\".");
    if (arquivo.size > LIMITE_BYTES) return erro(413, "arquivo_grande", "Arquivo acima de 5 MB.");
    if (!extensaoSuportada(arquivo.name)) {
      return erro(415, "formato_invalido", "Formato não suportado. Envie .xlsx, .xls, .csv ou .pdf.");
    }
    if (arquivo.size === 0) return erro(422, "arquivo_vazio", "O arquivo está vazio.");

    const clinica = await buscarClinicaPadrao();
    if (!clinica) {
      return erro(409, "sem_clinica", "Nenhuma clínica cadastrada. Rode o seed (scripts/seed-clinica.ts) ou defina CLINICA_ID.");
    }

    const buffer = Buffer.from(await arquivo.arrayBuffer());
    const { status, corpo } = await importarAgenda(depsReais(), { buffer, nomeArquivo: arquivo.name, clinica });
    return responder(status, corpo);
  } catch (e) {
    console.error("[importar] erro inesperado", { erro: (e as Error).name });
    return erro(500, "erro_interno", "Não foi possível importar o arquivo.");
  }
}
