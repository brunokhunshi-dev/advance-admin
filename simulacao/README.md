# Advance Admin — Simulação

Ambiente visual isolado para testar o painel com dados fictícios, sem autenticação e sem leitura/escrita no Firebase.

## Cenário padrão

- 10 promotores técnicos
- 6 assistentes técnicos
- 64 clientes fictícios
- 420 visitas geradas + uma pequena operação ativa no dia da simulação
- Visitas comerciais, treinamentos e assistências técnicas
- Relatórios fictícios vinculados às visitas concluídas
- CNPJs marcados como fictícios

## Populador

O campo **Seed** gera sempre o mesmo cenário quando o mesmo valor é utilizado. O seletor de volume permite testar densidades diferentes de dados.

As relações são coerentes: indicadores, ranking, clientes e históricos derivam da mesma base gerada pelo populador.

## Ferramentas disponíveis

Dashboard com filtros, gráficos e mapa; perfis de equipe; carteira de clientes; histórico de visitas; modais de detalhe; exportação CSV/JSON e impressão A4.

A simulação vive em `/simulacao/` e não importa `core.js`, Firebase Auth ou Firestore.
