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

## Evento real do webhook (referência)
Mensagem recebida: `entry[].changes[].value.messages[] = { from, id (wamid), timestamp, type, text.body }`,
com `contacts[].profile.name` e `metadata.phone_number_id`.
Status: `entry[].changes[].value.statuses[] = { id, status: sent|delivered|read|failed, recipient_id, errors[] }`.
Erro observado: `130497 Business account is restricted from messaging users in this country` (conta não verificada).
