# AstraJus — instruções para o agente

## Deploy
O deploy é **automático via GitHub Actions** (`.github/workflows/deploy.yml`).
Basta fazer merge na branch `main` — o pipeline roda sozinho:
1. Verifica sintaxe Python e JS
2. SSH no VPS → `git pull` + `docker build` + `docker restart`
3. Checa `/healthz` para confirmar que o servidor subiu

Não é necessário nenhum comando manual de deploy. Após o merge, acompanhe o status em:
`https://github.com/ACARVALHOSP/AstraJus/actions`

## Fluxo após cada alteração
Sempre que concluir uma alteração, perguntar ao usuário:
1. Quer criar um PR?
2. Quer fazer merge para main (e disparar o deploy)?
