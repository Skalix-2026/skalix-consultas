import { describe, it, expect } from "vitest";
import { Ev } from "./client";

describe("Ev.enviarLote", () => {
  it("aceita data yyyy-MM-dd ou nenhuma", () => {
    expect(Ev.enviarLote.data.parse({ loteId: "l1", data: "2026-10-14" })).toEqual({ loteId: "l1", data: "2026-10-14" });
    expect(Ev.enviarLote.data.parse({ loteId: "l1" })).toEqual({ loteId: "l1" });
  });
  it("recusa data em outro formato", () => {
    expect(() => Ev.enviarLote.data.parse({ loteId: "l1", data: "14/10/2026" })).toThrow();
    expect(() => Ev.enviarLote.data.parse({ loteId: "l1", data: "dddd-dd-dd" })).toThrow();
  });
});
