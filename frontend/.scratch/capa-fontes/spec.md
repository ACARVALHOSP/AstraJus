# Capa com dados disponíveis por fonte

Status: ready-for-agent

Falha confirmada no processo da imagem: o DataJud não o encontra no TRT-2; o DJEN retorna publicações com siglaTribunal, nomeOrgao e nomeClasse. Esses campos eram descartados pela montagem da capa, que ainda indicava atualização completa.

Usar os campos da publicação mais recente que os informa como alternativa ao DataJud. Manter a precedência do DataJud quando houver valor. Preservar valores já salvos quando uma fonte não disponibilizar um campo; sigilo zero é válido. Data de publicação não é data de distribuição.

Retornar aviso de atualização parcial quando o processo não for encontrado no DataJud e exibir esse aviso na interface. Ausência de dados nas duas fontes deve devolver erro sem salvar a capa.
