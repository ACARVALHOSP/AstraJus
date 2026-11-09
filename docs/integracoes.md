# Operação das integrações

A interface administrativa fica em `/admin/integracoes`, também acessível pela aba Integrações do painel. A autorização visual desta entrega cobre a página de integrações. O cadastro público tem prévia separada ainda não aprovada.

## Pré-requisitos e primeira implantação

1. Publicar juntos `integracoes.py`, `integracoes_http.py`, os novos arquivos estáticos, dependência cryptography e alterações de server.py/db.py/agenda_atividades.py/google_integracao.py/Dockerfile. Não publicar apenas o frontend.
2. Gerar uma chave Fernet com gerador criptográfico no servidor e configurá-la em `CNJ_INTEGRACOES_CHAVE`. Não colar a chave no chat, Git ou logs. Guardar cópia em armazenamento de segredos separado do banco e dos backups. Ela precisa sobreviver à recriação do container.
3. Manter temporariamente as variáveis atuais na primeira inicialização. Com a chave mestra configurada, o servidor cria backup SQLite consistente e cifrado em `backups-integracoes/`, importa credenciais idempotentemente e passa a lê-las exclusivamente do banco. Sem a chave mestra o modo legado continua funcionando; o editor informa indisponibilidade.
4. Conferir `/healthz`, acesso administrativo, serviços gerais, Drive e ambiente Asaas preservado. A importação não afirma que as credenciais foram testadas. Configurar a URL de retorno Google `https://SEU_HOST/integracoes/google/callback` no console Google.
5. Pelo token administrativo de recuperação, conceder a usuários ativos a permissão de administrar integrações. Usar o token individual de cada administrador no editor para auditoria nominal. O bootstrap é identificado como conta administrativa compartilhada persistente; não permite saber qual pessoa usou o segredo compartilhado.
6. Testar e ativar novas versões pelo editor. Tokens existentes nunca retornam ao navegador. SMTP testa TLS/autenticação sem enviar e-mail. reCAPTCHA exige resolver um desafio da site key candidata; validar apenas formato não habilita ativação. ZapSign faz GET de leitura, sem criação de documentos.
7. Depois de validar a restauração com a chave externa e confirmar o funcionamento, remover do arquivo de ambiente as variáveis migradas: `ASAAS_API_KEY`, `ASAAS_API_KEY_SANDBOX`, `ASAAS_AMBIENTE`, `DATAJUD_API_KEY`, `CNJ_GOOGLE_CLIENT_ID`, `CNJ_GOOGLE_CLIENT_SECRET`, `CNJ_GOOGLE_DRIVE_PASTA_RAIZ`, `CNJ_SMTP_HOST`, `CNJ_SMTP_PORTA`, `CNJ_SMTP_USUARIO`, `CNJ_SMTP_SENHA`, `CNJ_SMTP_REMETENTE`, `CNJ_RECAPTCHA_SITE_KEY`, `CNJ_RECAPTCHA_SECRET`, `ZAPSIGN_API_KEY`. Recriar o container uma vez para também removê-las do ambiente do processo. A leitura em modo banco não depende delas depois da importação.
8. Preservar no ambiente infraestrutura: chave mestra, chaves anteriores durante rotação, localização dos dados, token administrativo de recuperação, segredo de links assinados, URL pública, host/porta e demais parâmetros operacionais. Nunca retirar indiscriminadamente todo o `.env`.

## Drive e agendas

A conta institucional Google existente migra somente para Drive e seu refresh token passa a ser cifrado; a tabela legada é esvaziada e o SQLite compactado para remover páginas livres antigas. Cada usuário conecta o Calendar pelo próprio token no painel. Revogados não podem concluir autorização nem entram na sincronização periódica.

Vínculos antigos de atividades permanecem sem dono individual até ação explícita “Reconciliar vínculo institucional”, com consentimento da mesma conta Google original e verificação da identidade do evento. Essa ação preserva IDs e não cria eventos. Vínculos de outra conta não são adotados. Eventos históricos anteriores permanecem na linha do tempo; não são movidos automaticamente a agendas de usuários.

## Asaas

A credencial de cada ambiente é independente. Ativar uma chave de produção exige confirmação e não muda por si só o ambiente de cobranças. Usar outro ambiente nas cobranças exige configuração ativa validada e confirmação para produção. Os customer_id são guardados por cliente/ambiente; IDs legados pertencem somente ao ambiente ativo na migração.

## Rotação e recuperação

A rotação requer operação de infraestrutura: instalar a nova chave em `CNJ_INTEGRACOES_CHAVE` e manter as anteriores em `CNJ_INTEGRACOES_CHAVES_ANTERIORES`, separadas por vírgula; reiniciar o processo com o anel atualizado. Depois, o acesso de recuperação pode executar “Reencriptar com a chave mestra atual”. A operação é transacional e auditada. Remover chaves antigas só depois de confirmar leitura e garantir que os backups necessários continuam recuperáveis; backups anteriores permanecem cifrados pela chave da época.

Os arquivos `.sqlite.fernet` são snapshots íntegros cifrados com Fernet, não JSON. Restaurar em arquivo separado, usando a chave correspondente, verificar `PRAGMA integrity_check`, então testar serviços antes de substituir a base ativa. Nunca substituir o banco enquanto o servidor estiver gravando. Sem a chave externa, não é possível recuperar os segredos do backup.

Rollback: manter imagem anterior e backup do ambiente em local restrito fora do Git. Para voltar ao código legado, restaurar suas variáveis e a conexão Google institucional a partir do backup autorizado, antes de reiniciar. Não deixar o código antigo consultar uma base migrada sem planejar a recuperação Google. Desativar integrações é uma ação explícita com confirmação e controle de versão; nunca acontece automaticamente durante a migração.

## Limites da entrega

A aplicação atual tem um escritório institucional compartilhado. Esta mudança não promete segregação multi-tenant para clientes, processos e financeiro. ZapSign permite configurar/testar/ativar a API; envio para assinatura e webhooks não fazem parte desta spec.

A implementação local não configura automaticamente segredos ou publica código na VPS. Não houve ativação de chaves reais, criação de cobranças, envio de e-mails ou assinatura de documentos nos testes.

## Triagem de publicações (Jev, TypeSafe AI)

Apoio à leitura da caixa de Publicações recebidas: para cada publicação sugere o tipo (exige manifestação, só ciência, despacho, sentença), se abre prazo, o prazo-padrão provável e uma urgência de 1 a 10, e permite ordenar pelas mais urgentes. São **sugestões**: nada é criado, tratado, arquivado ou escondido por causa delas, e a data de um prazo continua vindo só do cálculo de prazos.

Configuração (variáveis de ambiente ou integrações):

| Variável | Valores |
| --- | --- |
| `CNJ_TRIAGEM_MODO` | `desligado` (padrão), `simulado` (demonstração por palavras-chave, sem enviar nada) ou `jev` |
| `TYPESAFE_API_KEY` | chave do Jev (obrigatória no modo `jev`), obtida em console.typesafe.ai/keys |
| `CNJ_TRIAGEM_MODELO` | opcional; padrão `jev-latest` |

- **Sigilo:** o que sai para o Jev é o tipo, a classe, o órgão, o tribunal e o texto da publicação **sem** nomes de partes e advogados (inteiros e sobrenomes soltos), CPF, CNPJ, e-mail, telefone, OAB e números de processo (`triagem.anonimizar`). Antes de ligar o modo `jev`, leia o DPA e a política de privacidade da TypeSafe (typesafe.ai/legal) e avalie a LGPD: as docs não informam região de processamento nem prazos de retenção (há retenção zero para contas enterprise).
- **Faixas:** acima de 90% de confiança a sugestão aparece em destaque; de 50% a 90% aparece como "revisar"; abaixo de 50% não aparece. Nunca há descarte.
- **Custo:** cobrança por token de entrada (US$ 0,042 por milhão); as quatro perguntas vão numa chamada só por publicação, e o resultado fica guardado (`publicacao_triagem`), então cada publicação é classificada uma vez.
- Uma rotina horária classifica as publicações novas não tratadas; o botão "Classificar esta página" faz o mesmo sob demanda.
- O adaptador do Jev foi escrito pela documentação (`POST https://api.typesafe.ai/v1/systemone`) e testado com respostas simuladas; ainda não foi exercitado com uma chave real.
