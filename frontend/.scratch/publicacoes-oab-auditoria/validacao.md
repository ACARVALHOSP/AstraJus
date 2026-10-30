# Validação de Publicações OAB

Data: 30/10/2026

## Compilação e lint

- `npm run build`: aprovado, incluindo TypeScript e bundle Vite. Avisos de depreciação Sass originados nas dependências Carbon e aviso de tamanho do bundle permanecem.
- `npx oxlint src/routes/publicacoes-oab src/routes/PublicacoesOab.tsx --format stylish`: aprovado, sem apontamentos nos arquivos alterados.
- `npm run lint`: exit code 0; avisos existentes em outros módulos e artefatos locais não foram tratados como falhas desta entrega.

## Cálculo de prazo

`node --experimental-strip-types .scratch/publicacoes-oab-auditoria/prazos.test.cjs`

23 verificações aprovadas: validação de datas, ano bissexto, duração explícita/ambígua/ausente, rejeição de inferência em dias corridos, publicação versus início da contagem, fim de semana, feriado, virada de ano, calendário incompleto, suspensão selecionada, provimento local e limites de duração. Suspensão da contagem não é confundida com dia sem expediente para publicação.

## Interface

Iniciar `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5198 --strictPort` e executar `node .scratch/publicacoes-oab-auditoria/interface.test.cjs`.

O script usa Playwright instalado ou o caminho em PLAYWRIGHT_MODULE e Chrome local. APIs interceptadas, token fictício, nenhuma operação contra dados reais. Artefatos em `output/playwright/publicacoes-oab/`.

38 verificações de interface aprovadas. Cobertura: colunas obrigatórias/desconhecidas, alternância por rótulo, Escape/foco, bloqueio de ações individuais, seleção entre páginas, lote parcial e hashes exatos, expansão/texto original/colspan, erro de capa e retry sem duplicar processo, município/calendário/duração, vencimento pendente sem data, erro de status e retry sem duplicar atividade, DJEN nova aba isolada, ação Abrir processo, alteração e confirmação de data final e limite de corpo de 4096 bytes.

White/g100 em 1440/768/390/320 px: sem overflow global; botões/select da toolbar não cobrem o cabeçalho. Densidade M de 40 px com tolerância geométrica de 1 px para bordas colapsadas; fonte da tabela 12 px. Conferir o resultado JSON gerado para a contagem final das verificações, medidas do seletor e navegação por teclado.

As capturas desktop, mobile, colunas e atividade foram inspecionadas. A inspeção identificou e corrigiu fechamento prematuro do seletor ao clicar no label, contraste do painel, sobreposição da toolbar móvel e largura do seletor em 320 px.

## Carbon

Resultado sanitizado em `auditoria-carbon.json`. Total final: 9 apontamentos, revistos conforme `relatorio.md`: seis falsos positivos/contexto de componentes e três exceções tipográficas locais aprovadas. Auditoria automatizada não foi descrita como limpa. Não foram adicionadas classes internas Carbon novas nos estilos desta entrega.

## Limites

- Não há verificação de suspensões/provimentos completa, teste jurídico com dados reais nem teste manual com leitor de tela.
- A consulta de capa e os cadastros usam contratos existentes do backend. Não foi alterada sua semântica de criação/tratamento de publicações por CNJ.
- Ordenação é local à página e isso é informado na interface.
- A memória de cálculo persistida contém resumo da fonte/consulta e parâmetros. O histórico completo do calendário é responsabilidade da futura integração.
