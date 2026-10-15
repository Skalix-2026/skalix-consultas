import { describe, expect, it } from "vitest";
import { ENVIO_PARADO_MS, envioTravado } from "./travado";
import { podeEnviar, textoBotaoEnviar } from "@/lib/ui/status";

const AGORA = Date.parse("2026-10-14T15:00:00Z");

describe("envioTravado", () => {
  it("só vale para lote em enviando", () => {
    expect(envioTravado("importado", null, AGORA)).toBe(false);
    expect(envioTravado("concluido", new Date(0), AGORA)).toBe(false);
  });
  it("recente (< 10 min) não está travado; depois de 10 min está", () => {
    expect(envioTravado("enviando", new Date(AGORA - 9 * 60_000), AGORA)).toBe(false);
    expect(envioTravado("enviando", new Date(AGORA - ENVIO_PARADO_MS - 1), AGORA)).toBe(true);
  });
  it("sem enviandoDesde ou data inválida conta como travado; aceita ISO string", () => {
    expect(envioTravado("enviando", null, AGORA)).toBe(true);
    expect(envioTravado("enviando", "lixo", AGORA)).toBe(true);
    expect(envioTravado("enviando", new Date(AGORA - 60_000).toISOString(), AGORA)).toBe(false);
  });
});

describe("botão da Central de Envios com lote em enviando", () => {
  it("fica desabilitado enquanto o envio anda e habilita (Reenviar pendentes) quando trava", () => {
    expect(podeEnviar("enviando", 3, false)).toBe(false);
    expect(podeEnviar("enviando", 3, true)).toBe(true);
    expect(podeEnviar("enviando", 0, true)).toBe(false);
    expect(textoBotaoEnviar("enviando")).toBe("Reenviar pendentes");
  });
});
