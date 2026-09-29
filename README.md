# Advance Admin

Painel administrativo do Advance Check conectado ao projeto Firebase `banco-de-dados-monitor`.

## Páginas

1. `dashboard.html` — indicadores, filtros, gráficos, mapa e ranking.
2. `team.html` — equipe, comparativos, perfis, permissões, desempenho e rotas.
3. `clients.html` — carteira de clientes, importância, distância, cadastro, edição e perfil.
4. `visits.html` — visitas comerciais, treinamentos e assistências técnicas, detalhes e relatórios integrados.

`index.html` é exclusivamente a tela de login e diagnóstico.

A antiga página separada de Relatórios foi removida. Relatórios antigos da coleção `relatorios` continuam compatíveis. Novos relatórios são organizados em `relatorios_comerciais`, `relatorios_treinamentos` e `relatorios_assistencia_tecnica`.

## Estrutura visual

O painel usa uma única família tipográfica (Outfit), navegação com SVGs próprios, superfícies sem sombras e sem bordas decorativas, espaçamentos padronizados e responsividade para desktop/mobile.

Os estados de carregamento usam shimmer e os botões exibem feedback visual durante operações assíncronas.

## Equipe

Promotores e Assistência possuem visualizações separadas, KPIs, comparativos e perfil individual.

O perfil individual inclui histórico, desempenho, mapa/linha do tempo das visitas e links diretos para cada atividade.

Membros desativados permanecem preservados no banco para manter o histórico, mas não aparecem nas tabelas e comparativos operacionais.

## Clientes

Clientes seguem o mesmo cadastro usado pelo Advance Check:

- cadastro com CNPJ via BrasilAPI;
- cadastro sem CNPJ como provisório;
- geocodificação do endereço;
- coordenadas `lat/lng`;
- importância comercial;
- status e histórico preservados.

## Visitas

A página separa:

- Visitas comerciais;
- Treinamentos;
- Assistências técnicas.

Cada tipo exibe dados próprios. O relatório é aberto em modal dentro da própria atividade. Assistências técnicas usam a estrutura preenchida do formulário, em vez de texto genérico.

As páginas usam deep links entre Equipe, Clientes e Visitas para manter a navegação conectada.

## Segurança

O acesso administrativo exige `administradores/{UID}` com `ativo: true`.

O arquivo `firestore.rules` no repositório é a configuração versionada do projeto, mas alterações no GitHub não são publicadas automaticamente no Firebase.
