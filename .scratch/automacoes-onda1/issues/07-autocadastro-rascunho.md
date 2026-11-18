# Autocadastro como rascunho

Status: implementado (decisões: toda a equipe vê; publicação segue na fila; teto 20/dia)
Blocked by: 01 (pronto), 05 (pronto), 06 (pronto)
Tamanho: G
Spec: ../spec.md (seção 6)

## O que ele faz, em uma frase
Quando chega uma publicação de um processo que o escritório ainda não cadastrou **e** as partes mostram, com segurança, de qual
cliente é, o sistema cria sozinho o processo como **rascunho** ("a confirmar"). A pessoa só confirma ou descarta.

## Situação hoje
Para publicação de processo não cadastrado, a pessoa abre "criar caso a partir da publicação", escolhe o cliente e confirma. O
núcleo (`_criar_caso_de_publicacao`) já monta caso e capa só com dados da publicação (sem API externa) e, desde os tickets 05 e 06,
já sabe sugerir responsável e gravar título/cliente normalizados. Falta decidir **quando** pode rodar sozinho e **onde** o resultado
fica até alguém conferir.

## Quando cria (todas as condições)
1. Publicação captada por monitoramento de OAB, ainda na fila (`nao_tratada`), sem caso vinculado.
2. Número CNJ válido (dígito verificador) e **nenhum caso** cadastrado com esse número (nem rascunho).
3. **Exatamente um** cliente do escritório reconhecido nas partes, pelo reconhecimento estrito que já existe (`polos.py`: CPF/CNPJ ou
   nome completo igual; só perfil "cliente"). Zero ou mais de um: **não cria**; a publicação segue na fila como hoje, com o selo
   "sem cliente reconhecido". Não se inventa cliente (`cliente_id` é obrigatório e cadastro errado polui a base).
4. Rotina ligada e dentro do **teto**: 20 rascunhos por dia (parâmetro, 1 a 200) e no máximo 20 por rodada.

## O rascunho
- Nova situação do processo: `casos.status = 'rascunho'` (hoje só existe `ativo`). **Fica fora de tudo até confirmar**: não entra na
  lista de Processos, nas buscas, no aviso de processo parado, nos alertas, nas regras de responsável (Aplicar) nem na Normalização.
  Implementação: `listar_casos()` passa a ignorar rascunho por padrão (`incluir_rascunhos=True` só para a tela própria); as consultas
  diretas a `casos` que alimentam alertas e sino também filtram.
- Responsável pelas regras do ticket 05 (se a rotina estiver ligada e alguma regra casar); título e cliente já normalizados (06).
- **A publicação continua na fila** (`nao_tratada`) e fica vinculada ao rascunho. Só ao **Confirmar** vira tratada. Assim a fila
  continua sendo a lista de pendências e nada some sem uma pessoa ter visto.
- Tela **"Processos a confirmar"** (aba nova em Processos) com contador na Home. Cada linha: processo, cliente reconhecido e por quê
  ("CPF igual" ou "nome igual"), responsável, publicação de origem. Botões:
  - **Confirmar**: vira `ativo`, publicação vira tratada, passa a valer para tudo.
  - **Descartar**: apaga o rascunho e devolve a publicação à fila **sem vínculo**; um descarte não é recriado pela rotina
    (fica registrado como "descartada pelo autocadastro" para esta publicação).
  - Dá para editar cliente/título antes de confirmar (mesma ficha de hoje).
- Aviso ao responsável: **sino** `processo_rascunho` ("Novo processo a confirmar"), abre a tela. (E-mail só se você pedir, como no 05.)

## Segurança contra erro e repetição
- **Idempotente:** uma publicação gera no máximo um rascunho (chave = hash da publicação + número do processo); a rotina rodando de
  novo, ou duas vezes ao mesmo tempo, não duplica. Duas publicações do mesmo processo no mesmo ciclo geram um só rascunho.
- **Simulação obrigatória na primeira ativação** (framework do ticket 01): "criaria N rascunhos, para estes clientes", sem gravar.
  A rotina só liga de verdade depois de a pessoa ver a simulação.
- Auditoria: quem ligou, quantos rascunhos por rodada e por dia, no histórico da tela Automações. Rodada com falha no meio não deixa
  processo pela metade (caso e capa na mesma transação ou limpeza do que sobrou).
- Roda junto da captura OAB (24 h), depois dela; é a única rotina do pacote que **cria dados**, por isso nasce desligada.

## Fora do escopo
Criar cliente novo; consultar tribunal/DataJud para completar a capa (usa só o que veio na publicação); mexer em processo já
cadastrado; e-mail a cliente.

## Decisões pendentes
1. **Quem vê "Processos a confirmar":** todos da equipe, ou só o responsável e administradores? Recomendo **todos** (é fila de trabalho).
2. **Publicação fica na fila até confirmar** (recomendado) ou já sai da fila quando o rascunho é criado (como o cadastro manual de hoje)?
3. **Teto de 20/dia** serve? (Para escritório de volume maior sobe pelo parâmetro.)

## Aceite
- Cliente único reconhecido gera um rascunho, e só um, mesmo com a rotina repetida ou concorrente.
- Cliente não reconhecido ou ambíguo, número inválido ou processo já cadastrado: não cria; a publicação segue na fila.
- Rascunho não aparece em Processos, buscas, processo parado nem regras de responsável; confirmar o torna ativo e tratado.
- Descartar remove o rascunho, devolve a publicação à fila sem vínculo e a rotina não o recria.
- Teto diário e por rodada respeitados; simulação não grava nada; primeira ativação exige simulação.

## Implementação
- `autocadastro.py` (candidatas, simular, executar, listar/confirmar/descartar), situação `casos.status='rascunho'` com
  `listar_casos(situacao="ativos"|"rascunhos"|"todos")` (padrão exclui rascunho: lista, buscas, processo parado, regras de responsável).
- Rotina `autocadastro_rascunho` (nasce desligada, parâmetro `limite_dia`), simulação obrigatória (o PUT que liga recusa sem simulação
  prévia; desligar nunca exige), rotas `/admin/automacoes/autocadastro/{estado,simular}` e `/rascunhos` (GET, POST confirmar/descartar).
- Notificação `processo_rascunho` só no sino (responsável; sem responsável, administradores).
- Frontend: cartão "Processos a confirmar" no topo de Processos, contador na Home, simulação dentro do cartão da rotina em Automações.
- Ajuste ao plano: **confirmar não muda o status da publicação**. Criar processo a partir de publicação nunca a marcou como tratada
  (só vincula), e a revisão continua independente; o rascunho nasce vinculado e a publicação segue na fila.
- Limitação conhecida: enquanto o rascunho existe, a busca por número na tela da publicação não o mostra (está fora das listas);
  quem usar "criar processo" nesse intervalo pode duplicar. Confirmar ou descartar resolve.
- Verificação: `test_autocadastro.py` (19), 4 mutações detectadas (regra de cliente único, exclusão do rascunho das listas, descarte
  não recriar, teto), suíte completa; no navegador: simular, ligar, rotina criou 2 rascunhos, confirmar (virou ativo) e descartar
  (publicação voltou à fila sem vínculo).
