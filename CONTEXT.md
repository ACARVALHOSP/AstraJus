# cnj-processual

**Credencial administrativa**:
Token aleatório usado nas operações administrativas do sistema. Somente seu hash
SHA-256 é persistido no SQLite, na tabela `credencial_administrativa`. O token original
é apresentado uma única vez por `--gerar-token-admin` e colado no frontend, que o mantém
em memória. A variável legada `CNJ_MCP_ADMIN_TOKEN` serve apenas à importação inicial;
um hash existente no banco sempre prevalece. Gerar outro token invalida o anterior.

Servidor MCP e painel web (`/app`) para consulta processual judicial brasileira via APIs públicas do CNJ (DataJud e DJEN).

## Language

**Consulta**:
Busca pontual e manual, feita uma vez, contra a API do DataJud ou do DJEN a partir dos parâmetros informados pelo usuário no formulário do `/app`.
_Avoid_: Busca, pesquisa

**Histórico**:
Registro automático, local ao navegador (`localStorage`, por dispositivo, não sincronizado), das últimas consultas feitas pelo usuário no `/app`, para repetição rápida sem redigitar os campos.
_Avoid_: Log, cache de busca

**Favorito**:
Processo (tribunal + número) marcado manualmente pelo usuário no `/app`, guardado localmente, para acesso rápido independente do histórico.
_Avoid_: Salvo, marcado

**Monitoramento**:
Acompanhamento recorrente de um processo ou OAB, configurado pelo usuário autenticado no `/app`, que dispara verificações periódicas no DJEN (a cada 6 horas), persiste as publicações e avisa por e-mail (resumo + link) quando surge publicação nova. Diferente de uma Consulta: não é pontual, persiste no servidor atrelado ao usuário, tem limite de 5 por usuário, e expira automaticamente após 180 dias sem publicação nova (o prazo é renovado a cada publicação encontrada).
A coleta independe do SMTP; e-mails pendentes são preservados para nova tentativa. Captura por OAB também ocorre a cada 24 horas. Datas são persistidas em UTC; datas legadas sem fuso são interpretadas como UTC. Renovação explícita preserva ID e histórico. Vincular uma publicação a um processo não a marca como tratada: o tratamento exige revisão ou ação explícita sobre o status. A triagem de novas publicações converge para Publicações monitoradas; endpoints antigos de pendências permanecem por compatibilidade.
_Avoid_: Alerta, assinatura, inscrição (pode confundir com cobrança)


**Processo (gestão do escritório)**:
Entidade principal do cadastro, com partes, capa, atividades, publicações e movimentações.
Cada cadastro tem zero ou um número CNJ (20 dígitos, armazenado sem máscara).
O número é opcional enquanto ainda não existir. Recursos, apensos e execuções
são cadastros separados, relacionados por vínculos entre processos.
_Avoid_: Caso como nome da entidade na interface.

Os nomes físicos legados `casos`, `caso_id`, `caso_processos` e as rotas `/casos`
são mantidos por compatibilidade. A lista `numeros_processo` da API aceita no máximo
um item. A migração divide cadastros antigos com vários números: o primeiro em ordem
lexicográfica mantém o ID original; os demais recebem IDs e números internos novos,
com vínculo ao original. Capa, eventos e publicações identificados pelo CNJ acompanham
o cadastro correspondente. Clientes adicionais são copiados. Atividades, financeiro,
eventos sem CNJ e vínculos prévios ficam no original, evitando duplicação de obrigações.
A pasta Drive existente continua acessível pelos cadastros derivados.


**Atividade**:
Tarefa ou evento associado a um processo, com tipo, status, data, hora,
observações e checklist. Pode ter vínculo opcional com um evento de dia inteiro
no Google Calendar; a reconciliação desse vínculo é persistida no servidor.

**Notificação**:
Item do feed individual do usuário no painel, com estado de leitura e referência
ao registro de origem. Tem retenção de 180 dias e não armazena inteiro teor ou tokens.
Não se confunde com o Monitoramento, que configura a verificação recorrente no DJEN.


**Configuração de integração**:
Credenciais e parâmetros versionados de um serviço externo. Uma versão candidata não substitui a ativa até passar por teste e ativação administrativa. Credenciais são cifradas no banco e mascaradas nas APIs de leitura. Configurações gerais pertencem ao sistema; Asaas e Drive pertencem ao escritório institucional desta implantação.

**Conexão Google individual**:
Consentimento OAuth de um usuário ativo para o próprio Calendar. É separado da conexão institucional do Drive, inclusive tokens e cursores. Conectar a agenda não concede permissão de administrar APIs. Vínculos institucionais anteriores exigem reconciliação explícita pela conta original e nunca são atribuídos automaticamente a outro usuário.
