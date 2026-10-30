# Administração de usuários e banco de dados

Status: ready-for-agent

## Proposta aprovada

Prévia isolada em `previa.html`, com dados fictícios e duas abas.

- Usuários: listar, filtrar, criar e revogar acessos, aproveitando o registro SQLite existente e a geração de tokens do servidor.
- Banco: resumo operacional, verificação de integridade e download de backup consistente, restritos ao administrador.
- Autorização administrativa validada no servidor, sem expor credenciais nas respostas ou persistir token administrativo no navegador.
- Interface React seguindo o Carbon já instalado. Preservar comportamento dos clientes existentes.

## Restrições

AGENTS.md exige aprovação explícita do mockup. Usuário autorizou continuar após a prévia e a proposta dos campos.

## Modelo implementado

Colunas tipadas na tabela usuarios: usuario_id, nome_completo, email, email_verificado_em, criado_em, atualizado_em, ultimo_acesso_em, nivel_acesso, status, criado_por, revogado_em, revogado_por. O login continua na coluna nome. O JSON legado é mantido sincronizado para compatibilidade. Migração idempotente preserva hashes e datas conhecidas; registros antigos recebem nível operador sem promoção automática.

Último acesso significa última requisição autenticada aceita, registrado em UTC com limitação de escrita a uma vez por minuto. Não há histórico completo de sessões nesta entrega. A confirmação de e-mail fica vazia até existir um fluxo de verificação; editar o endereço apaga eventual confirmação anterior.

Níveis: administrador, operador e consulta. Status pendente/bloqueado/revogado impede autenticação por token e OAuth. Consulta impede mutações HTTP e ferramentas MCP mutáveis. Mudanças de perfil não podem remover o próprio acesso administrativo nem o último administrador ativo. Revogação pelo novo painel não pode ser desfeita; bloqueio pode.

O histórico administrativo registra criações e edições feitas pelas novas APIs, com campos alterados e responsável, sem tokens/hashes. Não pretende reconstruir ações antigas da CLI ou do painel legado.

## Validação

Build TypeScript/Vite e lint. Oito testes novos cobrem migração, metadados, duplicidade de e-mail, status, revogação, proteção administrativa, consulta HTTP/MCP, OAuth, autorização e backup restaurável. Suíte de regressão test_unit e test_integracoes aprovada. Verificação no navegador usa banco temporário, sem dados reais.

## Publicação

Backend destinado a main; frontend destinado a astrajus-react, respeitando os deploys independentes. Criar e fazer merge dos dois PRs após validações.
