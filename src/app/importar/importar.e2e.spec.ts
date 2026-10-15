import { expect, test } from "@playwright/test";

// Fluxo principal: enviar arquivo -> triagem -> ir para a Central de Envios.
// As rotas /api são simuladas; o login do painel é feito por e2e/auth.setup.ts (ver playwright.config.ts).
test("importar agenda mostra a triagem e leva à Central de Envios", async ({ page }) => {
  await page.route("**/api/importar", (route) =>
    route.fulfill({
      json: {
        ok: true,
        loteId: "lote-1",
        reaproveitado: false,
        totalLinhas: 5,
        validas: 3,
        duplicadas: 1,
        invalidas: [{ linha: 4, motivo: "Telefone inválido", bruto: {} }],
        avisos: ["Data ambígua: assumimos dia/mês/ano."],
      },
    }),
  );
  await page.route("**/api/lotes**", (route) => route.fulfill({ json: { ok: true, lotes: [] } }));

  await page.goto("/importar");
  await page.setInputFiles("#arquivo", { name: "agenda.csv", mimeType: "text/csv", buffer: Buffer.from("a;b\n1;2") });
  await expect(page.getByTestId("arquivo-escolhido")).toContainText("agenda.csv");
  await page.getByRole("button", { name: "Importar agenda" }).click();

  await expect(page.getByText("Triagem da importação")).toBeVisible();
  await expect(page.getByText("Telefone inválido")).toBeVisible();
  await expect(page.getByText("Data ambígua")).toBeVisible();
  await page.getByRole("link", { name: "Ir para a Central de Envios" }).click();
  await expect(page).toHaveURL(/\/envios\?lote=lote-1/);
});

test("rejeita formato inválido no cliente", async ({ page }) => {
  await page.goto("/importar");
  await page.setInputFiles("#arquivo", { name: "foto.png", mimeType: "image/png", buffer: Buffer.from("x") });
  await expect(page.getByRole("alert").filter({ hasText: "Formato não aceito" })).toBeVisible();
});
