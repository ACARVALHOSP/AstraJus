# Dossiê do magistrado (leitura por IA via OpenRouter)

Status: proposta, sem código. Depende da integração OpenRouter já publicada (PR #209) e da Jurimetria existente.

## Objetivo

Antes de uma audiência ou petição, gerar em um clique uma página sobre como um magistrado decide: o que acolhe e rejeita, argumentos que funcionam, súmulas e teses que cita, estilo de fundamentação. Cada afirmação aponta para a decisão que a sustenta. A IA lê e redige; os números vêm de código.

## Princípios

1. **Nada sem lastro.** O modelo só escreve sobre decisões que recebeu. Afirmação sem decisão de origem é descartada antes de aparecer.
2. **Números por código, texto por IA.** Taxas, mediana, intervalo de confiança e comparação com a média dos juízes continuam vindo do perfil decisório atual. A IA não calcula nem arredonda estatística.
3. **Sugestão, não veredito.** O dossiê é apoio à estratégia do advogado. Nada é criado, tratado ou escondido por causa dele, como na triagem de publicações.
4. **Transparência da amostra.** Sempre mostrar quantas decisões foram lidas, o período e o recorte (vara, classe, assunto).

## Fora de escopo

Prever o resultado de um caso concreto, minutar petições, simular cenários, alertas de tendência. Ficam para specs seguintes que reaproveitam a extração desta.

## Usuário e entrada

- Advogado ou estagiário com acesso à Jurimetria.
- Ponto de entrada: perfil decisório do magistrado (tela da Jurimetria) e ficha do processo, quando o processo tem juiz identificado. Botão "Gerar dossiê".
- Entrada: magistrado (código do e-SAJ) e, opcionalmente, o mesmo recorte já usado na busca (termo, classe, assunto, vara, período).

## Fluxo

1. **Coleta.** Reaproveita a busca do CJPG por código do magistrado e o cache de 7 dias. Limite de amostra configurável (sugestão inicial: até 60 decisões mais recentes dentro do recorte).
2. **Verificação de amostra.** Abaixo do mínimo (sugestão: 15 decisões com texto), o dossiê não é gerado; a tela explica o motivo e mostra só o perfil numérico. Entre o mínimo e 30, gera com aviso de amostra pequena.
3. **Anonimização.** Cada texto passa pelo anonimizador já usado na triagem (partes, advogados, CPF, CNPJ, e-mail, telefone, OAB, número de processo) antes de sair do servidor.
4. **Extração por decisão (modelo, em lotes).** Para cada decisão, o modelo devolve dados estruturados: desfecho, pedidos acolhidos e negados, fundamentos principais, súmulas/teses/artigos citados, valores mencionados e um trecho curto literal que sustenta cada item. Resposta em formato fixo; resposta fora do formato é descartada e a decisão marcada como não lida.
5. **Validação.** O sistema confere por código que cada trecho literal existe no texto enviado. Item sem trecho verificável é removido.
6. **Agregação por código.** Frequência de cada fundamento, súmula e tese; proporção por desfecho; lista de decisões por item. Ordena por frequência e exige no mínimo 2 decisões para um item virar "tendência" (1 vira "ocorrência isolada").
7. **Redação (modelo).** Recebe apenas os agregados e os trechos validados, e escreve o dossiê em linguagem natural, seguindo um modelo de seções. Instrução explícita: não afirmar nada que não esteja nos dados recebidos.
8. **Conferência final.** O texto redigido é checado por código: toda afirmação numérica deve coincidir com os agregados; toda citação deve apontar para uma decisão da amostra. Divergência faz o sistema regenerar uma vez; persistindo, mostra só os agregados sem texto livre.
9. **Guarda do resultado.** Salvar dossiê, extrações, versão do modelo, data e recorte. Cada decisão é lida uma única vez; novos dossiês do mesmo juiz reaproveitam as extrações guardadas e só leem decisões novas.

## Conteúdo do dossiê

- Cabeçalho: magistrado, vara, recorte, período, nº de decisões lidas e não lidas, data de geração, modelo usado.
- Perfil numérico (vindo do perfil atual): taxas por desfecho com margem de erro, mediana de valor, comparação com a média dos juízes.
- Tendências: o que costuma acolher; o que costuma rejeitar; fundamentos mais frequentes; súmulas e teses mais citadas.
- Estilo: fundamentação curta ou extensa, uso de precedentes, exigência de prova (somente quando houver ao menos 2 decisões).
- Ocorrências isoladas (opcional, recolhido).
- Ressalvas automáticas: amostra pequena, viés pelas decisões mais recentes, decisões não lidas.
- Cada item: link ou referência às decisões de origem e o trecho literal.

## Interface

- Botão "Gerar dossiê" com estimativa de custo e tempo antes de iniciar; progresso com contagem de decisões lidas.
- Resultado em página própria com seções recolhíveis, tabela de decisões de origem e exportação em PDF ou CSV.
- Selo "Gerado por IA a partir de N decisões públicas. Confira as decisões citadas antes de usar."
- Estados: sem integração OpenRouter ativa (orienta a ir em Administração › Integrações), amostra insuficiente, falha parcial, gerado.
- Seguir o padrão visual Carbon já adotado e o texto em português do restante do painel.

## Configuração

- Chave OpenRouter: a já cadastrada em Integrações (ativa e testada).
- Modelo: escolhido em configuração, com um modelo para extração (mais barato) e outro para redação (melhor). Sem modelo fixo no código.
- Limites configuráveis: tamanho da amostra, mínimo para gerar, tamanho do lote, teto de custo por dossiê.
- Permissão: reaproveita a da Jurimetria; ativar a geração por IA exige confirmação de um administrador, por causa do envio a terceiro.

## Sigilo e LGPD

- As sentenças do CJPG são públicas, mas só texto anonimizado sai do servidor; o nome do magistrado vai ao modelo apenas se necessário para a redação, e nunca junto de dados de partes.
- Antes de ativar, avaliar a política de retenção e de uso para treinamento do modelo escolhido no OpenRouter, priorizando modelos com retenção zero ou sem treinamento. Registrar essa avaliação na documentação de integrações.
- Auditar cada geração: quem pediu, magistrado, recorte, modelo, número de decisões, custo, resultado.

## Custo e desempenho

- Custo dominado pela extração. Estimativa a levantar antes da implementação: tokens médios por sentença anonimizada × tamanho da amostra × preço do modelo escolhido.
- Mitigações: extração guardada por decisão, amostra limitada, cache do dossiê por magistrado e recorte com validade configurável, execução em segundo plano com notificação ao concluir.
- Teto de custo por dossiê e por mês; ao atingir, a geração é recusada com mensagem clara.

## Riscos e respostas

| Risco | Resposta |
| --- | --- |
| Alucinação ou atribuição indevida ao juiz | Trecho literal obrigatório e verificado por código; conferência final dos números e citações |
| Viés da amostra (poucas decisões ou só as recentes) | Mínimo para gerar, avisos e comparação com a média |
| Dados pessoais enviados ao provedor | Anonimização prévia, avaliação de retenção, auditoria |
| Custo fora de controle | Estimativa prévia, teto, extração guardada |
| Falha ou instabilidade do provedor | Falha parcial mostrada; reprocessar só as decisões não lidas; perfil numérico sempre disponível |
| Texto das decisões fora do padrão | Extração com formato fixo; descartar e contar como não lida |
| Uso como "previsão" do resultado | Selo e ressalvas fixas; nenhuma probabilidade de êxito nesta entrega |

## Critérios de aceite

1. Dossiê só é gerado com OpenRouter ativo e amostra mínima atingida; caso contrário, mostra o motivo e o perfil numérico.
2. Toda afirmação do dossiê tem ao menos uma decisão de origem e um trecho literal verificável; nenhuma sem lastro aparece.
3. Todos os números do texto coincidem com os agregados calculados por código.
4. Nenhum dado de parte, advogado ou número de processo é enviado ao modelo (verificado por testes com textos sintéticos).
5. Decisões já lidas não são lidas de novo; novo dossiê do mesmo recorte reaproveita as extrações.
6. Falha parcial do provedor não perde o que já foi lido; a tela indica quantas decisões ficaram sem leitura.
7. Estimativa de custo exibida antes de iniciar; teto respeitado.
8. Auditoria registra cada geração; o histórico é consultável por administradores.
9. Testes automatizados cobrem anonimização, validação de trechos, agregação, conferência de números e comportamento sem integração, usando respostas simuladas do provedor, sem chamar o OpenRouter real.

## Questões abertas

- Qual modelo para extração e qual para redação, e qual o custo real por dossiê? Medir com uma amostra de 20 decisões antes de fixar limites.
- Incluir o nome do magistrado no prompt de redação ou usar apenas "o magistrado"?
- Limite e validade do cache do dossiê.
- Idioma e tom do texto final (formal, tópicos curtos?) a validar com o escritório.
- Exportação em PDF entra nesta entrega ou na seguinte?

## Plano de entrega sugerido

1. Medição de custo e qualidade da extração com 20 decisões, sem tela (decide modelos e limites).
2. Extração, validação, agregação e guarda no servidor, com testes.
3. Redação, conferência final e tela de resultado.
4. Auditoria, limites de custo, documentação e liberação para administradores.
