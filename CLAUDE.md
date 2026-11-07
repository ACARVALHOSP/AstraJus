# AstraJus — instruções para o agente

## Deploy
O deploy é **automático via GitHub Actions**. Há dois pipelines independentes:

### Frontend React/Radix (`frontend/`) — `deploy-radix.yml` ("Deploy Radix (C)")
Disparado a cada **push na branch `astrajus-radix`** (não depende de merge em `main`):
1. Verifica sintaxe Python
2. `npm ci` + `npm run build` em `frontend/`
3. Copia `frontend/dist/` via rsync para `/srv/astrajus-radix/` no VPS e recarrega o Caddy (nenhum container é reiniciado)
4. Checa `https://191-252-110-22.sslip.io/radix/`

Alterações no frontend Radix são publicadas assim que o push na `astrajus-radix` termina; acompanhe o workflow `deploy-radix.yml`.

### Interface legada (`static/`) e backend Python — `deploy.yml` ("Deploy para VPS")
Disparado por **merge/push na branch `main`**:
1. Verifica sintaxe Python e JS
2. SSH no VPS → `git pull` + `docker build` + `docker restart`
3. Checa `/healthz` para confirmar que o servidor subiu

Não é necessário nenhum comando manual de deploy. Status em:
`https://github.com/ACARVALHOSP/AstraJus/actions`

## Fluxo após cada alteração
O desenvolvimento acontece na branch `astrajus-radix`.

- **Somente frontend (`frontend/`, docs):** commit e push na `astrajus-radix`, depois verificar o workflow `deploy-radix.yml` via GitHub Actions API e reportar o resultado (success / failure). **Não** criar PR nem fazer merge em `main`.
- **Com alteração de backend (Python, `static/`, Dockerfile etc.):** após o push na `astrajus-radix`, perguntar se deve criar o PR e fazer o merge da `astrajus-radix` em `main`. Após o merge, verificar o workflow `deploy.yml` e reportar o resultado.
