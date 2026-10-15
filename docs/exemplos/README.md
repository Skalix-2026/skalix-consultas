# Agendas de exemplo (sintéticas)

Todos os arquivos desta pasta são **sintéticos**: nomes, clínicas e telefones são fictícios
(telefones no bloco `9 0000-xxxx`). Servem como fixtures dos testes de importação e foram gerados por
`npx tsx scripts/gerar-exemplos.ts` — edite o script, não os arquivos.

| Arquivo | Layout | Papel nos testes |
|---|---|---|
| `agenda-clinica-a.xlsx` | Paciente, Celular, Procedimento, Médico, Data (célula de data), Hora | heurística reconhece |
| `agenda-clinica-b.csv` | `;`, UTF-8 com BOM, DATA/HORA numa coluna só (`dd/MM/yyyy HH:mm`) | heurística reconhece |
| `agenda-clinica-c.csv` | `,`, cabeçalhos fora do padrão (Cliente, Contato WhatsApp, Serviço...) | heurística falha → fallback de IA |
| `agenda-clinica-d.pdf` | agenda do dia em tabela | extração de texto (IA de outro agente) |

Cada arquivo tem 15 linhas, 3 delas propositalmente ruins (telefone sem DDD, data/hora vazia, nome vazio).

**Trocar por agenda real anonimizada** assim que uma clínica fornecer uma (ver `docs/decisoes.md`, 2026-10-08).

## Datas: fixtures fixas x teste manual

As fixtures versionadas têm datas **fixas (13–15/10/2026)** porque os testes dependem delas. Para testar manualmente
(importar → enviar) sem cair em "Data no passado", gere uma cópia com datas relativas a hoje:

```
npm run exemplos:hoje   # grava em docs/exemplos/hoje/ (ignorada pelo git): amanhã, +2 e +3 dias
```
