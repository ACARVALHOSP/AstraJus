# Integrações configuráveis no banco
Status: ready-for-human
Data: 2026-10-28

## Objetivo
Administrar integrações no painel, migrando credenciais e parâmetros de serviços do ambiente para SQLite, com atualização sem reinício. Prévia das integrações aprovada pelo usuário em 2026-10-28 ("implementar tudo"). Cadastro Carbon segue em revisão visual separada.

## Decisões confirmadas
- Drive: conexão institucional do escritório.
- Asaas: por escritório; credenciais e estado independentes para homologação e produção.
- Google Calendar: conexão por usuário.
- ZapSign: configuração geral, com entrada de API no frontend administrativo.
- DataJud, SMTP, reCAPTCHA e cadastro OAuth Google: gerais do sistema.
- Gestão de configurações restrita a administradores; credenciais existentes somente mascaradas.
- Auditoria registra autor e instante, sem segredo.
- Testar conexão antes de ativar nova configuração.

## Fronteira e permissões
O backend deve autorizar cada leitura, teste e alteração; esconder controles não substitui autorização. Administrador do sistema gerencia integrações gerais; administrador do escritório gerencia somente seu escritório. A conexão pessoal Calendar usa OAuth com consentimento do titular: administrador não pode assumir identidade de outro usuário. Não expor credenciais ao usuário comum. A navegação individual para consentimento não concede permissão de administrar APIs.
O código inspecionado não evidenciou segregação por escritorio_id; validar modelo de usuários antes da implementação. Se a implantação tiver escritório único, criar identidade institucional explícita e vínculo com usuários; não inventar isolamento entre escritórios sem autorização e testes. A gestão atual via token administrativo precisa ser vinculada a uma identidade persistente para auditoria confiável; não aceitar autor fornecido no corpo da requisição.

## Persistência proposta
- integracoes_config: provedor, escopo (sistema/escritorio/usuario), dono obrigatório e normalizado, ambiente, versão, parâmetros permitidos, segredo criptografado, key_id, estado, criado_por/em, atualizado_por/em.
- integracoes_testes: ID de teste, versão candidata, autor, instante, resultado sanitizado, expiração e capacidades verificadas.
- integracoes_auditoria: ator persistente, ação, provedor, escopo/dono, ambiente, versões anterior/nova, instante UTC e resultado. Sem valores secretos, tokens, cabeçalhos, corpo externo ou hashes de credenciais.
- conexoes_google: finalidade Drive/Calendar, dono, conta, refresh token cifrado e cursores independentes. Não reutilizar cursor institucional para agendas individuais.
- Índice único composto por provedor/escopo/dono/ambiente/versão; somente uma versão ativa por combinação. Evitar NULL no dono da configuração geral para não permitir duplicatas SQLite.
Segredos com criptografia autenticada por biblioteca mantida; chave mestra externa ao banco, separada de backups, key_id para rotação. Nunca manter chave de cifragem no mesmo banco. Metadados mascarados não permitem recuperar o segredo pela API.

## Fluxo de alteração
1. Exibir estado, máscara fixa, ambiente/escopo, último teste e autor/data da alteração.
2. Campo de substituição vazio; vazio preserva credencial vigente. Remoção requer ação explícita separada.
3. Salvar candidato cifrado sem ativação. Testar no servidor; navegador recebe somente resultado sanitizado.
4. Ativação exige teste aprovado da mesma versão, mesmo escopo e ambiente, não expirado (proposta: 10 minutos). Alterar qualquer parâmetro invalida teste.
5. Trocar versão ativa em transação com controle otimista; conflito pede recarregamento. Falha externa mantém versão vigente. Registrar auditoria também de teste/ativação recusada.
6. Disponibilizar nova configuração às chamadas seguintes; leitores não mantêm cache sem invalidação.
7. Produção Asaas exige confirmação explícita identificando ambiente; não fazer migração automática de homologação para produção.
Estados: não configurado, candidato pendente, testando, teste aprovado, teste falhou, ativo, desativado. Configurado não significa validado; ativo não garante disponibilidade contínua.

## Testes por serviço
Asaas e ZapSign: chamada autenticada de leitura, sem criar cobrança, documento ou assinatura. Implementar com endpoints e permissões verificados na documentação oficial antes de codar.
Google: validar aplicação OAuth separadamente da autorização da conta; Drive testa acesso à pasta institucional, Calendar testa calendário do titular. Expiração/revogação deve solicitar reconexão.
SMTP: validar conexão/autenticação; envio real somente por ação separada com destinatário explícito.
DataJud: consulta mínima de leitura. reCAPTCHA: só declarar validação completa com token de desafio real; validação de formato não comprova autenticação. Botão e texto devem indicar precisamente o alcance do teste; não simular sucesso onde o provedor não oferece verificação independente.
ZapSign nesta entrega: cadastrar, testar e ativar configuração. Criação de documentos, assinantes, envio e webhooks exigem escopo posterior.
URLs externas fixas ou restritas por provedor; não aceitar URLs arbitrárias que possibilitem SSRF. Timeouts, limites de teste e mensagens sem dados pessoais.

## Migração
Importação administrativa única das variáveis atuais, cifrada e idempotente; não importar valores por logs ou comandos que os imprimam. Preservar ambiente ativo atual. Credenciais importadas ficam identificadas como não testadas; não interromper integração em uso antes de validação e troca controlada.
Migrar conexão institucional Google existente para Drive; agendas individuais exigem novo consentimento e reconciliação dos vínculos existentes, evitando duplicação e remoção de eventos. Não mover automaticamente eventos de usuários para contas diferentes.
Após validação e recuperação ensaiada, remover variáveis migradas do servidor e caminho de leitura legado. Manter no ambiente infraestrutura/bootstrap: chave mestra, localização do banco, host/porta, segurança e recuperação administrativa. Não migrar indiscriminadamente todo o .env.
Backup antes da migração, restauração testada com chave externa e rollback documentado. Jamais persistir credenciais reais na spec, mockup, Git ou auditoria.

## Interface Carbon
Manter tema e CSS Carbon existentes. Catálogo agrupado por escopo; editor ao lado em desktop e abaixo em mobile; formulários com labels, ajuda, máscara e botões Testar conexão / Ativar configuração. Histórico de alterações sem segredos. Feedback inline com aria-live; foco visível; status textual; controles operáveis por teclado. Produção e homologação sempre identificadas. Mockup separado, com dados fictícios e resultados explicitamente simulados.

## Critérios de aceite
- Usuário sem autorização recebe 403 em leitura administrativa, escrita, teste e ativação, inclusive chamadas diretas.
- Isolamento entre donos, ambientes e finalidades Google comprovado.
- Banco e backup não contêm credenciais em texto puro; APIs de leitura e logs não revelam segredo.
- Falha, timeout, teste expirado ou candidato alterado impedem ativação e preservam versão atual.
- Requisições concorrentes não sobrescrevem configuração silenciosamente.
- Troca tem efeito sem reiniciar; auditoria identifica autor real e instante.
- Calendar de um usuário não acessa agenda de outro; Drive continua institucional.
- ZapSign aparece no painel administrativo e usa integração real de leitura para teste, sem efeitos externos de assinatura.
- Migração é idempotente e recuperação/rollback preservam dados e credenciais.

## Referências consultadas
Carbon: https://carbondesignsystem.com/building-blocks/core/components/text-input/guidelines/#password-input
Carbon: https://carbondesignsystem.com/building-blocks/core/components/notification/guidelines/#inline
Código atual: server.py (_asaas_config e inicialização OAuth/SMTP), db.py (RegistroIntegracaoGoogle), static/app.html (aba-integracoes).

## Decisões da implementação
- Implantação institucional única existente: escopo escritório usa dono institucional explícito. Não foi introduzido suporte multi-tenant no restante da gestão.
- Administradores individuais são usuários ativos com permissão administrativa persistida, concedida/revogada somente pelo token de recuperação. Auditoria identifica o usuário; recuperação usa identidade bootstrap persistente.
- Usuário autorizou expressamente desativação e rotação de chave. Rotação usa anel de chaves Fernet externas; não há material de chave no banco.
- Vínculos de atividade institucionais permanecem intactos até reconciliação explícita pela mesma conta Google.
- Cadastros Asaas são separados por ambiente para evitar reutilização de customer_id entre sandbox e produção.

## Validação e estado final
Implementação local: concluída. Validação principal: 287 testes aprovados; verificação final do módulo de integrações: 19 aprovados, incluindo proteção da senha SMTP ao alterar destino. Chrome desktop/mobile verificado, sem overflow horizontal e sem erros de JavaScript. Backup cifrado e restauração testados com banco temporário. Código e variáveis reais da VPS não foram alterados nesta implementação. Cadastro Carbon não aplicado: usuário pediu ajustar a prévia, detalhes ainda pendentes.

Documentação oficial dos adaptadores:
- https://docs.zapsign.com.br/documentos/listar-documentos
- https://docs.asaas.com/reference/listar-clientes
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get
- https://developers.google.com/recaptcha/docs/verify
