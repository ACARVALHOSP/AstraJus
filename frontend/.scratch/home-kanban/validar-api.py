import sys
from pathlib import Path
sys.path.insert(0, str(Path.cwd().parent))
from test_origem_djen import OrigemDjenTest
fixture = OrigemDjenTest()
fixture.setUp()
try:
    atividade = fixture.criar(titulo='Validar Kanban')
    for status in ['em_andamento', 'aguardando', 'concluida', 'pendente']:
        codigo, atual = fixture.chamar('PATCH', fixture.rota + '/' + str(atividade['id']), {'status': status})
        assert codigo == 200 and atual['status'] == status, (codigo, atual)
        codigo, dados = fixture.chamar('GET', fixture.rota)
        assert codigo == 200 and dados['atividades'][0]['status'] == status, dados
    assert fixture.publicacoes.obter('pub-A')['status'] == 'nao_tratada'
    print('API autenticada: quatro status persistidos e relidos; publicacao permanece nao tratada; banco temporario.')
finally:
    fixture.doCleanups()
