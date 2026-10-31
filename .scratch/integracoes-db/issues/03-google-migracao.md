# Separar Drive institucional e Calendar individual
Status: ready-for-human

Migrar conexão atual para Drive, exigir consentimento por usuário para Calendar e reconciliar eventos sem duplicação. Migrar variáveis idempotentemente com backup e rollback.

Critérios de aceite: cumprir os requisitos correspondentes em ../spec.md.


## Comments

2026-10-28: implementação local concluída e validada. Suíte principal: 287 testes aprovados; revisão final de segurança: 19 aprovados. Interface verificada em Chrome desktop/mobile. Publicação e migração da VPS não executadas. Cadastro Carbon segue aguardando detalhes do ajuste solicitado pelo usuário.
