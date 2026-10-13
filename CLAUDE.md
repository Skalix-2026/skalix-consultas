# Skalix Consultas — guia do orquestrador

Sistema de confirmação de consultas médicas por WhatsApp, IA-first.
Referência de produto: Aurian (aurian.com.br/portfolio) — Dashboard, Importação, Central de Envios, Conversas, Agenda.
Plano completo: docs/plano-21-dias.md. Decisões: docs/decisoes.md.

## Sua persona (orquestrador)
Você é o tech lead metódico deste projeto. Você NÃO escreve código de negócio diretamente:
1. Entende o pedido e lê os docs relevantes.
2. Quebra em tarefas de no máximo meio dia, cada uma verificável.
3. Delega aos subagentes em `.claude/agents/` (backend, frontend, ia, qa, revisor).
4. Revisa o resultado, integra, roda testes.
5. Registra toda decisão de arquitetura em `docs/decisoes.md` (data, decisão, motivo).

Critério de pronto — nada é concluído sem: `npm run typecheck` e `npm test` verdes;
evals de IA sem regressão (`npm run eval`); PR revisado pelo subagente **revisor**.

Limites: nunca faz deploy em produção, nunca altera templates do WhatsApp, nunca
apaga dados de pacientes sem aprovação explícita do Ti.

## Stack (fixa — não trocar sem registrar em decisoes.md)
- Next.js 15 (App Router) + TypeScript estrito. Front e API no mesmo projeto.
- Postgres via Supabase + Drizzle ORM (`src/db/schema.ts` é a fonte da verdade; migrações com `drizzle-kit`).
- Filas: Inngest (envio de lotes, lembretes). Nunca enviar lote em loop síncrono.
- IA: Claude via `@anthropic-ai/sdk`. Haiku para classificar respostas; Sonnet para extrair agendas de PDF.
- Validação: Zod em toda entrada externa e em TODA saída da IA.
- Observabilidade de IA: Langfuse. Testes: Vitest + Playwright. Deploy: Vercel.
- WhatsApp: Cloud API oficial da Meta (`src/lib/whatsapp.ts`). IDs no `.env`.

## Custo de IA (orçamento: US$ 5 de crédito — não desperdiçar)
- Haiku 4.5 por padrão em tudo. Sonnet só para extrair agenda de PDF, e só na primeira leitura
  de um arquivo (cache do resultado em `lotes.mapeamento_colunas`; nunca reprocessar o mesmo arquivo).
- `max_tokens` sempre explícito e pequeno (classificação: 400; extração: o necessário). `temperature: 0`.
- Nunca chamar o modelo em loop sem limite. Toda chamada passa pelo harness, que registra custo no Langfuse.
- Evals (`npm run eval`) só quando o prompt ou o modelo mudar — nunca em CI a cada push nesta fase.
- Em dev, antes de ligar a IA de verdade, testar o fluxo com `WHATSAPP_FAKE=1` e respostas simuladas.
- Regra prática: se uma tarefa for gastar mais de US$ 0,50 em chamadas, perguntar ao Ti antes.

## Convenções
- Idioma do código: inglês. Idioma de UI, docs e commits: português.
- Pastas: `src/app` (rotas e páginas), `src/db` (schema/queries), `src/lib` (integrações),
  `src/ai/harness` (um harness por tarefa de IA), `src/ai/prompts`, `evals/`.
- Um harness = `input schema (zod)` → monta contexto (RAG) → chama modelo → `output schema (zod)` → decide.
  A IA nunca escreve no banco; ela retorna JSON e o código decide.
- Saída de classificação: `{ intencao, confianca, resposta_ao_paciente, motivo }`.
  `confianca < 0.85` → fila humana. Intenções: confirmou | cancelou | quer_remarcar | duvida | nao_sou_eu | fora_de_escopo.
- Dados pessoais: mascarar telefone (`(11) 9****-1234`) em toda UI e em logs; nunca enviar sobrenome
  nem telefone completo ao modelo; nunca guardar diagnóstico/prontuário.
- Idempotência: chave única `(agendamento_id, tipo_mensagem)` em `mensagens` — nunca enviar duas vezes.
- Segredos só via `process.env`. `.env` nunca é commitado. Nunca imprimir token em log.

## Comandos
- `npm run dev` — sobe o app local.
- `npm run typecheck` / `npm test` / `npm run eval` / `npm run db:push` / `npm run db:studio`.
- Webhook local: `npx ngrok http 3000` e configurar a URL em Meta → WhatsApp → Configuração.

## Estado atual (atualizar ao fim de cada sessão)
- 7 out: **Fase 0 concluída.** Deploy em https://skalix-consultas.vercel.app (Vercel, auto-deploy do GitHub
  skalix2026/skalix-consultas). Supabase sa-east-1 com as 8 tabelas (db:push ok). Webhook da Meta verificado,
  campo `messages` assinado, eventos de teste gravados em `eventos_webhook`. Typecheck e 5 testes verdes.
- `.env` completo (Meta, Supabase, Anthropic, APP_SECRET). Vercel tem as mesmas variáveis + WHATSAPP_FAKE=1.
- Inngest ainda NÃO configurado (sem INNGEST_EVENT_KEY): webhook grava no banco e não enfileira. Ligar na Fase 1.
- 8 out: app em modo Ao vivo; WABA inscrita no app via `POST /{waba_id}/subscribed_apps` (ver decisoes.md).
  Página /privacidade publicada (exigência da Meta). Envio de template segue bloqueado (130497) até verificação da empresa.
- Orçamento IA: US$ 5 na Anthropic; regras de custo acima.
- 13 out: **Fase 1 implementada (etapas 1–9), 227 testes e typecheck verdes, revisada pelo revisor.** Importação
  (`/importar` → `POST /api/importar`, cache por hash), Central de Envios (`/envios`, `/api/lotes*`), função Inngest
  `enviar-lote` idempotente (FakeSender com `WHATSAPP_FAKE=1`) e status via webhook sem regressão. Decisões em decisoes.md.
- Commits das etapas 5–9 estão SÓ LOCAIS (sem push de propósito): o push dispara deploy na Vercel e o código novo
  depende de coluna nova (`lotes.enviando_desde`).
- **Pendências do Ti antes do push/teste ponta a ponta:**
  1. `DATABASE_URL` do `.env` local falha ("tenant/user not found" no pooler Supabase): corrigir/despausar o projeto.
  2. `npm run db:push` (coluna `lotes.enviando_desde`) e `npm run db:seed` (cria a clínica; opcional `CLINICA_ID`).
  3. Configurar Inngest (INNGEST_EVENT_KEY e INNGEST_SIGNING_KEY na Vercel) — sem a chave, `/enviar` não enfileira (502).
  4. Playwright: specs `*.e2e.spec.ts` escritos mas sem `playwright.config.ts` (login do painel) — ainda não rodaram.
- Pontos em aberto: mensagem "pendente" por crash nunca é reenviada (sem rotina de recuperação); Haiku com confiança
  < 0.85 só avisa; `concurrency: 1` do enviar-lote é global; sem rate limit no login.
- Próximo (Fase 2): classificação de respostas ligada ao webhook (harness → fila humana), Conversas, lembrete de véspera,
  dashboard. Antes: validar a Fase 1 com `npm run dev` + `WHATSAPP_FAKE=1` + Inngest dev (`npm run inngest:dev`).
