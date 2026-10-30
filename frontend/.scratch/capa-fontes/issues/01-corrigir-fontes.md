# Corrigir campos ausentes na atualização da capa

Status: resolved
Type: task

## Answer

O backend aproveita tribunal, órgão julgador e classe das publicações mais recentes do DJEN quando o DataJud não informa esses valores. Dados ausentes não apagam campos anteriormente preenchidos. Respostas sem dados em ambas as fontes não salvam a capa. O retorno informa atualização parcial e o React exibe o aviso recebido.

Regressões cobrem preservação de distribuição, grau, sigilo zero, assuntos, movimentos e valor da causa; precedência do DataJud; seleção por data de publicação; resposta HTTP e ausência de dados nas duas fontes. Build e lint do React concluídos.
