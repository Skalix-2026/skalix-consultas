/**
 * Normalização de telefones brasileiros para E.164 sem "+": `55` + DDD + número.
 * Celular: 9 dígitos começando com 9. Fixo: 8 dígitos começando com 2–5.
 * Sem DDD, DDD inexistente ou tamanho errado → null (a linha vai para a triagem).
 */

/** DDDs em uso no Brasil (Anatel). Qualquer outro (inclusive < 11) é rejeitado. */
const DDDS_VALIDOS = new Set<number>([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export function normalizarTelefone(bruto: string): string | null {
  if (typeof bruto !== "string") return null;
  let d = bruto.replace(/\D/g, "");
  // prefixo de longa distância nacional (0 + DDD, ex.: "011 98765-4321")
  if (d.length === 11 || d.length === 12) {
    if (d.startsWith("0")) d = d.slice(1);
  }
  let local: string;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) local = d.slice(2);
  else if (d.length === 10 || d.length === 11) local = d;
  else return null;

  const ddd = Number(local.slice(0, 2));
  const numero = local.slice(2);
  if (!DDDS_VALIDOS.has(ddd)) return null;
  if (numero.length === 9 && !numero.startsWith("9")) return null;
  if (numero.length === 8 && !/^[2-5]/.test(numero)) return null;
  return `55${local}`;
}

/**
 * Formas equivalentes de um telefone recebido da Meta para buscar no banco: a Meta às vezes entrega
 * celulares brasileiros sem o nono dígito (12 dígitos) e a agenda da clínica costuma tê-lo (13).
 * O primeiro item é sempre o número recebido (só dígitos).
 */
export function variantesTelefone(bruto: string): string[] {
  const d = bruto.replace(/\D/g, "");
  const out = [d];
  const normal = normalizarTelefone(d);
  if (normal && normal !== d) out.push(normal);
  if (d.startsWith("55")) {
    const ddd = d.slice(2, 4), num = d.slice(4);
    if (d.length === 13 && num.startsWith("9")) out.push(`55${ddd}${num.slice(1)}`);
    if (d.length === 12 && /^[6-9]/.test(num)) out.push(`55${ddd}9${num}`);
  }
  return [...new Set(out)];
}
