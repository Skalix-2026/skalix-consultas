import { expect, test, type Page } from "@playwright/test";

type Ag = { id: string; horaLocal: string; atendimento: string; profissional: string | null; status: string; pacienteNome: string; telefone: string };

const ag = (id: string, horaLocal: string, status: string, pacienteNome: string, profissional: string | null, atendimento = "Consulta"): Ag =>
  ({ id, horaLocal, atendimento, profissional, status, pacienteNome, telefone: "(11) 9****-1234" });

const DIA: Ag[] = [
  ag("1", "08:00", "inserido", "Ana P.", "Dra. Ana"),
  ag("2", "09:00", "enviado", "Bruno C.", "Dr. Paulo"),
  ag("3", "09:30", "confirmado", "Carla M.", "Dra. Ana"),
  ag("4", "09:30", "cancelado", "Davi R.", "Dr. Paulo"),
  ag("5", "10:00", "excecao", "Elisa T.", "Dra. Ana"),
  ag("6", "21:00", "sem_resposta", "Fabio L.", "Dr. Paulo", "Retorno"),
];

function montar(data: string, lista: Ag[], profissional?: string | null) {
  const filtrada = profissional ? lista.filter((a) => a.profissional === profissional) : lista;
  const contagemPorStatus: Record<string, number> = {};
  for (const a of filtrada) contagemPorStatus[a.status] = (contagemPorStatus[a.status] ?? 0) + 1;
  return {
    ok: true, data,
    profissionais: [...new Set(lista.map((a) => a.profissional).filter(Boolean))].sort(),
    agendamentos: filtrada.map((a) => ({ ...a, dataHora: `${data}T12:00:00.000Z` })),
    contagemPorStatus,
  };
}

/** Simula /api/agenda; devolve as URLs pedidas. O dia 2026-10-17 é vazio. */
async function simular(page: Page) {
  const pedidos: URL[] = [];
  await page.route("**/api/agenda*", (route) => {
    const url = new URL(route.request().url());
    pedidos.push(url);
    const data = url.searchParams.get("data") ?? "2026-10-16";
    const lista = data === "2026-10-17" ? [] : DIA;
    return route.fulfill({ json: montar(data, lista, url.searchParams.get("profissional")) });
  });
  return pedidos;
}

test("Agenda: dia com vários status mostra rótulos, legenda com contagem e telefone mascarado", async ({ page }) => {
  await simular(page);
  await page.goto("/agenda?data=2026-10-16");

  await expect(page.getByRole("heading", { name: "sexta-feira, 16 de outubro de 2026" })).toBeVisible();
  const grade = page.getByRole("list", { name: "Agendamentos do dia por horário" });
  await expect(grade).toContainText("Aguardando envio");
  await expect(grade).toContainText("Enviado");
  await expect(grade).toContainText("Confirmado");
  await expect(grade).toContainText("Cancelado");
  await expect(grade).toContainText("Precisa de atenção");
  await expect(grade).toContainText("Sem resposta");
  await expect(grade).toContainText("(11) 9****-1234");
  // 21h fora da faixa padrão expande a grade
  await expect(grade).toContainText("21h");
  // dois agendamentos no mesmo horário, lado a lado na mesma linha
  await expect(page.getByRole("list", { name: "Agendamentos das 09h" }).getByRole("listitem")).toHaveCount(3);

  const legenda = page.getByRole("region", { name: "Legenda por status" });
  await expect(legenda.getByRole("button", { name: /Confirmado/ })).toContainText("1");
  await expect(page.getByText(/Atualizado às \d{2}:\d{2}:\d{2}/)).toBeVisible();

  // destacar um status é opcional e acessível
  await legenda.getByRole("button", { name: /Cancelado/ }).click();
  await expect(legenda.getByRole("button", { name: /Cancelado/ })).toHaveAttribute("aria-pressed", "true");
});

test("Agenda: ◀ e ▶ mudam ?data= e refazem a busca; dia vazio tem mensagem", async ({ page }) => {
  const pedidos = await simular(page);
  await page.goto("/agenda?data=2026-10-16");
  await expect(page.getByText("Ana P.")).toBeVisible();

  await page.getByRole("button", { name: "Próximo dia" }).click();
  await expect(page).toHaveURL(/data=2026-10-17/);
  await expect(page.getByText("Nenhum agendamento neste dia")).toBeVisible();
  expect(pedidos.some((u) => u.searchParams.get("data") === "2026-10-17")).toBe(true);

  await page.getByRole("button", { name: "Dia anterior" }).click();
  await expect(page).toHaveURL(/data=2026-10-16/);
  await expect(page.getByText("Ana P.")).toBeVisible();
});

test("Agenda: filtro por profissional vai para o servidor e para a URL", async ({ page }) => {
  const pedidos = await simular(page);
  await page.goto("/agenda?data=2026-10-16");
  await expect(page.getByText("Bruno C.")).toBeVisible();

  await page.getByLabel("Profissional").selectOption("Dra. Ana");
  await expect(page).toHaveURL(/profissional=Dra\.\+Ana|profissional=Dra\.%20Ana/);
  await expect(page.getByText("Bruno C.")).toHaveCount(0);
  await expect(page.getByText("Ana P.")).toBeVisible();
  expect(pedidos.at(-1)?.searchParams.get("profissional")).toBe("Dra. Ana");
});

test("Agenda: atualiza sozinha a cada 10 s", async ({ page }) => {
  await page.clock.install();
  const pedidos = await simular(page);
  await page.goto("/agenda?data=2026-10-16");
  await expect(page.getByText("Ana P.")).toBeVisible();
  const antes = pedidos.length;

  await page.clock.runFor(10_500);
  await expect.poll(() => pedidos.length).toBeGreaterThan(antes);
  await expect(page.getByText(/Atualizado às/)).toBeVisible();
});

test("Agenda: erro mostra aviso e permite tentar de novo", async ({ page }) => {
  let falhar = true;
  await page.route("**/api/agenda*", (route) =>
    falhar
      ? route.fulfill({ status: 500, json: { ok: false, erro: "erro_interno", mensagem: "Não foi possível carregar a agenda." } })
      : route.fulfill({ json: montar("2026-10-16", DIA) }),
  );
  await page.goto("/agenda?data=2026-10-16");
  await expect(page.locator("main [role=alert]")).toContainText("Não foi possível carregar a agenda.");
  falhar = false;
  await page.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(page.getByText("Ana P.")).toBeVisible();
});

test("Agenda: erro de rede depois de carregar mantém a grade", async ({ page }) => {
  await page.clock.install();
  let falhar = false;
  await page.route("**/api/agenda*", (route) => (falhar ? route.abort() : route.fulfill({ json: montar("2026-10-16", DIA) })));
  await page.goto("/agenda?data=2026-10-16");
  await expect(page.getByText("Ana P.")).toBeVisible();
  falhar = true;
  await page.clock.runFor(10_500);
  await expect(page.locator("main [role=alert]")).toContainText("Não foi possível atualizar agora");
  await expect(page.getByText("Ana P.")).toBeVisible();
});
