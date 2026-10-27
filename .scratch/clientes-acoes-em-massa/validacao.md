# Validação e publicação de Clientes

Data: 27/10/2026. PR: https://github.com/ACARVALHOSP/AstraJus/pull/91.

## Resultado

- Backend: 300 testes aprovados, usando o ambiente virtual do projeto e dados temporários, sem rede real.
- Ações em massa: cinco jornadas de navegador aprovadas com SQLite temporário real. Cobrem aplicação/remoção de etiquetas, atualização de perfil, prévia sem escrita, conflitos, confirmação sem mudanças, falha/repetição, seleção parcial e limpeza por filtro.
- JavaScript: `test_progress_controls.cjs`, `test_feedback_requests.cjs` e verificações de sintaxe aprovados.
- Lista/modal verificados em 1440, 768, 390 e 320 px; temas White/Gray 100; Tab confinado ao modal, Escape e retorno ao acionador verificados.
- Regressão ampliada: 81 testes de interface executados, 72 aprovados e nove falhas/erros. Os mesmos nove casos foram executados numa cópia isolada da main `d469bf271e82087bba7f03139e586671fc1cb35d` e reproduziram as mesmas falhas. Nenhuma nova falha detectada pelo conjunto executado; a suíte completa não está integralmente verde.

## Pendências preexistentes reproduzidas

| Teste | Resultado em main e no PR |
| --- | --- |
| `test_auditoria_menu_movel_e_alternador_teclado` | Expectativa de End/Home não acompanha a ordem Cards/Tabela atual |
| `test_cadastro_de_caso_por_publicacao_salva_ao_sair` | Erro assíncrono Lit/Carbon: Cannot set properties of null (setting 'data') |
| `test_capa_unifica_cadastro_e_atualiza_movimentacoes` | Mesmo erro assíncrono Lit/Carbon |
| `test_dropdowns_de_duas_opcoes_usam_radios_e_preservam_valor` | Helper tenta clicar input nativo coberto pela aparência do radio Carbon |
| `test_indicador_ativo_e_foco_e_dialogo_sem_botoes_transbordando` | Ação do diálogo ultrapassa limite esquerdo no viewport pequeno |
| `test_paineis_do_cabecalho_permanecem_dentro_da_tela` | Painel ultrapassa 320 px (extremo direito 330,8 px) |
| `test_prazo_rotulos_associados_e_foco_independente_entre_paineis` | Teste tenta clicar label nativo oculto pela conversão para Carbon |
| `test_publicacoes_webcomponents_m_paginacao_selecao_entre_paginas_e_catalogo_completo` | Seletor por label encontra três elementos após conversão para Carbon |
| `test_revisao_atividades_filtra_executor_independente_do_processo` | Expectativa de capitalização anterior: para/Para |

Esses testes não foram ignorados ou alterados para ocultar as falhas. As correções da aba Clientes e as ações em massa são publicadas sem reverter os fluxos anteriormente entregues. As pendências acima continuam disponíveis para triagem posterior; não representam certificação de conformidade ou teste completo com leitor de tela.

## Ambiente e escopo

Regressão ampliada e comparação: Playwright 1.64.1 do ambiente virtual do projeto com Chrome atual. A execução inicial pelo Python do sistema usava Playwright 1.47.0 e foi interrompida; seu resultado incompleto não entra nos números acima.

As capturas locais ficam em `output/playwright/clientes-lote/`; bancos temporários, dependências, backups da integração e capturas não são incluídos no PR. A migração é aditiva e a confirmação em massa usa transação única, atualização direcionada e comparação de estado esperado.
