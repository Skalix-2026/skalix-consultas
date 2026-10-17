import { expect, test, type Page } from "@playwright/test";

const A1 = "11111111-1111-4111-8111-111111111111";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const agora = Date.now();
const iso = (minAtras: number) => new Date(agora - minAtras * 60_000).toISOString();

const conversas = [
  { pacienteId: P2, nome: "João P.", telefone: "(11) 9****-5678", ultimaMensagem: { trecho: "Obrigado!", direcao: "recebida", quando: iso(300) }, agendamento: { id: "22222222-2222-4222-8222-222222222222", atendimento: "Retorno", dataHora: "2026-10-20T13:00:00Z", status: "confirmado" }, temExcecao: false },
  { pacienteId: P1, nome: "Maria S.", telefone: "(11) 9****-1234", ultimaMensagem: { trecho: "Preciso mudar o horário", direcao: "recebida", quando: iso(5) }, agendamento: { id: A1, atendimento: "Consulta", dataHora: "2026-10-20T12:30:00Z", status: "excecao" }, temExcecao: true },
];

function historico(status: string) {
  return {
    ok: true,
    paciente: { id: P1, nome: "Maria S.", telefone: "(11) 9****-1234" },
    eventos: [
      { tipo: "mensagem_enviada", id: "m1", quando: iso(60), tipoMensagem: "confirmacao", texto: "Olá Maria, confirma sua consulta?", status: "entregue", agendamentoId: A1 },
      { tipo: "resposta_paciente", id: "r1", quando: iso(5), texto: "Preciso mudar o horário", intencao: "quer_remarcar", confianca: 0.91, precisaHumano: true, resolvida: false, agendamentoId: A1 },
    ],
    agendamentos: [{ id: A1, atendimento: "Consulta", profissional: "Dr. Paulo", dataHora: "2026-10-20T12:30:00Z", status }],
    janelaAberta: true,
  };
}

async function simular(page: Page, acao: (corpo: Record<string, unknown>) => { status: number; json: unknown }) {
  const corpos: Record<string, unknown>[] = [];
  let status = "excecao";
  await page.route("**/api/conversas?*", (route) => route.fulfill({ json: { ok: true, conversas } }));
  await page.route(`**/api/conversas/${P1}`, (route) => route.fulfill({ json: historico(status) }));
  await page.route(`**/api/conversas/${P1}/acao`, (route) => {
    const corpo = route.request().postDataJSON() as Record<string, unknown>;
    corpos.push(corpo);
    const r = acao(corpo);
    if (r.status === 200 && corpo.acao === "confirmar") status = "confirmado";
    return route.fulfill({ status: r.status, json: r.json });
  });
  return corpos;
}

test("Conversas: exceção vem primeiro, abre histórico e confirma", async ({ page }) => {
  const corpos = await simular(page, () => ({ status: 200, json: { ok: true, acao: "confirmar", duplicada: false, statusAgendamento: "confirmado" } }));
  await page.goto("/conversas");

  const itens = page.getByRole("list", { name: "Pacientes" }).getByRole("listitem");
  await expect(itens.first()).toContainText("Maria S.");
  await expect(page.getByText("1 precisa de atenção")).toBeVisible();
  await expect(itens.first()).toContainText("Precisa de atenção");

  await itens.first().getByRole("button").click();
  await expect(page.getByRole("heading", { name: "Maria S." })).toBeVisible();
  const log = page.getByRole("log", { name: "Histórico da conversa" });
  await expect(log).toContainText("Olá Maria, confirma sua consulta?");
  await expect(log).toContainText("IA: Quer remarcar (91%)");

  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.getByText("Consulta confirmada.")).toBeVisible();
  expect(corpos[0]).toMatchObject({ acao: "confirmar", agendamentoId: A1 });
  expect(corpos[0].chaveIdempotencia).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByRole("list", { name: "Agendamentos" })).toContainText("Confirmado");
});

test("Conversas: responder com sucesso limpa o campo", async ({ page }) => {
  const corpos = await simular(page, () => ({ status: 200, json: { ok: true, acao: "responder", duplicada: false, statusAgendamento: "excecao" } }));
  await page.goto("/conversas");
  await page.getByRole("list", { name: "Pacientes" }).getByRole("button").first().click();
  await page.getByLabel("Responder").fill("Claro, vamos remarcar.");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByText("Mensagem enviada.")).toBeVisible();
  await expect(page.getByLabel("Responder")).toHaveValue("");
  expect(corpos[0]).toMatchObject({ acao: "responder", texto: "Claro, vamos remarcar.", agendamentoId: A1 });
});

test("Conversas: 409 fora_da_janela mostra o aviso e mantém o texto", async ({ page }) => {
  await simular(page, () => ({ status: 409, json: { ok: false, erro: "fora_da_janela", mensagem: "x" } }));
  await page.goto("/conversas");
  await page.getByRole("list", { name: "Pacientes" }).getByRole("button").first().click();
  await page.getByLabel("Responder").fill("Olá");
  await page.getByLabel("Responder").press("Control+Enter");
  await expect(page.getByRole("status").filter({ hasText: "Fora da janela de 24 h do WhatsApp" })).toBeVisible();
  await expect(page.getByLabel("Responder")).toHaveValue("Olá");
});

test("Conversas: estado vazio e erro com nova tentativa", async ({ page }) => {
  let falhar = true;
  await page.route("**/api/conversas?*", (route) =>
    falhar
      ? route.fulfill({ status: 500, json: { ok: false, erro: "erro_interno", mensagem: "Erro ao listar." } })
      : route.fulfill({ json: { ok: true, conversas: [] } }),
  );
  await page.goto("/conversas");
  await expect(page.getByRole("alert").filter({ hasText: "Erro ao listar." })).toBeVisible();
  falhar = false;
  await page.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(page.getByText("Nenhuma conversa ainda")).toBeVisible();
});
