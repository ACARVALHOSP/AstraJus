# Integração futura de feriados municipais e provimentos

Status: needs-triage
Type: task

Escopo futuro expressamente reservado pelo usuário, fora da primeira implementação.

Integrar fontes oficiais por município/comarca, tribunal, grau e ano. Separar feriados, suspensões da contagem, indisponibilidade de sistemas e atos sem suspensão. Registrar URL do ato, período de vigência, abrangência, data de consulta e cobertura comprovada. Não sinalizar calendário completo com base em lista vazia ou em calendário de outra comarca.

Usar `ProvedorCalendario` de `src/routes/publicacoes-oab/prazos.ts`, injetável em `AtividadePublicacao`. Definir atualização, cache e invalidação, tratamento de anos futuros ainda não publicados e seleção inequívoca do município. Não publicar mudança de regra retroativa sobre atividades existentes sem revisão.

Aceite futuro: testes com feriado local, provimento de suspensão, diferenças por grau, ano atravessado, fonte indisponível, calendário vencido e município ambíguo; memória de cálculo reproduzível e fontes acessíveis ao usuário.
