# Validação no navegador — 2026-10-29

Chrome headless local, frontend Vite, contexto de navegador novo. APIs interceptadas com token e registros fictícios; nenhuma alteração enviada ao backend. Roteiro: `validar.cjs`. [Evidências e medições](../../output/playwright/carbon-audit/resultados.json).

## Cobertura e limites

- Consulta de processo: tribunal TJSP e número fictício, resposta simulada de não encontrado. Formulário percorrido em white/g100 a 1440, 720 e 390 px; envio realizado no white desktop.
- OAB: duas publicações simuladas, medição desktop white/g100, seleção por foco + Espaço e exibição das ações em lote. Responsividade medida no g100 a 720/390 px, lateral aberta e recolhida.
- Cadastro: abertura de Novo cliente e preenchimento do nome em white/g100 a 1440/720/390 px; sem envio. Não valida persistência de cadastro, erros de servidor nem todos os campos.
- Busca e notificações: abertura em ambos os temas e três larguras, Escape, capturas visuais. Dados vazios simulados; não exercitado conteúdo longo de notificações.
- Reflow equivalente a 200% de uma janela 1440×900: viewport CSS 720×450. Cadastro sem overflow horizontal nessa condição. **Zoom nativo do navegador a 200% não foi testado**; a equivalência não cobre todos os efeitos de zoom, rasterização e controles nativos.
- Medições de contraste de cores computadas no cadastro, não auditoria global de contraste. A coleta bruta inclui elementos de modais ocultos com dimensões; não tratar esses registros como falha visível. Estados hover, foco, erro, seleção e todos os conteúdos não foram integralmente medidos.
- Sem teste com leitor de tela; árvores acessíveis foram capturadas. Não houve exceções JavaScript em `pageerror`; avisos React de key via spread apareceram no console do Vite.

## Resultados por prioridade

### 1. Nomes acessíveis, idioma e navegação

- **S2 confirmado:** seletores de status da OAB aparecem como `combobox` sem nome na árvore acessível. O filtro geral possui nome Status, mas os controles de cada linha não. Evidência: `03-oab-white.txt`, `resultados.json`.
- **S2 confirmado:** documento continua com `lang=en`.
- **S2 confirmado:** primeiro Tab no desktop vai ao link AstraJus; não há opção de pular ao conteúdo.
- **S1 confirmado:** botão de expansão da linha anuncia “Expand current row”; há traduções Carbon ainda não aplicadas. Evidência: `03-oab-white.txt`.
- **Funcionou:** seleção de linha por teclado (foco + Espaço) revela ações em lote. A falha inicial de `locator.check()` ocorreu porque o label visual intercepta o clique direto no input, não foi classificada como defeito do produto.

### 2. Densidade, tipografia e grade

- **S2 confirmado:** linha OAB desktop 48 px e texto 14 px, em ambos os temas; especificação pede 40 px e 12 px. Conteúdo longo cresce para 127 px nas telas estreitas; a altura nominal não deve justificar recortar conteúdo.
- **S2 confirmado:** título de página computado 32/40 px, versus 28/36 px documentados.
- **S3 confirmado no cenário g100 estreito:** OAB alarga o documento para aproximadamente 935 px em viewport 390/720 px. Embora o contêiner declare overflow auto, a largura mínima do conteúdo transborda para a página. Com lateral aberta, documento chega a aproximadamente 1143 px. Evidência: `07-oab-390.png`, `08-lateral-390.png` e métricas.
- **S2 confirmado:** em 390 px, lateral aberta ocupa 256 px e deixa 134 px de largura no main. O comportamento observado desloca/comprime o conteúdo em vez de sobrepor um painel móvel; não foi constatada sobreposição do cabeçalho. As métricas sem espera de transição no primeiro roteiro podem registrar largura intermediária da lateral; a captura estabilizada sustenta o problema de largura.
- **S2 confirmado visualmente:** no g100, o overflow horizontal da OAB expõe fundo branco fora da área escura, prejudicando a leitura do conteúdo que transborda.
- **Funcionou no cenário:** cadastro simples não gerou overflow horizontal a 390/720/1440 px em ambos os temas. A conformidade da grade de endereço/capa segue como achado estático; esses subformulários não foram exercitados no navegador.

### 3. Feedback e consistência

- **S2 confirmado:** Escape não fecha busca nem notificações, em ambos os temas. Busca permanece com aria-expanded=true; não há retorno de foco ao acionador.
- **S2 confirmado:** painel de busca em 390 px começa em x=-26 e termina em 294 px, com 320 px de largura. Parte esquerda fica fora da viewport e sob a lateral; captura mostra início do placeholder recortado. Mesmo comportamento nos dois temas. Evidência: `busca-white-390.png`, `busca-g100-390.png`.
- **S2 confirmado visualmente:** notificações também ficam recortadas à esquerda em 390 px; título, filtro e mensagem perdem seu início. Evidência: `notificacoes-g100-390.png`.
- **S2 confirmado:** reload direto na OAB restaura o tema, mas exibe “Erro Conecte-se primeiro” após a conexão já estar Conectado. Atualizar lista recupera a tabela. Compatível com efeito de carga que não observa a mudança de cliente em `src/routes/PublicacoesOab.tsx`. Evidência: `05b-reload.txt`.
- **Funcionou:** g100 persiste no localStorage e após reload; navegação para outras telas conserva a preferência.
- **Contraste amostrado:** texto do input sobre a superfície: white 16,45:1 e g100 13,76:1; rótulos: white 7,81:1 e g100 10,59:1; texto do botão primário sobre azul: 5:1 nos dois temas. Não foram encontrados problemas nesses pares. Isso não elimina o problema do fundo branco no overflow nem certifica contraste de todos os estados.

## Ordem de correção e aceite

1. Nomear status por linha, declarar pt-BR, adicionar pular ao conteúdo e traduzir expansão; repetir árvore acessível e navegação por Tab.
2. Conter largura/rolagem da OAB e ajustar lateral em viewport móvel; validar documento sem overflow global e tabela com rolagem própria, mantendo ações alcançáveis. Aplicar tipografia e densidade documentadas; validar grid de endereço/capa com dados preenchidos.
3. Corrigir Escape/foco e ancoragem dos painéis; corrigir carga da OAB após reconexão e preservar erros distintos de vazio na busca.
4. Repetir matriz completa com white/g100, zoom nativo 200%, estados de erro e conteúdo longo, leitor de tela e salvamento isolado de cadastro. Esses itens permanecem pendentes.

Nenhuma correção de produção foi aplicada. Mudanças visuais continuam sujeitas à prévia e aprovação exigidas pelo AGENTS.md.
