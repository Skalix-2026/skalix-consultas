import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "@/db";
import { aplicarStatusMensagem, proximoStatus, type StatusMensagem, type StatusMeta } from "./status-mensagem";

describe("proximoStatus (nunca regride)", () => {
  it("avança na ordem normal", () => {
    expect(proximoStatus("pendente", "sent")).toBe("enviada");
    expect(proximoStatus("enviada", "delivered")).toBe("entregue");
    expect(proximoStatus("entregue", "read")).toBe("lida");
  });

  it("pula etapas (delivered antes de sent; read direto)", () => {
    expect(proximoStatus("pendente", "delivered")).toBe("entregue");
    expect(proximoStatus("enviada", "read")).toBe("lida");
  });

  it("eventos fora de ordem ou repetidos são ignorados", () => {
    expect(proximoStatus("lida", "delivered")).toBeNull();
    expect(proximoStatus("lida", "sent")).toBeNull();
    expect(proximoStatus("entregue", "sent")).toBeNull();
    expect(proximoStatus("enviada", "sent")).toBeNull();
    expect(proximoStatus("lida", "read")).toBeNull();
  });

  it("failed vale antes da entrega, mas não derruba entregue/lida", () => {
    expect(proximoStatus("pendente", "failed")).toBe("falhou");
    expect(proximoStatus("enviada", "failed")).toBe("falhou");
    expect(proximoStatus("entregue", "failed")).toBeNull();
    expect(proximoStatus("lida", "failed")).toBeNull();
  });

  it("falhou é terminal", () => {
    for (const e of ["sent", "delivered", "read", "failed"] as StatusMeta[]) expect(proximoStatus("falhou", e)).toBeNull();
  });
});

/** Banco falso de uma linha só: o filtro por wamid/status do `where` é coberto pela lógica de proximoStatus. */
function dbFalso(linha: { id: string; status: StatusMensagem } | null) {
  const sets: Record<string, unknown>[] = [];
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (linha ? [{ ...linha }] : []) }) }) }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        sets.push(v);
        if (linha && typeof v.status === "string") linha.status = v.status as StatusMensagem;
        return { where: () => ({ returning: async () => (linha ? [{ id: linha.id }] : []) }) };
      },
    }),
  };
  return { db: db as unknown as Db, sets, linha };
}

describe("aplicarStatusMensagem", () => {
  beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });

  it("sequência sent -> delivered -> read atualiza e grava atualizadaEm", async () => {
    const { db, sets, linha } = dbFalso({ id: "m1", status: "pendente" });
    expect(await aplicarStatusMensagem(db, { wamid: "w", status: "sent" })).toBe("atualizado");
    expect(await aplicarStatusMensagem(db, { wamid: "w", status: "delivered" })).toBe("atualizado");
    expect(await aplicarStatusMensagem(db, { wamid: "w", status: "read" })).toBe("atualizado");
    expect(linha!.status).toBe("lida");
    expect(sets.every((s) => s.atualizadaEm instanceof Date)).toBe(true);
  });

  it("ordem trocada: read chegou antes de delivered -> delivered é ignorado", async () => {
    const { db, linha } = dbFalso({ id: "m1", status: "enviada" });
    expect(await aplicarStatusMensagem(db, { wamid: "w", status: "read" })).toBe("atualizado");
    expect(await aplicarStatusMensagem(db, { wamid: "w", status: "delivered" })).toBe("ignorado");
    expect(linha!.status).toBe("lida");
  });

  it("failed grava código e mensagem do erro", async () => {
    const { db, sets } = dbFalso({ id: "m1", status: "enviada" });
    const r = await aplicarStatusMensagem(db, { wamid: "w", status: "failed", erroCodigo: 130497, erroMensagem: "Business account is restricted" });
    expect(r).toBe("atualizado");
    expect(sets[0]).toMatchObject({ status: "falhou", erroCodigo: 130497, erroMensagem: "Business account is restricted" });
  });

  it("failed: telefone dentro da mensagem de erro é mascarado antes de gravar", async () => {
    const { db, sets } = dbFalso({ id: "m1", status: "enviada" });
    await aplicarStatusMensagem(db, { wamid: "w", status: "failed", erroCodigo: 131026, erroMensagem: "Undeliverable to +55 11 90000-1234" });
    const gravado = String(sets[0].erroMensagem);
    expect(gravado).not.toContain("90000-1234");
    expect(gravado).toContain("(11) 9****-1234");
  });

  it("wamid desconhecido: ignora com log, sem erro e sem UPDATE", async () => {
    const { db, sets } = dbFalso(null);
    expect(await aplicarStatusMensagem(db, { wamid: "desconhecido", status: "sent" })).toBe("desconhecido");
    expect(sets).toHaveLength(0);
    expect(console.warn).toHaveBeenCalled();
  });
});
