# Skalix Consultas

Confirmação de consultas médicas por WhatsApp com IA. Plano: `docs/plano-21-dias.md`. Guia para o Claude Code: `CLAUDE.md`.

## Fase 0 — como começar (hoje)

Pré-requisitos: Node 20+, conta Supabase, conta Vercel, chave da Anthropic.

1. Inicializar o Next.js **nesta pasta, sem apagar os arquivos existentes**:
   ```bash
   npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
   ```
   Se perguntar sobre conflito de arquivos, escolha manter os existentes (CLAUDE.md, src/db, src/lib, src/ai, docs, evals, .env*).
2. Dependências do projeto:
   ```bash
   npm i drizzle-orm postgres zod @anthropic-ai/sdk inngest langfuse
   npm i -D drizzle-kit vitest @playwright/test tsx
   npx shadcn@latest init
   ```
3. Preencher `.env`: `DATABASE_URL` e chaves do Supabase; `ANTHROPIC_API_KEY`; `META_APP_SECRET`.
   Para desenvolver sem a Meta liberada: `WHATSAPP_FAKE=1`.
4. Scripts em `package.json`:
   ```json
   "typecheck": "tsc --noEmit",
   "test": "vitest run",
   "eval": "tsx evals/run.ts",
   "db:push": "drizzle-kit push",
   "db:studio": "drizzle-kit studio"
   ```
5. `npm run db:push` para criar as tabelas de `src/db/schema.ts`.
6. Webhook local: `npx ngrok http 3000` → em Meta → Skalix Consultas → WhatsApp → Configuração → URL
   `https://<ngrok>/api/webhooks/whatsapp`, verify token = `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, assinar o campo `messages`.
7. Abrir o Claude Code nesta pasta e pedir: "Leia CLAUDE.md e execute a Fase 0 do docs/plano-21-dias.md".

## Estrutura
- `src/db/schema.ts` — tabelas (clinicas, pacientes, lotes, agendamentos, mensagens, respostas, eventos_webhook, conhecimento)
- `src/lib/whatsapp.ts` — envio (real e fake), máscara de telefone
- `src/app/api/webhooks/whatsapp/route.ts` — recebimento de mensagens e status
- `src/ai/harness/classificar-resposta.ts` — harness de classificação (Zod + Claude)
- `evals/respostas.jsonl` — casos de teste da classificação
- `.claude/agents/` — subagentes do orquestrador
