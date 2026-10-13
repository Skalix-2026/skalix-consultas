# Decisões de arquitetura

| Data | Decisão | Motivo |
| --- | --- | --- |
| 2026-10-01 | Stack TypeScript full-stack (Next.js + Supabase + Drizzle + Inngest + Claude) | Um idioma só; melhor para agentes de IA codarem; zero servidor |
| 2026-10-01 | WhatsApp Cloud API oficial (não Z-API/Evolution) | Clínica não pode arriscar banimento de número; status rastreável |
| 2026-10-02 | Skalix é dona do app Meta e do portfólio; cada empresa com CNPJ próprio tem portfólio próprio e compartilha a WABA com a Skalix via Parceiros | LGPD: cada clínica controladora dos próprios dados; Skalix operadora |
| 2026-10-02 | Tabela `clinicas` com `waba_id`/`phone_number_id`/`token_ref` desde o início | Multiunidade e multi-empresa sem refatorar |
| 2026-10-02 | Desenvolver com texto livre (janela 24 h) + `FakeSender` até a verificação da empresa | Erro 130497 bloqueia templates de conta não verificada no Brasil |
| 2026-10-05 | Prazo reduzido para 21 dias (5 → 26 out): sem Central de Vagas, PDF, multiunidade na UI, piloto de 2 semanas | Entrega contratada em 21 dias |
| 2026-10-05 | Token da Meta via usuário do sistema (permanente), nunca token pessoal | Não depende de ninguém da equipe; sobrevive a troca de senha |
| 2026-10-05 | Repositório dentro do OneDrive; `node_modules` instalado pelo terminal do Windows | Instalação via ambiente remoto é lenta no OneDrive; considerar mover para `C:\dev` se o sync incomodar |
| 2026-10-08 | Toda WABA nova precisa de `POST /{waba_id}/subscribed_apps` com o token do usuário do sistema; sem isso a Meta só entrega webhooks ao app interno de testes (WA DevX) e nada chega ao nosso endpoint | Causa raiz de 2 dias sem receber mensagens reais; entra no fluxo de implantação de clínica |
| 2026-10-08 | Exceção LGPD: na extração de agenda em PDF (Sonnet) o modelo recebe nomes completos; telefones são trocados por marcadores (`[TEL_1]`) antes da chamada e restaurados no código. A classificação de respostas continua só com primeiro nome, nunca nome completo nem telefone | O PDF é o formato real das clínicas e sem o nome não há como separar as linhas da agenda |
| 2026-10-08 | Importação Excel/CSV: mapeamento de colunas por heurística de sinônimos, sem IA; Haiku só quando a heurística falhar, recebendo apenas cabeçalhos + 3 linhas mascaradas. Resultado em cache em `lotes.mapeamento_colunas` por hash do arquivo | Sistema serve várias clínicas com layouts diferentes; custo de IA quase zero por arquivo e nunca reprocessar o mesmo arquivo |
| 2026-10-08 | Sem agenda real ainda: fixtures sintéticas (Excel, CSV, PDF) no padrão Aurian (nome, telefone, atendimento, profissional, data, hora) com nomes fictícios em `docs/exemplos/`. Trocar por agenda real anonimizada assim que houver | Não bloquear a Fase 1 |
| 2026-10-08 | Painel protegido por senha única (`PAINEL_SENHA` no `.env` + middleware com cookie HttpOnly assinado) até a Fase 3; Supabase Auth substitui o middleware depois | URL pública não pode expor dados de pacientes; evita retrabalho do login completo agora |
| 2026-10-08 | Proteção do painel em `src/proxy.ts` (convenção do Next 16, antigo middleware); lógica pura em `src/lib/painel-auth.ts`; `/api/entrar` responde JSON e o navegador redireciona; sem `PAINEL_SENHA` em produção → 503 (nunca libera). Rate limit do login fica para a Fase 3 | Seguir a regra "rota responde JSON tipado"; falhar fechado se a variável faltar na Vercel |
| 2026-10-08 | Leitura de planilhas com SheetJS `xlsx` 0.20.3 instalado do CDN oficial (cdn.sheetjs.com), `papaparse` para CSV e `unpdf` para texto de PDF | O `xlsx` do npm parou na 0.18.5 com CVEs abertas; `exceljs` não lê .xls legado, comum em sistemas de clínica |
| 2026-10-08 | Extração de PDF: linha individual inválida vira aviso (não derruba a chamada); limite de ~110 agendamentos por chamada (max_tokens ≤ 8000) com erro antes de chamar a API; texto > 60k caracteres é recusado, nunca truncado; texto do PDF entre `<agenda>` com instrução de ignorar comandos embutidos | Não pagar de novo uma chamada Sonnet por uma linha ruim; nunca pagar por resposta que seria cortada; mitigar prompt injection vindo do arquivo |
| 2026-10-08 | Modelos centralizados em `src/ai/modelos.ts` (Haiku 4.5 e Sonnet 4.6, ambos com `temperature: 0`). Haiku 5.5 (10× mais barato) fica como candidato: não aceita temperature 0, exige mudar a regra e rodar eval antes/depois | Trocar modelo em uma linha; regra de custo do CLAUDE.md |
| 2026-10-08 | Fuso horário por clínica (`clinicas.fuso`, IANA, padrão `America/Sao_Paulo`); horários da agenda convertidos com o offset real do fuso | Multiclínica: DDDs de MT/MS/RO/RR/AM (-04:00) e AC (-05:00) mandariam confirmação com 1 h de erro |
| 2026-10-08 | Linhas inválidas da importação guardam só as colunas mapeadas; colunas extras (CID, observações, CPF, convênio) nunca saem do parser nem são persistidas; UI só via `paraExibicao` (telefone mascarado, primeiro nome + inicial) | LGPD: nunca guardar diagnóstico/prontuário; telefone mascarado em toda UI |
| 2026-10-08 | Logout do painel não revoga o token (stateless, validade 12 h). Aceito até a Fase 3 (Supabase Auth); trocar `PAINEL_SENHA` invalida todas as sessões | Simplicidade da proteção provisória |
| 2026-10-08 | Projeto está em Next.js 16 (`package.json`), não 15 como dizia o CLAUDE.md; mantido | Versão já instalada e em produção; App Router igual |

## Evento real do webhook (referência)
Mensagem recebida: `entry[].changes[].value.messages[] = { from, id (wamid), timestamp, type, text.body }`,
com `contacts[].profile.name` e `metadata.phone_number_id`.
Status: `entry[].changes[].value.statuses[] = { id, status: sent|delivered|read|failed, recipient_id, errors[] }`.
Erro observado: `130497 Business account is restricted from messaging users in this country` (conta não verificada).
