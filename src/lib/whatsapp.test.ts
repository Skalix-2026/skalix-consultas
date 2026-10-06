import { describe, it, expect } from "vitest";
import { mask } from "./whatsapp";

describe("mask", () => {
  it("mascara número brasileiro em E.164", () => {
    expect(mask("5511956515858")).toBe("(11) 9****-5858");
  });
  it("aceita número sem DDI", () => {
    expect(mask("11911700407")).toBe("(11) 9****-0407");
  });
});
