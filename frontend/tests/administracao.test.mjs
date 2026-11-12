import assert from 'node:assert/strict'
import test from 'node:test'
import { PERFIS, aplicarPerfil, grauEfetivo, perfilDe } from '../src/routes/administracao/perfis.ts'
import { haQuanto, lerValorHora } from '../src/routes/administracao/formatos.ts'

const perfil = id => PERFIS.find(p => p.id === id)

test('cada perfil pronto grava só o que difere do padrão do nível', () => {
  assert.deepEqual(aplicarPerfil(perfil('administrador')), { nivel_acesso: 'administrador', permissoes: {} })
  assert.deepEqual(aplicarPerfil(perfil('consulta')), { nivel_acesso: 'consulta', permissoes: {} })
  const adv = aplicarPerfil(perfil('advogado'))
  assert.equal(adv.nivel_acesso, 'operador')
  assert.deepEqual(adv.permissoes, { financeiro: 'nenhum', pagamentos: 'nenhum', integracoes: 'nenhum' })   // o resto já é "editar"
  const sec = aplicarPerfil(perfil('secretaria')).permissoes
  assert.equal(sec.casos, 'ver'); assert.equal(sec.contatos, undefined); assert.equal(sec.financeiro, 'nenhum')
  const fin = aplicarPerfil(perfil('financeiro')).permissoes
  assert.equal(fin.financeiro, undefined); assert.equal(fin.pagamentos, undefined); assert.equal(fin.casos, 'nenhum'); assert.equal(fin.contatos, 'ver')
})

test('acesso efetivo: padrão do nível, personalização e teto da consulta', () => {
  assert.equal(grauEfetivo('operador', {}, 'casos'), 'editar')
  assert.equal(grauEfetivo('operador', { casos: 'ver' }, 'casos'), 'ver')
  assert.equal(grauEfetivo('consulta', {}, 'casos'), 'ver')
  assert.equal(grauEfetivo('consulta', { casos: 'editar' }, 'casos'), 'ver')
  assert.equal(grauEfetivo('consulta', { casos: 'nenhum' }, 'casos'), 'nenhum')
  assert.equal(grauEfetivo('administrador', { casos: 'nenhum' }, 'casos'), 'editar')
})

test('reconhece qual perfil pronto o acesso atual representa', () => {
  for (const p of PERFIS) assert.equal(perfilDe(p.nivel, aplicarPerfil(p).permissoes)?.id, p.id, p.id)
  assert.equal(perfilDe('operador', {})?.id, undefined)                                            // operador com tudo liberado não é nenhum perfil pronto
  assert.equal(perfilDe('operador', { financeiro: 'nenhum', pagamentos: 'nenhum', integracoes: 'nenhum', casos: 'ver' }), null)   // advogado personalizado
  assert.equal(perfilDe('consulta', { casos: 'nenhum' }), null)
  assert.equal(perfilDe('administrador', { casos: 'nenhum' })?.id, 'administrador')
})

test('os perfis prontos são diferentes entre si', () => {
  const chaves = PERFIS.map(p => JSON.stringify(aplicarPerfil(p)))
  assert.equal(new Set(chaves).size, PERFIS.length)
})

test('tempo desde o último acesso', () => {
  const agora = new Date('2026-11-12T15:00:00Z')
  const ha = (ms) => new Date(agora.getTime() - ms).toISOString()
  const MIN = 60e3, H = 60 * MIN, D = 24 * H
  assert.equal(haQuanto(null, agora), 'Nunca acessou')
  assert.equal(haQuanto('lixo', agora), 'Não registrado')
  assert.equal(haQuanto(ha(20e3), agora), 'agora há pouco')
  assert.equal(haQuanto(ha(-5 * MIN), agora), 'agora há pouco')            // relógio adiantado
  assert.deepEqual([5 * MIN, 59 * MIN].map(x => haQuanto(ha(x), agora)), ['há 5 min', 'há 59 min'])
  assert.deepEqual([H, 23 * H].map(x => haQuanto(ha(x), agora)), ['há 1 h', 'há 23 h'])
  assert.equal(haQuanto(ha(30 * H), agora), 'ontem')
  assert.deepEqual([2 * D, 29 * D].map(x => haQuanto(ha(x), agora)), ['há 2 dias', 'há 29 dias'])
  assert.deepEqual([30 * D, 75 * D, 330 * D].map(x => haQuanto(ha(x), agora)), ['há 1 mês', 'há 2 meses', 'há 11 meses'])
  assert.deepEqual([400 * D, 800 * D].map(x => haQuanto(ha(x), agora)), ['há 1 ano', 'há 2 anos'])
})

test('lê o valor por hora digitado', () => {
  assert.equal(lerValorHora(''), null)
  assert.equal(lerValorHora('   '), null)
  assert.equal(lerValorHora('300'), 300)
  assert.equal(lerValorHora('300,5'), 300.5)
  assert.equal(lerValorHora('R$ 1.250,00'), 1250)
  assert.equal(lerValorHora('99.99'), 99.99)
  for (const ruim of ['0', '-5', 'abc', '1,234', '100001', '1.2.3', '3,0,0']) assert.equal(lerValorHora(ruim), undefined, ruim)
})

import { descreverCampos, rotuloAcao } from '../src/routes/administracao/formatos.ts'

test('campos do histórico: lista de cadastro, objeto da limpeza e dados estranhos nunca quebram', () => {
  assert.equal(descreverCampos('["nome_completo","permissoes"]'), 'Nome, Acesso por área')
  assert.equal(descreverCampos('[]'), '')
  // "Limpar dados" grava um objeto, e não uma lista (era o que derrubava a tela)
  assert.equal(descreverCampos('{"publicacoes": 12, "notificacoes": 0}'), 'Publicações capturadas: 12 registro(s) apagado(s); Notificações: 0 registro(s) apagado(s)')
  assert.equal(descreverCampos('{"outra": 3}'), 'outra: 3')
  assert.equal(descreverCampos('texto solto'), 'texto solto')   // não é JSON
  assert.equal(descreverCampos('"permissoes"'), 'permissoes')   // JSON de uma string
  assert.equal(descreverCampos('42'), '42')
  assert.equal(descreverCampos('null'), '')
  assert.equal(descreverCampos(null), '')
  assert.equal(descreverCampos(undefined), '')
  assert.equal(descreverCampos(['status']), 'Status')            // já veio como lista
})

test('rótulos das ações do histórico', () => {
  assert.deepEqual(['criar', 'atualizar', 'limpar_banco', 'outra'].map(rotuloAcao), ['Cadastro criado', 'Cadastro alterado', 'Limpeza de dados', 'outra'])
})

import { listarEmFrase, resumoVinculos } from '../src/routes/administracao/formatos.ts'

const zero = { processos: 0, atividades: 0, lancamentos: 0, monitoramentos: 0, notificacoes: 0, horas: 0, agenda: 0 }

test('resumo da exclusão: o que fica sem responsável, o que some e o que fica', () => {
  const r = resumoVinculos({ ...zero, processos: 1, atividades: 12, lancamentos: 3, monitoramentos: 1, notificacoes: 40, horas: 2 })
  assert.deepEqual(r.desatribuidos, ['1 processo', '12 atividades', '3 lançamentos financeiros'])
  assert.deepEqual(r.removidos, ['1 monitoramento de publicações', '40 notificações', 'preferências, valor por hora, cronômetro e conexão com a Google Agenda'])
  assert.deepEqual(r.mantidos, ['2 lançamentos de horas (histórico de trabalho)'])
  assert.equal(r.bloqueio, null)
})

test('resumo da exclusão sem nada ligado e com agenda sincronizada', () => {
  const vazio = resumoVinculos(zero)
  assert.deepEqual([vazio.desatribuidos, vazio.mantidos, vazio.bloqueio], [[], [], null])
  assert.equal(vazio.removidos.length, 1)
  assert.match(resumoVinculos({ ...zero, agenda: 1 }).bloqueio, /^1 atividade sincronizada com a Google Agenda/)
  assert.match(resumoVinculos({ ...zero, agenda: 3 }).bloqueio, /^3 atividades sincronizadas/)
  assert.deepEqual(resumoVinculos({ ...zero, horas: 1 }).mantidos, ['1 lançamento de horas (histórico de trabalho)'])
})

test('lista em frase', () => {
  assert.equal(listarEmFrase([]), '')
  assert.equal(listarEmFrase(['a']), 'a')
  assert.equal(listarEmFrase(['a', 'b']), 'a e b')
  assert.equal(listarEmFrase(['a', 'b', 'c']), 'a, b e c')
})

test('histórico: novo token e exclusão de usuário em português', () => {
  assert.deepEqual(['novo_token', 'apagar'].map(rotuloAcao), ['Novo token gerado', 'Usuário apagado'])
  assert.equal(descreverCampos('[]'), '')
  assert.equal(descreverCampos('{"processos": 2, "atividades": 0, "lancamentos": 1, "monitoramentos": 0, "horas": 3}'),
    'Processos sem responsável: 2; Lançamentos sem responsável: 1; Horas mantidas: 3')
  assert.equal(descreverCampos('{"publicacoes": 0}'), 'Publicações capturadas: 0 registro(s) apagado(s)')   // a limpeza continua mostrando zeros
})
