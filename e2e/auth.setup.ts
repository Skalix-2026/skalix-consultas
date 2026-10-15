import { expect, test as setup } from "@playwright/test";
import { ESTADO_AUTH, SENHA_E2E } from "../playwright.config";

setup("login no painel com PAINEL_SENHA", async ({ page }) => {
  await page.goto("/entrar");
  await page.getByLabel("Senha").fill(SENHA_E2E);
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/entrar/);
  await page.context().storageState({ path: ESTADO_AUTH });
});
