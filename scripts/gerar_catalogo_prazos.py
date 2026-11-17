"""Gera frontend/src/routes/publicacoes-oab/prazosCatalogo.ts a partir das tabelas de prazos do SIJUR (Markdown).

Uso: python3 scripts/gerar_catalogo_prazos.py <pasta com 005-*.md, 006-*.md e 007-*.md> frontend/src/routes/publicacoes-oab/prazosCatalogo.ts
"""
import re, json, sys
SRC = sys.argv[1]; OUT = sys.argv[2]
arquivos = [('cpc','005-ferramentas-prazos-do-cpc.md','Código de Processo Civil'),
            ('clt','006-ferramentas-prazos-trabalhistas.md','Processo do trabalho (CLT)'),
            ('cpp','007-ferramentas-prazos-processo-penal.md','Processo penal (CPP)')]
def limpa(s):
    s = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', s)
    s = re.sub(r'\s+', ' ', s.replace('\\|','/')).strip()
    return s.replace('**','')
saida = []
for ramo, arq, rot in arquivos:
    grupo = None; n = 0
    for linha in open(f'{SRC}/{arq}', encoding='utf-8'):
        if not linha.startswith('|'): continue
        c = [limpa(x) for x in linha.strip().strip('|').split('|')]
        if len(c) != 3 or c[0] in ('Ato','---'): continue
        if c[1] == '' and c[2] == '': grupo = c[0]; continue
        m = re.fullmatch(r'(\d{1,3}) dias?', c[1])
        if not m or int(m.group(1)) < 1: continue
        contagem = 'corridos' if ramo == 'cpp' or (ramo == 'clt' and grupo.startswith('Contrato')) else 'uteis'
        n += 1
        saida.append(dict(id=f'{ramo}-{n}', ramo=ramo, grupo=grupo, rotulo=c[0], dias=int(m.group(1)), base=c[2], contagem=contagem))
for r in ('cpc','clt','cpp'): print(r, sum(1 for s in saida if s['ramo']==r), file=sys.stderr)
corpo = json.dumps(saida, ensure_ascii=False, indent=0).replace('\n','')
# uma entrada por linha
linhas = ',\n  '.join(json.dumps(s, ensure_ascii=False) for s in saida)
open(OUT,'w',encoding='utf-8').write(f'''// Gerado a partir das tabelas de prazos do SIJUR (CPC, CLT e CPP): só os prazos fixados em dias.
// Prazos em horas, meses ou anos, e os que dependem de condição, ficam de fora do cálculo.
// A data é sempre uma sugestão a revisar. Regras de contagem: CPC arts. 219 e 224; CLT art. 775; CPP art. 798.
export type RamoPrazo = 'cpc' | 'clt' | 'cpp'
export type PrazoCatalogo = {{ id: string; ramo: RamoPrazo; grupo: string; rotulo: string; dias: number; base: string; contagem: 'uteis' | 'corridos' }}
export const ROTULO_RAMO: Record<RamoPrazo, string> = {{ cpc: 'Processo civil (CPC)', clt: 'Processo do trabalho (CLT)', cpp: 'Processo penal (CPP)' }}
export const PRAZOS_CATALOGO: readonly PrazoCatalogo[] = [
  {linhas},
]
''')
