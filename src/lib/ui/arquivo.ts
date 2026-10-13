export const TAMANHO_MAX_BYTES = 5 * 1024 * 1024;
export const EXTENSOES_ACEITAS = ["xlsx", "xls", "csv", "pdf"] as const;

export function extensaoDe(nome: string): string {
  const i = nome.lastIndexOf(".");
  return i < 0 ? "" : nome.slice(i + 1).toLowerCase();
}

/** Retorna mensagem de erro amigável ou null se o arquivo é aceitável. */
export function validarArquivo(arquivo: { name: string; size: number }): string | null {
  const ext = extensaoDe(arquivo.name);
  if (!(EXTENSOES_ACEITAS as readonly string[]).includes(ext)) {
    return "Formato não aceito. Envie um arquivo Excel (.xlsx, .xls), CSV ou PDF.";
  }
  if (arquivo.size === 0) return "O arquivo está vazio.";
  if (arquivo.size > TAMANHO_MAX_BYTES) return "O arquivo passa de 5 MB. Envie um arquivo menor.";
  return null;
}

export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
