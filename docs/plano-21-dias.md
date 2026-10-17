# Plano de 21 dias — 5 a 26 de outubro de 2026

Escopo do MVP: importar agenda → conferir lote → enviar WhatsApp → IA classifica → agenda atualiza → dashboard.
Fora do escopo (fase seguinte): Central de Vagas, relatório PDF, multiunidade na UI, piloto longo.
Dependência externa: templates só enviam após a verificação da empresa na Meta (erro 130497). Até lá: texto livre + FakeSender.

| Dias | Fase | Entregas | Pronto quando |
| --- | --- | --- | --- |
| 1–3 (seg 5 – qua 7) | 0. Fundação | Next.js + Supabase + Drizzle na Vercel; schema aplicado; webhook recebendo e gravando em `eventos_webhook`; Inngest configurado; login (Supabase Auth) | Deploy no ar; mensagem enviada do celular aparece no banco |
| 4–8 (qui 8 – qua 14) | 1. Importar e enviar — ✅ concluída em 14 out | Upload PDF/Excel/CSV; Sonnet mapeia colunas; tela de triagem; Central de Envios por data; função Inngest de envio com idempotência; status via webhook; FakeSender em dev | Arquivo real vira lote conferido e "enviado" com status rastreado |
| 9–13 (qui 15 – qua 21) | 2. IA e agenda — concluída em 16 out (eval 100% em confirmou/cancelou; falta medir o tempo real < 10 s) | Harness de classificação ligado ao webhook; RAG com regras + exemplos; tela Conversas; fila de exceções; Agenda em calendário; eval ≥ 97% em confirmou/cancelou | Resposta do paciente muda o calendário em < 10 s |
| 14–18 (qui 22 – seg 26) | 3. Dashboard e entrega | Dashboard com 7 desfechos + gráfico de volume; controle de acesso; lembrete de véspera (se templates aprovados); testes e2e; checklist LGPD; documentação de operação | Clínica usa sem planilha paralela; entrega dia 26 |
| folga | 19–21 | Buffer para imprevistos e para a troca FakeSender → Meta real | |

Marcos: deploy Fase 0 em 7 out · Fase 1 concluída e primeiro lote "enviado" (FakeSender) em 14 out · IA classificando em 21 out · entrega 26 out.
Risco principal: verificação da Meta. Se não sair até 20 out, a entrega vai com envio por texto livre (janela 24 h) e os templates entram no dia da aprovação.
