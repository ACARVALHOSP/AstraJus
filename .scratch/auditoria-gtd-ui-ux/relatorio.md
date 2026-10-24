# Auditoria GTD + UI/UX — AstraJus

Data: 24/10/2026. Escopo: implementação local atual, incluindo alterações já presentes no workspace. Auditoria sem mudanças no frontend.

## 1. Diagnóstico

O AstraJus possui uma estrutura coerente para consultar dados judiciais e manter o cadastro do escritório. A maior oportunidade é conectar a informação recebida ao trabalho a executar: publicação → decisão → atividade → conclusão verificável.

A organização atual privilegia entidades e fontes de dados. Para consultar um processo isso funciona; para revisar o trabalho de vários processos, exige percorrer detalhes individuais. Há ainda sinais que podem comprometer a confiança: sino com ausência estática de notificações, consulta global que omite falhas de carregamento e persistência local que falha silenciosamente.

Não foi comprovada falha crítica S4, perda de dados ou descumprimento integral de acessibilidade. Os impactos abaixo derivam de inspeção do código e precisam de validação em execução nos pontos explicitados.

## 2. Escopo e método

**Público e objetivo documentados:** advogados de escritórios de 2–10 profissionais, uso principal em desktop e eventual em celular; acompanhar processos, publicações e atividades. Fontes: `PRODUCT.md` e `CONTEXT.md`.

**Artefatos:** `static/app.html`, `static/app.js`, `static/cadastro.js`, `test_interface.py`, documentação do produto e critérios/modelo da skill `gtd-ui-ux-audit`. As referências de linha correspondem ao estado inspecionado e podem mudar com edições posteriores.

**Cobertura:** shell, acesso, consulta de processo, consulta de publicações, histórico/favoritos, monitoramentos, jurimetria, integrações, lançamentos, pagamentos, clientes e suas seções, processos e suas cinco sub-abas, publicações monitoradas e ações em lote.

**Método:** inspeção estática de marcação, estilos e handlers; reconstrução do fluxo principal e dos caminhos de erro. Os testes existentes foram lidos como evidência de intenção de cobertura, não executados nem declarados aprovados.

**Limite de execução:** servidor estático local iniciado em `127.0.0.1:8765`; abertura de `/static/app.html` no navegador integrado retornou `net::ERR_CONNECTION_TIMED_OUT`. Não houve interface renderizada disponível, viewport medido, captura visual ou sessão autenticada. Não foram feitos testes com usuários, teclado real, leitor de tela, contraste, refluxo, latência ou persistência real. O servidor estático também não substituiria as APIs autenticadas.

**Fluxo representativo inspecionado, não executado:** abrir Publicações monitoradas → filtrar não tratadas → expandir publicação → cadastrar/vincular processo → abrir processo → Atividades → registrar providência → retornar e marcar publicação tratada. A implementação oferece essas operações em pontos distintos; não foi encontrado um vínculo explícito da providência criada com a decisão de tratamento.

GTD é aplicado como lente de captura, esclarecimento, organização, revisão e execução. Um processo judicial não equivale automaticamente a um projeto GTD; movimentação não equivale a tarefa; publicação tratada não equivale necessariamente a trabalho concluído. As recomendações são adaptações de design, não exigências de certificação GTD.

## 3. Pontos fortes a preservar

| Evidência | Benefício | Preservar |
|---|---|---|
| `app.html:748–817`: grupos Consulta, Escritório, Financeiro, Monitoramento e Ferramentas | Distingue atividades operacionais e consultas externas | Grupos compreensíveis e vocabulário do domínio |
| `app.js:41–120`: indicador de edição e decisão salvar/descartar/continuar | Dá controle sobre saída com alterações pendentes | Esperar resposta de salvamento e manter edição em caso de falha |
| `app.html:1572–1582`: explica captura de 24h, e-mail de 6h e significado dos status | Evita confundir coleta, leitura e providência | Explicações junto ao fluxo, sem esconder estados reais |
| `app.js:4097–4120`: trata resultado parcial da atualização em lote | Evita declarar sucesso total quando alguns itens falham | Contagem de sucessos/falhas e possibilidade de recuperação |
| `app.html:1487–1492`: Cadastro, Atividades, Publicações, Movimentações e Vínculos | Separa registro, trabalho e evidência judicial | Essa separação, com mais continuidade entre áreas |
| `app.js:5765` e seguintes: setas, Home/End e tabindex nas sub-abas | Implementa intenção consistente de operação por teclado | Ampliar a mesma abordagem aos controles ainda divergentes |
| `app.js:1958–2002`: tamanho de amostra e avisos na jurimetria | Ajuda a interpretar resultados com cautela | Mostrar cobertura da amostra junto dos números |

## 4. Melhorias priorizadas

Alta confiança abaixo significa evidência direta no código; não significa reprodução em navegador. Frequência de uso e incidência real não foram medidas.

| ID | Problema | Grau | Impacto | Confiança | Esforço estimado |
|---|---|---|---|---|---|
| A01 | Atividades sem revisão transversal | S3 provisório | Revisar vários processos requer abrir cada detalhe | Média | Grande; pressupõe agregação e filtros |
| A02 | Sino declara ausência sem consultar notificações | S2 | Pode sugerir que não há pendências verificadas | Alta no código; impacto inferido | Pequeno para retirar ambiguidade |
| A03 | Consulta global omite falhas e estado de cobertura | S2 | Resultado vazio pode ser interpretado como inexistência | Alta | Médio; inclui carregamento e atualização do cache |
| A04 | Campos repetíveis de cliente dependem de placeholder | S2 | Identificação de campos fica frágil após preenchimento | Alta | Médio; inclui grupos e nomes únicos |
| A05 | Menu móvel não fecha ao selecionar uma aba | S2 provisório | Conteúdo escolhido pode continuar encoberto | Média | Pequeno; depende de gestão de foco |
| A06 | Favoritos/histórico falham silenciosamente ao gravar | S2 | Usuário pode acreditar que informação ficou guardada | Alta | Pequeno; retorno de gravação e feedback |
| A07 | Estado de integrações não valida HTTP e pode ficar indefinido | S2 | Falha de autorização pode parecer falta de configuração | Alta | Pequeno; estados e retomada |
| A08 | Tratamento da publicação não registra a providência | S2 provisório | Decisão e atividade precisam ser correlacionadas manualmente | Média | Médio/grande; depende do modelo de dados |
| A09 | Orientação e carregamento variam entre abas | S1 | Reconhecimento da tela e espera menos previsíveis | Alta | Pequeno/médio |
| A10 | Dois conceitos de favorito com nomes próximos | S1 | Usuário precisa entender duas origens de registro | Alta | Pequeno |
| A11 | Alternador Tabela/Cards diverge do teclado das sub-abas | S1 | Mesmo papel semântico oferece interação diferente | Alta | Pequeno |

## 5. Análise das melhorias

### A01 — Tornar o trabalho pendente revisável entre processos

**Evidência:** `app.html:1511–1517` situa Atividades dentro do processo; `app.js:4834–4898` carrega/renderiza a lista por `casoId`. A navegação principal não oferece lista agregada. O formulário em `app.js:5460–5465` contém tipo, título, data, hora e observações; não registra responsável específico pela atividade.

**Consequência/GTD:** para decidir o trabalho seguinte e revisar compromissos, o advogado precisa saber previamente em qual processo procurar. Refletir e engajar ficam dependentes de memória. O responsável pelo processo não resolve necessariamente delegação por atividade.

**Grau:** S3 provisório para escritórios que dependam do painel como fonte central das atividades. Há alternativa — abrir cada processo —, mas o custo cresce com a carteira. Se a agenda externa for o sistema principal e confiável, o grau pode cair.

**Recomendação:** disponibilizar visão de atividades abertas entre processos, com vínculo ao processo, data quando houver e filtros por responsável/tipo. Distinguir prazo real de data desejada antes de criar categorias. Não exigir contexto, energia ou duração sem necessidade demonstrada.

**Aceite:** com três processos contendo atividades abertas e concluídas, localizar todas as abertas sem abrir os três detalhes; abrir o processo correto; concluir uma atividade e observar a atualização nos dois contextos. Validar responsabilidade com o escritório antes de ampliar o modelo.

### A02 — Remover a falsa impressão de uma central de notificações operacional

**Evidência:** `app.html:729–731` contém “Nenhuma notificação”; `app.js:5653–5662` apenas abre/fecha o painel. Não há consulta ou atualização desse conteúdo no frontend inspecionado.

**Consequência/GTD:** em produto de acompanhamento, ausência só é confiável quando corresponde a verificação com escopo conhecido. O sino não comprova ausência de publicações, falhas de captura ou tarefas.

**Grau:** S2; não há evidência de perda de prazo. Afeta quem atribuir ao sino um significado operacional; alternativa é consultar as áreas específicas.

**Recomendação:** retirar o controle até haver função real ou explicar claramente que a central ainda não está disponível. Se implementada, distinguir carregamento, erro e lista vazia, com horário e fonte da verificação.

**Aceite:** falha de consulta jamais apresenta “Nenhuma notificação”; vazio aparece somente após consulta bem-sucedida de um escopo definido.

### A03 — Distinguir ausência, carregamento e falha na consulta global

**Evidência:** `app.js:5679–5686` carrega clientes/processos, silencia exceções e conserva o cache; `5690–5736` filtra localmente, limita a vinte resultados e mostra “Nenhum resultado”. Após o carregamento inicial não há rerenderização automática do termo já digitado nesse handler.

**Consequência/UI:** em conexão lenta, o usuário pode digitar antes da resposta e ficar com um vazio calculado sobre dados anteriores. Em falha, não sabe que a cobertura é parcial. Não foi verificado se as APIs devolvem toda a carteira; não se afirma truncamento pelo servidor.

**Grau:** S2; existe alternativa nas listas de Clientes e Processos, porém exige navegação adicional.

**Recomendação:** mostrar carregamento/erro, executar novamente o filtro ao receber dados e permitir nova tentativa. Informar quando houver mais de vinte correspondências. Definir política de atualização do cache.

**Aceite:** digitar durante carregamento lento e ver resultados assim que a resposta chegar; simular erro em uma fonte e ver aviso de cobertura parcial; corrigir a conexão e repetir sem redigitar.

### A04 — Dar nomes persistentes aos campos repetíveis

**Evidência:** `app.js:3419–3456`, `_criarGrupoEnderecos`, cria tipo, CEP, rua, número, bairro, complemento, cidade, estado e país com placeholders e autocomplete, sem rótulos associados nem nomes ARIA nesses elementos. Inspeção semelhante deve se estender a telefones, e-mails e sites em `3295–3416`.

**Consequência/acessibilidade:** campos preenchidos perdem a pista visual do placeholder; múltiplos endereços tornam a identificação mais trabalhosa. Autocomplete não substitui um rótulo. O nome exposto por cada combinação de navegador/leitor não foi medido.

**Grau:** S2; afeta entrada e revisão do cadastro, especialmente com tecnologia assistiva. Avaliar contra WCAG 2.2, 3.3.2 Labels or Instructions (A) e 4.1.2 Name, Role, Value (A); não é declaração de conformidade global.

**Recomendação:** rótulos visíveis associados por IDs únicos e agrupamento identificado, como “Endereço 1”. Incluir contexto nas ações de remover.

**Aceite:** dois endereços preenchidos continuam identificáveis visualmente; leitor anuncia campo e grupo; duplicar/remover grupo não repete IDs nem perde associação.

### A05 — Completar a transição do drawer móvel para o conteúdo

**Evidência:** `app.js:699–721` seleciona a aba e mantém foco no botão lateral; `5595–5633` controla abertura/overlay. O fechamento móvel é chamado explicitamente no logo e no resultado global, mas não na seleção geral de abas. O CSS em `app.html:95–102` transforma a navegação em drawer.

**Consequência:** hipótese de conteúdo encoberto após escolha e de percurso de foco pouco claro. O comportamento efetivo depende do CSS Carbon e precisa ser reproduzido.

**Grau:** S2 provisório, com alternativa de fechar pelo hambúrguer/overlay.

**Recomendação:** após seleção bem-sucedida no celular, fechar drawer e posicionar foco em um destino lógico do conteúdo. Se houver edição pendente cancelada, preservar navegação/contexto.

**Aceite:** em 390px, abrir menu e selecionar Clientes deixa lista visível; repetir por teclado; Escape fecha com retorno de foco; cancelar saída de edição não muda a tela.

### A06 — Comunicar falha de armazenamento local

**Evidência:** `app.js:514–522`, `_salvarLista`, captura a exceção do localStorage sem retorno nem aviso. A própria tela distingue Histórico local, mas isso não informa falha de gravação. Token lembrado já tem tratamento de aviso em `app.js:453–456`, que pode servir de padrão.

**Consequência/GTD:** confiança na captura e recuperação fica comprometida quando o gesto de favoritar aparenta funcionar sem persistir. Não se afirma perda reproduzida.

**Grau:** S2 no cenário de armazenamento indisponível; frequência desconhecida, processo original permanece consultável.

**Recomendação:** retornar resultado da gravação e explicar que o favorito/histórico não pôde ser guardado. Se mantido em memória, identificar que vale apenas para a sessão.

**Aceite:** forçar `setItem` a lançar erro; verificar aviso e estado coerente da estrela; restabelecer armazenamento e confirmar persistência após recarga.

### A07 — Estados confiáveis e recuperáveis em Integrações

**Evidência:** `app.js:1721–1751`: sem cliente, retorna deixando “Verificando…” definido no HTML; com resposta HTTP, faz `json()` sem verificar `resposta.ok`, tratando campos ausentes como “Não configurado”. Os cartões em `app.html:1237–1263` não oferecem ação de configuração ou retomada.

**Consequência:** confunde falta de autenticação, erro de verificação e configuração ausente; usuário não sabe como prosseguir. O corpo efetivo dos erros de produção não foi testado.

**Grau:** S2; alternativa depende de acesso ao administrador/configuração externa.

**Recomendação:** estados separados para acesso necessário, verificando, configurado, não configurado e falha; verificar status HTTP; oferecer tentar novamente e instrução específica ao administrador. Não chamar configuração detectada de conexão saudável se não houver teste real.

**Aceite:** sem token, 401 JSON, 500 JSON, resposta inválida e sucesso geram estados distintos; nenhuma falha termina em “Não configurado” por ausência de propriedades.

### A08 — Registrar como a publicação foi encaminhada

**Evidência:** `app.js:4452–4456` marca como tratada pela alteração de status; `_aplicarStatusPubOab`, em `4097`, envia hashes/status. A criação da atividade ocorre separadamente em `5453–5476`.

**Consequência/GTD:** a interface define “Tratada” como providências tomadas, mas o fluxo não ajuda a registrar o que foi decidido ou onde continuar. Isso é fricção de rastreabilidade, não prova de tratamento incorreto. Não é necessário exigir atividade para publicação que não demande trabalho.

**Grau:** S2 provisório; em equipe, o contexto pode precisar ser reconstruído por outro advogado.

**Recomendação:** permitir partir da publicação para criar atividade no processo vinculado, preservando referência de origem; oferecer registro opcional da decisão e manter “sem providência” como desfecho válido.

**Aceite:** registrar uma atividade a partir da publicação abre o processo correto e permite retornar à origem; marcar como tratada sem tarefa continua possível; falha no salvamento não declara atividade criada.

### A09 — Padronizar orientação e espera por aba

**Evidência:** `app.html:857`, `936`, `1103` e `1237`: telas começam por formulário ou ajuda, sem título próprio como o de Clientes/Processos. `app.js:3172–3185` limpa a lista de processos antes de carregar sem inserir indicador; Clientes em `3156–3169` mostra “Carregando…”.

**Consequência/UI:** orientação depende da lateral; durante carga, lista vazia é ambígua. Sem renderização, não se conclui problema de tamanho ou contraste da tipografia.

**Grau:** S1; seleção lateral e conteúdo ainda oferecem contexto.

**Recomendação:** título consistente em cada área, estados de carregamento/erro/vazio distintos e atualização anunciada quando pertinente.

**Aceite:** lateral recolhida não impede reconhecer a área pelo conteúdo; resposta lenta mostra espera e nunca vazio definitivo; ao falhar, oferecer nova tentativa.

### A10 — Diferenciar as duas coleções de favoritos

**Evidência:** `app.html:1092–1097` apresenta “Favoritos” e “Processos favoritos”; a ajuda referencia “aba Processo (DataJud)”, enquanto o menu usa “Consultar processo”. `app.js:8–10` confirma chaves separadas para consultas e cadastros.

**Consequência:** mesma entidade aparente com duas origens e destinos. Exige ler ajuda para prever o clique.

**Grau:** S1; textos explicativos oferecem alternativa.

**Recomendação:** usar rótulos que explicitem o destino, por exemplo “Favoritos de consulta” e “Processos cadastrados favoritos”, com informação sobre armazenamento local. Preservar o termo Favorito.

**Aceite:** cada item informa se abre cadastro ou repete consulta; os nomes de áreas na ajuda correspondem à navegação atual.

### A11 — Uniformizar o alternador Tabela/Cards

**Evidência:** `app.html:1473–1475` usa tablist/tab; `app.js:5572–5593` trata cliques e seleção, mas não setas/tabindex. O handler compartilhado em `5765` inclui apenas `.sub-abas`, `.sub-tabs` e `.cadastro-tabs`.

**Consequência:** o controle continua acionável por Tab e Enter, porém diverge da convenção usada nas demais abas. Não há bloqueio de teclado comprovado.

**Grau:** S1. Recomendação: alinhar semântica e teclado ao padrão escolhido para alternância de visualização.

**Aceite:** teclado opera os dois modos de forma previsível, foco visível e estado anunciado; a seleção preserva filtro e conteúdo equivalente.

## 6. Cobertura por área e por dimensão

| Área | Avaliação da implementação e limite |
|---|---|
| Shell | Grupos compreensíveis; A02/A03/A05/A09. Contraste, foco real e sobreposição pendentes |
| Acesso | Opção de lembrar e validação de token presentes; não autenticado em execução |
| Consultar processo | Tribunal e CNJ rotulados, aviso de demora, resultados categorizados; validação e recuperação reais pendentes |
| Consultar publicações | Formulário, paginação e entrada para monitorar; criação de monitoramento precisa ser descoberta por essa área |
| Histórico/favoritos | Repetição rápida e indicação local; A06/A10 |
| Monitoramentos | Mostra criação/expiração e permite remover; criação remetida às consultas. Validar última execução, falha e expiração em ambiente de teste |
| Clientes | Cadastro dividido em três seções e processos vinculados; A04. Persistência entre seções não testada |
| Processos/lista | Triagem antes dos cadastrados; filtro e duas visualizações. Volume de triagem pode empurrar a carteira para baixo — hipótese visual a medir, não achado confirmado |
| Processo/Cadastro | Capa separada de responsável; atualização explícita. Confirmar distinção de dados judiciais e editáveis na renderização |
| Processo/Atividades | Criar, editar, concluir e excluir; A01. Conclusão tenta reverter checkbox em erro |
| Processo/Publicações | Lista vinculada; A08. Verificar origem e caminho de retorno |
| Processo/Movimentações | Atualização DataJud explícita; não confundir com compromisso assumido |
| Processo/Vínculos | Tipos de relação e formulário recolhível; combinações sem CNJ precisam de teste |
| Publicações monitoradas | Captura manual, explicações, status e lote com recuperação parcial; A08 |
| Jurimetria | Escopo TJSP informado, filtros comuns e avisos de amostra; testar autocomplete, seleção, teclado e estados de erro |
| Integrações | Estado por serviço e recurso futuro identificado; A07 |
| Lançamentos | Lista e criação presentes; conferência contábil e regras financeiras fora do escopo |
| Pagamentos | Status, CPF/CNPJ e cobranças; `app.js:2830` distingue integração ausente. Confirmar espera removida em todos os erros e ação disponível com integração ausente |

**Capturar:** coleta de publicações e cadastro presentes; A06 limita confiança na persistência local. **Esclarecer:** definição de status é boa; A08 melhora registro da decisão. **Organizar:** processo reúne suas evidências; A01 limita organização do trabalho entre processos. **Refletir:** faltam caminhos transversais na implementação inspecionada. **Engajar:** há ações locais claras, mas escolha do trabalho global depende de navegação manual.

**Não aplicável como requisito universal:** inbox pessoal para toda tela, revisão semanal obrigatória, classificar todo processo judicial como projeto GTD, medir interações pela regra dos dois minutos.

**Não verificado:** responsividade renderizada, zoom, refluxo, foco e contraste, leitor de tela, rede real, desempenho medido, integridade de salvamento e permissões por perfil. Ausência de teste não conta como falha.

## 7. Plano de ação

**Agora — resolver confiança e validar os riscos:** reproduzir A02–A07 em ambiente de teste; tornar ausência/erro/carregamento distinguíveis; nomear os campos repetíveis; concluir o comportamento móvel. Antes de implementar A01, confirmar onde o escritório revisa atividades hoje e quais compromissos dependem do painel.

**Depois — conectar a providência:** especificar a visão agregada de atividades (A01) e o caminho publicação → atividade (A08), preservando tratamento sem tarefa quando pertinente. Testar com um advogado o percurso de entrada, decisão, ação e confirmação.

**Evolução — consistência e manutenção:** uniformizar títulos, alternadores e favoritos (A09–A11); validar tabelas com textos longos e carteira grande; aplicar verificações automáticas de acessibilidade como complemento à inspeção manual.

Estimativas são relativas, sem cronograma: não houve investigação completa do backend para recursos novos. Este relatório não autoriza implementar ou publicar alterações.

## 8. Validação e fontes

Realizado: leitura dos artefatos, rastreamento dos handlers e tentativa documentada de abrir a prévia local. Não foram executados testes de frontend nem ações sobre dados do escritório.

Próxima rodada: desktop 1440×900 e 1280×720, celular 390×844 e 320px de largura; zoom de 200% e teste de refluxo; Tab/Shift+Tab/setas/Escape; leitor de tela; respostas lentas, 401/500, armazenamento bloqueado e falha parcial no lote. Usar dados fictícios e ambiente isolado. Salvar cliente/atividade e recarregar; navegar com edição pendente; repetir o percurso da publicação até a providência e sua confirmação.

Hipóteses prioritárias: painel é fonte principal de atividades; atividade pode ter responsável distinto do processo; sino é interpretado como indicador de pendências; carteira cabe integralmente nos endpoints usados pelo cache global. Confirmar essas hipóteses pode alterar severidade e solução.

Fontes primárias consultadas em 24/10/2026:

- [David Allen Company — What is GTD](https://gettingthingsdone.com/what-is-gtd/): cinco etapas, usadas como fundamento; as decisões de interface são adaptações desta auditoria.
- [W3C — WCAG 2.2](https://www.w3.org/TR/WCAG22/): referência normativa parcial para investigar rótulos e nomes acessíveis. A auditoria não certifica conformidade.

Fontes locais: `PRODUCT.md`, `CONTEXT.md`, `static/app.html`, `static/app.js`, `static/cadastro.js`, `test_interface.py`; critérios e modelo da skill em `C:/Users/ariel/.agents/skills/gtd-ui-ux-audit/`.
