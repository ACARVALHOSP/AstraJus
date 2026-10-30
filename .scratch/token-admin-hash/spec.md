# Token administrativo como hash no SQLite

Status: ready-for-agent

O campo de token no React permanece igual. Todas as validações administrativas (usuários, banco, integrações e páginas legadas/Google) consultam o hash SHA-256 na tabela credencial_administrativa. Tokens são aleatórios de 256 bits; o banco nunca recebe o valor original.

O comando `python server.py --gerar-token-admin` gera e mostra um novo token uma única vez e persiste somente o hash no banco configurado pelo diretório de dados. Executar novamente invalida o anterior imediatamente, sem reiniciar o serviço.

Para instalações antigas, a partida HTTP importa CNJ_MCP_ADMIN_TOKEN somente quando não há credencial no banco. Um valor antigo no ambiente não substitui um hash já configurado. Depois da migração, remover essa entrada do arquivo de ambiente de produção e recriar o container para eliminar a cópia em sua configuração.

Validação: testes de persistência sem ambiente, ausência de texto original no arquivo SQLite, importação idempotente, rotação, comando CLI e regressões de administração/integrações.
