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
Sempre que concluir uma alteração:
1. Perguntar: quer criar um PR?
2. Perguntar: quer fazer merge para main?
3. Verificar o status do workflow correspondente via GitHub Actions API e reportar o resultado (success / failure):
   - mudanças em `frontend/` → `deploy-radix.yml` (já roda no push da `astrajus-radix`)
   - mudanças no backend ou em `static/` → `deploy.yml` (roda após o merge em `main`)
