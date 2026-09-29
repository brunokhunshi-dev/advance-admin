# Advance Admin

Painel administrativo do Advance Check conectado ao projeto Firebase `banco-de-dados-monitor`.

## Páginas

1. `dashboard.html` — indicadores, filtros, gráficos, mapa e ranking.
2. `team.html` — gestão da equipe, KPIs individuais, permissões e perfil de desempenho.
3. `visits.html` — atividades/visitas.
4. `clients.html` — clientes.
5. `reports.html` — relatórios.

`index.html` é exclusivamente a tela de login e diagnóstico.

## Equipe

A página Equipe possui duas tabs:

- Promotores
- Assistência

Os KPIs são calculados a partir da coleção `atividades`, usando `ptvId` para relacionar cada atividade ao ID do profissional em `promotores` ou `assistencia`.

Indicadores individuais:
- quantidade de visitas;
- visitas concluídas;
- taxa de conclusão;
- tempo total em campo;
- duração média por visita;
- clientes atendidos;
- atividade mais recente.

O perfil abre em modal e inclui informações de contato, indicadores, atividade dos últimos 7 dias e últimas visitas.

## Gestores

A página é acessível para contas ativas em `administradores/{UID}`.

No desenho atual:
- Eric — responsável pela Promotoria;
- Alessandro — responsável pela Assistência; login ainda pendente.

Quando Alessandro tiver uma conta no Firebase Authentication, basta criar `administradores/{UID}` com `ativo: true`.

## Gestão de acesso

Os documentos de `promotores` e `assistencia` podem receber:

```json
{
  "ativo": true,
  "telefone": "",
  "cargo": "",
  "permissoes": {
    "acessoApp": true,
    "agendarVisitas": true,
    "cadastrarClientes": true,
    "finalizarVisitas": true,
    "verHistorico": true
  }
}
```

O Advance Check principal já bloqueia o login quando `ativo == false` ou `permissoes.acessoApp == false`.

As permissões granulares ficam persistidas no perfil e podem ser conectadas aos controles específicos do app conforme cada módulo for sendo restringido.

## Exclusão segura

A exclusão definitiva não é executada pelo navegador.

As Firebase Functions em `functions/index.js` implementam:

- `requestTeamMemberDeletion` — gera e envia um código de 6 dígitos para o e-mail do profissional;
- `confirmTeamMemberDeletion` — valida o código, remove a conta no Firebase Auth, arquiva o perfil em `usuarios_excluidos` e remove o documento operacional;
- `updateTeamMemberEmail` — sincroniza alteração de e-mail entre Firestore e Firebase Authentication.

O histórico em `atividades` e `relatorios` é preservado.

### Configuração SMTP

Copie as variáveis descritas em `functions/.env.example` e configure a senha como secret:

```bash
firebase functions:secrets:set SMTP_PASSWORD
```

Depois publique as Functions e as regras:

```bash
firebase deploy --only functions,firestore:rules
```

**As regras e Functions presentes no GitHub não são publicadas no Firebase automaticamente.**

## Segurança

- A exclusão direta de profissionais é bloqueada nas regras do cliente.
- Códigos de confirmação ficam apenas em hash no Firestore.
- Códigos expiram em 10 minutos.
- Há limite de tentativas.
- Nenhuma senha SMTP deve ser commitada no repositório.
