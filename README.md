# Advance Admin

Painel administrativo separado do Advance Check, conectado ao mesmo projeto Firebase.

## Estrutura

- `index.html` — login e diagnóstico técnico do Firebase.
- `dashboard.html` — dashboard analítico com filtros, indicadores, gráficos, mapa e ranking.
- `visits.html` — atividades/visitas.
- `clients.html` — clientes.
- `people.html` — assistência e promotores.
- `reports.html` — relatórios.
- `core.js` — Firebase, sessão administrativa, layout e utilitários compartilhados.
- Scripts de cada página separados por responsabilidade.
- `sw.js` — cache/PWA.

## Acesso administrativo

A conta precisa existir no Firebase Authentication e também ter:

`administradores/{UID}`

com:

```
nome: "Nome do administrador"
ativo: true
```

O UID usado como ID do documento deve ser o mesmo UID da conta no Firebase Authentication.

## Dashboard

O Dashboard lê as coleções existentes do Advance Check e permite filtrar por período, profissional, status, tipo e cliente. Os indicadores, gráficos, mapa e ranking são recalculados a partir do resultado filtrado.

O mapa usa as coordenadas de check-in/check-out gravadas nas atividades. A visualização de "Rotas da equipe" conecta as atividades geolocalizadas de cada profissional na ordem da data da visita.

## Segurança

O arquivo `firestore.rules` deste repositório é um modelo de regras para o painel e **não significa que essas regras estejam publicadas no projeto Firebase**. As regras em produção precisam ser revisadas e aplicadas separadamente.

A primeira versão do painel permanece somente leitura.
