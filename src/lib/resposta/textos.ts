import { horaLocal } from "@/lib/agenda/dia";

/**
 * Resposta automática ao paciente: TEXTO FIXO por intenção (decisão 2026-10-16). O texto do modelo nunca chega
 * ao paciente (injeção de prompt); o modelo só classifica. Módulo puro: sem banco, sem IA.
 */

export type DadosResposta = {
  primeiroNome: string;
  dataHora: Date;
  /** Fuso da clínica (`clinicas.fuso`), ex.: "America/Sao_Paulo". */
  fuso: string;
  profissional?: string | null;
};

/** dd/MM/aaaa no fuso da clínica. */
export function dataLocal(instante: Date, fuso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: fuso, day: "2-digit", month: "2-digit", year: "numeric" }).format(instante);
}

/** Texto automático da intenção; `null` para qualquer intenção sem resposta automática. */
export function textoResposta(intencao: string, d: DadosResposta): string | null {
  const nome = d.primeiroNome.trim() || "Paciente";
  const data = dataLocal(d.dataHora, d.fuso);
  const hora = horaLocal(d.dataHora, d.fuso);
  const prof = d.profissional?.trim().slice(0, 80);
  if (intencao === "confirmou") {
    return `Obrigado, ${nome}! Sua consulta de ${data} às ${hora}${prof ? ` com ${prof}` : ""} está confirmada.`;
  }
  if (intencao === "cancelou") {
    return `Tudo certo, ${nome}. Sua consulta de ${data} às ${hora} foi cancelada. Se quiser remarcar, é só responder aqui.`;
  }
  return null;
}
