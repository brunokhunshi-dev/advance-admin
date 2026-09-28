# Advance Admin

Painel administrativo separado do Advance Check, conectado ao mesmo projeto Firebase.

## Primeira versão

- Login com Firebase Authentication.
- Autorização por documento administradores/{UID}.
- Dashboard com contadores do Firestore.
- Visitas, clientes, profissionais e relatórios em modo somente leitura.
- PWA básico.
- firestore.rules como modelo de proteção para o painel.

## Administrador

No Firebase Authentication, crie ou use uma conta. Depois, no Firestore, crie:

administradores/{UID}

Com os campos:

nome: "Nome do administrador"
ativo: true

As regras do Firestore compartilhadas pelo Advance Check precisam ser ajustadas/mescladas para permitir esse fluxo.

## Estado atual

O painel é somente leitura nesta primeira etapa. Edição, exclusão, aprovação de fechamento manual e gestão de administradores serão adicionadas depois com permissões específicas.
