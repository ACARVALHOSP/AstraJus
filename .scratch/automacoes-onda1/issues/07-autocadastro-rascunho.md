# Autocadastro como rascunho

Status: needs-info
Blocked by: 01, 05
Tamanho: G
Spec: ../spec.md

Ver spec, seção 6. Cria caso em rascunho só quando exatamente um cliente é reconhecido (`polos.py`); teto por dia;
simulação obrigatória na primeira ativação; rascunho fora de alertas, financeiro e relatórios até confirmar.

Bloqueado por decisão do escritório: aceitar criar só com cliente reconhecido de forma única?

## Aceite
- Cliente único reconhecido gera um rascunho, e só um, mesmo com a rotina repetida.
- Cliente não reconhecido ou ambíguo não gera caso; descartar devolve a publicação à fila.
- Teto diário respeitado; rascunho não dispara alerta de processo parado.
