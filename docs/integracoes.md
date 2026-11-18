# Operação das integrações

A interface administrativa fica em `/admin/integracoes`, também acessível pela aba Integrações do painel. A autorização visual desta entrega cobre a página de integrações. O cadastro público tem prévia separada ainda não aprovada.

## Pré-requisitos e primeira implantação

1. Publicar juntos `integracoes.py`, `integracoes_http.py`, os novos arquivos estáticos, dependência cryptography e alterações de server.py/db.py/agenda_atividades.py/google_integracao.py/Dockerfile. Não publicar apenas o frontend.
2. Gerar uma chave Fernet com gerador criptográfico no servidor e configurá-la em `CNJ_INTEGRACOES_CHAVE`. Não colar a chave no chat, Git ou logs. Guardar cópia em armazenamento de segredos separado do banco e dos backups. Ela precisa sobreviver à recriação do container.
3. Manter temporariamente as variáveis atuais na primeira inicialização. Com a chave mestra configurada, o servidor cria backup SQLite consistente e cifrado em `backups-integracoes/`, importa credenciais idempotentemente e passa a lê-las exclusivamente do banco. Sem a chave mestra o modo legado continua funcionando; o editor informa indisponibilidade.
4. Conferir `/healthz`, acesso administrativo, serviços gerais, Drive e ambiente Asaas preservado. A importação não afirma que as credenciais foram testadas. Configurar a URL de retorno Google `https://SEU_HOST/integracoes/google/callback` no console Google.
5. Pelo token administrativo de recuperação, conceder a usuários ativos a permissão de administrar integrações. Usar o token individual de cada administrador no editor para auditoria nominal. O bootstrap é identificado como conta administrativa compartilhada persistente; não permite saber qual pessoa usou o segredo compartilhado.
6. Testar e ativar novas versões pelo editor. Tokens existentes nunca retornam ao navegador. SMTP testa TLS/autenticação sem enviar e-mail. reCAPTCHA exige resolver um desafio da site key candidata; validar apenas formato não habilita ativação. ZapSign faz GET de leitura, sem criação de documentos. OpenRouter consulta `GET /api/v1/auth/key` (valida a chave sem gerar texto nem gastar créditos); a chave fica cifrada e só é guardada: nenhum recurso do sistema chama modelos de IA por ela ainda.
7. Depois de validar a restauração com a chave externa e confirmar o funcionamento, remover do arquivo de ambiente as variáveis migradas: `ASAAS_API_KEY`, `ASAAS_API_KEY_SANDBOX`, `ASAAS_AMBIENTE`, `DATAJUD_API_KEY`, `CNJ_GOOGLE_CLIENT_ID`, `CNJ_GOOGLE_CLIENT_SECRET`, `CNJ_GOOGLE_DRIVE_PASTA_RAIZ`, `CNJ_BREVO_API_KEY`, `CNJ_BREVO_REMETENTE`, `CNJ_BREVO_NOME_REMETENTE`, `CNJ_SMTP_HOST`, `CNJ_SMTP_PORTA`, `CNJ_SMTP_USUARIO`, `CNJ_SMTP_SENHA`, `CNJ_SMTP_REMETENTE`, `CNJ_RECAPTCHA_SITE_KEY`, `CNJ_RECAPTCHA_SECRET`, `ZAPSIGN_API_KEY`, `OPENROUTER_API_KEY`. Recriar o container uma vez para também removê-las do ambiente do processo. A leitura em modo banco não depende delas depois da importação.
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

Configuração: o interruptor é o módulo **Triagem por IA**, em Configurações › Módulos (só administrador; vem **desligado**). Ligado, a triagem usa o Jev (`typesafe/jev-1.14`) pela integração OpenRouter, que precisa estar cadastrada, testada e **ativa** em Administração › Integrações. Não há variável de ambiente para ligar ou desligar: `CNJ_TRIAGEM_MODO` e `TYPESAFE_API_KEY` deixaram de ser usadas. Modelo fixo, sem variável de ambiente para trocar.

A tela de Publicações informa o estado: desligada (como ligar), ligada sem chave ativa (como ativar) ou ligada.

- **Sigilo:** o que sai para o Jev é o tipo, a classe, o órgão, o tribunal e o texto da publicação **sem** nomes de partes e advogados (inteiros e sobrenomes soltos), CPF, CNPJ, e-mail, telefone, OAB e números de processo (`triagem.anonimizar`). Antes de ligar o módulo, leia a política de privacidade e de retenção da TypeSafe e do OpenRouter e avalie a LGPD: confira região de processamento, retenção e uso para treinamento do modelo que o roteador escolher.
- **Faixas:** acima de 90% de confiança a sugestão aparece em destaque; de 50% a 90% aparece como "revisar"; abaixo de 50% não aparece. Nunca há descarte.
- **Custo:** cobrança por token pelo OpenRouter (o roteador escolhe o modelo a cada chamada, então o preço varia; acompanhe no painel); as quatro perguntas vão numa chamada só por publicação, e o resultado fica guardado (`publicacao_triagem`), então cada publicação é classificada uma vez.
- Uma rotina horária classifica as publicações novas não tratadas; o botão "Classificar esta página" faz o mesmo sob demanda.
- O adaptador foi testado só com respostas simuladas; ainda não foi exercitado com uma chave real.

### Como funciona pelo OpenRouter

A chamada é `POST https://openrouter.ai/api/v1/chat/completions` com as quatro perguntas respondidas em JSON. As confianças vêm informadas pelo próprio modelo, não são probabilidades calibradas: trate-as como indicativas e mantenha a revisão humana. Respostas fora da lista ou JSON inválido viram falha da publicação, sem sugestão inventada.

## E-mail pelo Brevo

Todo e-mail do sistema (novo token, cadastro, alertas de prazo, monitoramentos) sai por um único ponto: pela **API do Brevo** quando há
chave e remetente configurados; senão, pelo SMTP. Serve para servidores que bloqueiam a porta SMTP, porque a API usa HTTPS (443).

1. No Brevo, valide o remetente em *Senders, Domains & IPs* (um domínio autenticado com SPF/DKIM melhora a entrega) e gere uma chave
   de API em *SMTP & API*. Se a conta usar *Segurança › IPs autorizados*, libere o IP do servidor.
2. Em Administração › Integrações › **E-mail (Brevo)**, informe a chave, o remetente (o mesmo e-mail validado) e, se quiser, o nome.
3. **Testar conexão** confere a chave e se o remetente está ativo no Brevo, sem enviar nada. Depois de **Ativar**, use **Enviar e-mail de
   teste**: ele manda uma mensagem de verdade ao e-mail do administrador e mostra o motivo real se falhar (chave, IP não autorizado,
   remetente não validado).
4. O SMTP continua cadastrável como reserva: sem o Brevo configurado, ele vale como antes.

A chave fica cifrada no cofre e nunca é exibida de volta nem gravada em log.
