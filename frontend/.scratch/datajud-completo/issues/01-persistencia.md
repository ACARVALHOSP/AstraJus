# Consultas e persistência DataJud completas

Status: resolved
Type: task

Implementar o contrato descrito em ../spec.md e validar códigos, objetos, listas, instâncias, sigilo zero, cache legado e inclusão de cadastros sem capa.

## Answer

Extração sem descarte de campos, snapshot durável e migração aditiva implementados no backend. Snapshot e capa completos usam JSON para conservar o formato do DataJud. A rotina recorrente preenche cadastros sem capa e monitoramentos por CNJ, além de atualizar os já vinculados.

Auditoria somente leitura do banco local antes da migração: 9 vínculos de processos cadastrados, nenhuma capa e nenhum monitoramento. Esses números dizem respeito somente ao arquivo local cnj.db; o banco do VPS não foi inspecionado.
