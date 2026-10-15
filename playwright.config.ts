import { defineConfig, devices } from "@playwright/test";

/**
 * E2E do painel. Sobe o app em dev na porta 3100 com PAINEL_SENHA definida (a do ambiente ou uma de teste),
 * faz login uma vez (e2e/auth.setup.ts) e reaproveita a sessão em `.auth/painel.json` (ignorado pelo git).
 * As rotas /api são simuladas dentro dos próprios specs; nenhum dado real é tocado.
 */
const PORTA = 3100;
export const SENHA_E2E = process.env.PAINEL_SENHA || "senha-e2e-local";
export const ESTADO_AUTH = ".auth/painel.json";

export default defineConfig({
  testDir: "./",
  testMatch: ["src/**/*.e2e.spec.ts", "e2e/auth.setup.ts"],
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORTA}`, trace: "retain-on-failure" },
  webServer: {
    command: `npx next dev -p ${PORTA}`,
    url: `http://localhost:${PORTA}/entrar`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { PAINEL_SENHA: SENHA_E2E, WHATSAPP_FAKE: "1" },
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      testMatch: /\.e2e\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: ESTADO_AUTH },
      dependencies: ["setup"],
    },
  ],
});
