# Central de notificações React

Prévia aprovada explicitamente pelo usuário em 30/10/2026.

## Escopo

Completar o feed individual já existente para atividade atribuída e publicação monitorada, aproveitando as APIs persistentes. Novos eventos de vencimento, integrações e preferências ficam fora desta entrega.

## Critérios de aceitação

- Filtrar imediatamente por não lidas, reiniciando a paginação e descartando respostas do filtro anterior.
- Atualizar a contagem ao conectar, retornar à aba/janela e a cada 60 segundos enquanto a página estiver visível.
- Revalidar o destino por GET /notificacoes/:id/destino. Abrir não altera a leitura.
- Abrir a atividade indicada ou a aba Publicações do processo; funcionar também navegando a partir da própria área Processos.
- Marcar como lida somente por ação explícita, sem duplicar requisições, usando a data devolvida pelo servidor.
- Desmontar o feed ao trocar de credencial e cancelar requisições antigas.
- Distinguir vazio confirmado de falha; oferecer nova tentativa e anunciar estados de forma acessível.
- Preservar paginação, retenção de 180 dias, temas white/g100, teclado e largura de celular.

## Validação

Build TypeScript/Vite, lint e verificações no navegador com APIs simuladas, incluindo concorrência, isolamento de sessão e destinos indisponíveis. Auditoria Carbon dos arquivos alterados.
