import { expect, test } from "@playwright/test";

const contagens = { inserido: 2 };
const lote = { id: "lote-1", arquivoNome: "agenda.csv", criadoEm: "2026-10-13T12:00:00Z", status: "importado", totalLinhas: 2, linhasValidas: 2, contagens };

test("Central de Envios: selecionar lote, confirmar e enviar", async ({ page }) => {
  await page.route("**/api/lotes", (route) => route.fulfill({ json: { ok: true, lotes: [lote] } }));
  await page.route("**/api/lotes/lote-1", (route) =>
    route.fulfill({
      json: {
        ok: true,
        lote,
        agendamentos: [
          { id: "a1", nome: "Maria S.", telefone: "(11) 9****-1234", atendimento: "Consulta", profissional: "Dr. Paulo", dataHora: "2026-10-14T12:30:00Z", status: "inserido", mensagemStatus: null, erroCodigo: null, erroMensagem: null },
          { id: "a2", nome: "João P.", telefone: "(11) 9****-5678", atendimento: "Retorno", profissional: null, dataHora: "2026-10-14T13:00:00Z", status: "inserido", mensagemStatus: null, erroCodigo: null, erroMensagem: null },
        ],
      },
    }),
  );
  let enviou = false;
  await page.route("**/api/lotes/lote-1/enviar", (route) => {
    enviou = true;
    return route.fulfill({ json: { ok: true } });
  });

  await page.goto("/envios?lote=lote-1");
  await expect(page.getByText("(11) 9****-1234")).toBeVisible();
  await expect(page.getByText("14/10/2026 09:30")).toBeVisible();
  await page.getByRole("button", { name: "Enviar confirmações" }).click();
  await expect(page.getByRole("dialog")).toContainText("Enviar para 2 pacientes?");
  await page.getByRole("button", { name: "Sim, enviar" }).click();
  await expect.poll(() => enviou).toBe(true);
});

test("Central de Envios: estado vazio", async ({ page }) => {
  await page.route("**/api/lotes", (route) => route.fulfill({ json: { ok: true, lotes: [] } }));
  await page.goto("/envios");
  await expect(page.getByText("Nenhuma agenda importada ainda")).toBeVisible();
  await expect(page.getByRole("link", { name: "Importar agenda" }).last()).toBeVisible();
});
