import test from 'node:test'
import assert from 'node:assert/strict'
import { diaEHora, eventosAtividades, eventosMovimentacoes, eventosPublicacoes, eventosVinculos, montarLinha, rotuloDia, TIPOS } from '../src/routes/casos/linhaDoTempo.ts'

const TODOS = new Set(TIPOS.map(t => t.id))
const HOJE = '2026-11-13'
const opcoes = (extra = {}) => ({ tipos: TODOS, busca: '', hoje: HOJE, limite: 100, ...extra })

test('diaEHora: data pura, data e hora, e inválidas', () => {
  assert.deepEqual(diaEHora('2026-11-12'), { dia: '2026-11-12', hora: '' })
  assert.deepEqual(diaEHora('2026-11-12T14:05:00'), { dia: '2026-11-12', hora: '14:05' })
  assert.equal(diaEHora(''), null)
  assert.equal(diaEHora('amanhã'), null)
  assert.equal(diaEHora(undefined), null)
})

test('movimentações: ignora sem data e só mostra o número com vários processos', () => {
  const um = eventosMovimentacoes([{ numero: '1', grau: '1º grau', nome: 'Juntada', dataHora: '2026-11-11T10:00:00' }, { numero: '1', nome: 'Sem data' }])
  assert.equal(um.length, 1)
  assert.equal(um[0].detalhe, '1º grau')
  const dois = eventosMovimentacoes([{ numero: '10234567820248260100', grau: 'G', nome: 'A', dataHora: '2026-11-11T10:00:00' }, { numero: '20234567820248260100', nome: 'B', dataHora: '2026-11-10T10:00:00' }])
  assert.match(dois[0].detalhe, /0102345-67\.2024|1023456-78\.2024/)
})

test('publicações: data de disponibilização, status e marca de atividade criada', () => {
  const pubs = [{ hash: 'h1', status: 'nao_tratada', criado_em: '2026-11-13T09:00:00', dados: { data_disponibilizacao: '2026-11-12', tipoComunicacao: 'Intimação', nomeClasse: 'Procedimento Comum', siglaTribunal: 'tjsp', nomeOrgao: '12ª Vara', texto: 'Fica intimada…' } },
    { hash: 'h2', status: 'tratada', criado_em: '2026-10-28T09:00:00', dados: {} }]
  const ev = eventosPublicacoes(pubs, [{ id: 1, titulo: 'Réplica', origem_djen_hash: 'h2' }])
  assert.equal(ev[0].dia, '2026-11-12')
  assert.equal(ev[0].titulo, 'Intimação · Procedimento Comum')
  assert.equal(ev[0].detalhe, 'TJSP · 12ª Vara')
  assert.deepEqual(ev[0].selos.map(s => s.texto), ['Por revisar'])
  assert.equal(ev[1].dia, '2026-10-28') // sem data de disponibilização: usa a captura
  assert.deepEqual(ev[1].selos.map(s => s.texto), ['Tratada', 'Gerou atividade'])
  assert.equal(ev[1].titulo, 'Publicação')
})

test('publicações: texto muito longo é cortado', () => {
  const ev = eventosPublicacoes([{ hash: 'x', status: 'tratada', dados: { data_disponibilizacao: '2026-11-01', texto: 'a'.repeat(5000) } }], [])
  assert.equal(ev[0].texto.length, 1501)
  assert.ok(ev[0].texto.endsWith('…'))
})

test('atividades: sem data ficam de fora; mostra tipo, situação e responsável', () => {
  const ev = eventosAtividades([
    { id: 'a', tipo: 'prazo', titulo: 'Réplica', status: 'concluida', data: '2026-11-03', hora: '10:00', responsavel: 'ana', observacoes: ' ok ' },
    { id: 'b', tipo: 'tarefa', titulo: 'Sem data', status: 'pendente' },
  ], l => (l === 'ana' ? 'Ana Souza' : ''))
  assert.equal(ev.length, 1)
  assert.deepEqual(ev[0].selos.map(s => s.texto), ['Prazo', 'Concluída'])
  assert.equal(ev[0].detalhe, 'Responsável: Ana Souza')
  assert.equal(ev[0].texto, 'ok')
})

test('vínculos: precisam da data de criação', () => {
  const ev = eventosVinculos([{ caso_id: 'c1', tipo: 'recurso', titulo: 'Apelação', cliente_nome: 'Maria', criado_em: '2026-10-20T08:00:00' }, { caso_id: 'c2', tipo: 'apenso' }])
  assert.equal(ev.length, 1)
  assert.equal(ev[0].titulo, 'Processo vinculado · Apelação')
  assert.equal(ev[0].selos[0].texto, 'Recurso')
})

const eventos = [
  ...eventosAtividades([
    { id: '1', tipo: 'prazo', titulo: 'Prazo futuro', status: 'pendente', data: '2026-11-17' },
    { id: '2', tipo: 'tarefa', titulo: 'Juntar procuração', status: 'concluida', data: '2026-11-03' },
  ]),
  ...eventosMovimentacoes([{ numero: '1', nome: 'Citação', dataHora: '2026-10-28T15:00:00' }, { numero: '1', nome: 'Juntada de contestação', dataHora: '2026-11-11T10:00:00' }]),
  ...eventosPublicacoes([{ hash: 'p', status: 'tratada', dados: { data_disponibilizacao: '2026-10-28', tipoComunicacao: 'Despacho', texto: 'Cite-se o réu' } }], []),
]

test('montarLinha: oculta o futuro, ordena do mais recente e agrupa por dia', () => {
  const r = montarLinha(eventos, opcoes())
  assert.equal(r.futurosOcultos, 1)
  assert.equal(r.total, 4)
  assert.deepEqual(r.grupos.map(g => g.dia), ['2026-11-11', '2026-11-03', '2026-10-28'])
  assert.equal(r.grupos[2].eventos.length, 2) // citação e despacho no mesmo dia
  assert.equal(r.contagem.atividade, 1)
})

test('montarLinha: filtro por tipo e busca sem acento', () => {
  assert.equal(montarLinha(eventos, opcoes({ tipos: new Set(['publicacao']) })).total, 1)
  assert.equal(montarLinha(eventos, opcoes({ busca: 'PROCURAÇÃO' })).total, 1)
  assert.equal(montarLinha(eventos, opcoes({ busca: 'procuracao' })).total, 1)
  assert.equal(montarLinha(eventos, opcoes({ busca: 'cite-se' })).total, 1) // procura também no texto
  assert.equal(montarLinha(eventos, opcoes({ busca: 'zzz' })).grupos.length, 0)
})

test('montarLinha: o limite corta a lista mas informa o total', () => {
  const r = montarLinha(eventos, opcoes({ limite: 2 }))
  assert.equal(r.mostrados, 2)
  assert.equal(r.total, 4)
  assert.equal(r.grupos.reduce((n, g) => n + g.eventos.length, 0), 2)
})

test('rotuloDia: Hoje, Ontem e dias antigos', () => {
  assert.equal(rotuloDia('2026-11-13', HOJE), 'Hoje · sexta-feira, 13 de novembro de 2026')
  assert.equal(rotuloDia('2026-11-12', HOJE), 'Ontem · quinta-feira, 12 de novembro de 2026')
  assert.equal(rotuloDia('2026-10-28', HOJE), 'quarta-feira, 28 de outubro de 2026')
})
