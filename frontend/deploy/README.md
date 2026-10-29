# Deploy independente do frontend

## Acesso e arquitetura

- Usuário SSH do VPS: **admin** (não root).
- Host: `191.252.110.22`; site: `https://191-252-110-22.sslip.io`.
- Caddy instalado no host, serviço `caddy`, configuração `/etc/caddy/Caddyfile`.
- O container `cnj-processual` continua na porta local 8000 com interface antiga e APIs. O container `gestao-2fa` pertence a outro sistema e não participa deste deploy.
- Apenas `/novo` e `/novo/*` recebem novas rotas. `/app`, APIs e o outro domínio continuam com os proxies existentes.

## Publicação

O workflow `.github/workflows/deploy-frontend.yml` executa no push da branch `astrajus-react` quando há alterações em `frontend/` ou no próprio workflow. Compila com Node 24 e `npm ci`/`npm run build`, sem Docker. Usa o secret `VPS_SSH_KEY`, o host de `VPS_HOST` e o usuário fixo `admin`.

O host SSH é verificado contra `known_hosts`, que contém somente a chave pública previamente reconhecida do VPS. Se o servidor trocar sua chave, conferir o fingerprint por um canal confiável antes de atualizar esse arquivo.

Arquivos públicos ficam em `/srv/astrajus-frontend/releases/<SHA>`. O link `current` muda atomicamente após a extração e verificação do checksum. Assets com hash são acumulados em `/srv/astrajus-frontend/assets`, preservando abas abertas em versões anteriores. Nenhum arquivo do backend é sobrescrito e nenhum container é reiniciado. Não há limpeza automática de releases/assets; acompanhar espaço em disco.

O script `publish.sh` verifica a versão pública, HTML e `/healthz`; em caso de falha restaura o link anterior. Credenciais do backend não são copiadas para a pasta pública. `release.txt` identifica o SHA publicado.

## Provisionamento inicial

Publicar uma versão inicial na pasta exclusiva, instalar `novo.caddy` em `/etc/caddy/astrajus-novo.caddy` e executar `configure_proxy.py` com sudo. O script exige o site conhecido, valida a configuração candidata e cria backup antes do reload. Preserva os demais blocos e cabeçalhos. Esse provisionamento não faz parte de cada deploy.

## Voltar uma versão

Escolher um release existente, conferir seu `release.txt`, criar um novo symlink temporário dentro de `/srv/astrajus-frontend` e substituí-lo por `current` com `mv -T`. Em seguida conferir `/novo/release.txt`, `/novo/` e `/healthz`. Não é preciso reiniciar Caddy ou o backend.

Para desativar o roteamento estático, restaurar o backup indicado pelo provisionamento, validar o Caddyfile e recarregar o Caddy. Isso devolve `/novo` ao proxy anterior.
