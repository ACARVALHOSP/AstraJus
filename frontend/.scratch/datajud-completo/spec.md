# DataJud completo

Preservar todos os campos da tabela solicitada sem perder tipos, códigos, listas ou instâncias.

Diagnóstico: a consulta já solicitava `_source` sem filtro, mas o extrator descartava formato, sistema, nível de sigilo, códigos de classe/assuntos/órgão e órgão dos movimentos. A capa tinha tribunal, CNJ, grau, distribuição, sigilo, nomes e movimentos parciais; não havia armazenamento durável completo para processos apenas monitorados. O preenchimento do sigilo usava uma chave incorreta.

Contrato: `processos[].datajud` contém o documento original completo com chaves DataJud. Campos simplificados existentes permanecem compatíveis. `capa.datajud` guarda todas as instâncias. SQLite usa JSON para preservar objetos, arrays e inteiros sem achatar os dados. `processos_datajud` guarda snapshots completos por CNJ/tribunal, independentes do TTL do cache. Ausência na fonte permanece nula; não inventar valores.

Migração aditiva e idempotente. Cache v2 evita reutilizar retornos antigos incompletos. Atualização periódica inclui cadastros sem capa e monitoramentos por CNJ, com tentativa inicial na partida do serviço. Monitoramentos por OAB serão contemplados quando houver um CNJ cadastrado ou monitorado; OAB não identifica um único processo.

Campos manuais da capa permanecem independentes do snapshot oficial. Processos sem CNJ ou sem resultado público não podem receber dados inventados. Falhas de consulta preservam snapshots anteriores.
