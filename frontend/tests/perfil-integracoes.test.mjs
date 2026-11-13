import test from 'node:test'
import assert from 'node:assert/strict'
import { avaliarPerfil } from '../src/utils/perfil.ts'
import { recorteQuadrado, validarArquivoFoto } from '../src/utils/foto.ts'
import { agruparCatalogo, estadoAtual, linhaHistorico, mesmoConteudo, seloItem, textoAjuda, tituloItem } from '../src/routes/administracao/integracoes.ts'

const atual = { nome: 'Ana Souza', email: 'ana@teste.com', foto: '' }

test('perfil: sem mudança não há o que salvar', () => {
  assert.deepEqual(avaliarPerfil(atual, atual), { erro: null, mudancas: {}, alterado: false })
})
test('perfil: só entram as mudanças, com espaços aparados', () => {
  const r = avaliarPerfil(atual, { nome: '  Ana S.  ', email: 'ana@teste.com', foto: 'data:image/jpeg;base64,AAAA' })
  assert.deepEqual(r.mudancas, { nome_completo: 'Ana S.', foto: 'data:image/jpeg;base64,AAAA' })
  assert.equal(r.alterado, true)
})
test('perfil: validações do nome e do e-mail', () => {
  assert.match(avaliarPerfil(atual, { ...atual, nome: '  ' }).erro, /nome/)
  assert.match(avaliarPerfil(atual, { ...atual, email: '' }).erro, /e-mail/)
  assert.match(avaliarPerfil(atual, { ...atual, email: 'sem-arroba' }).erro, /válido/)
  assert.equal(avaliarPerfil(atual, { ...atual, email: 'outra@teste.com' }).erro, null)
})
test('perfil: remover a foto é uma mudança', () => {
  assert.deepEqual(avaliarPerfil({ ...atual, foto: 'data:image/png;base64,AA' }, atual).mudancas, { foto: '' })
})
test('foto: recorte quadrado centralizado', () => {
  assert.deepEqual(recorteQuadrado(400, 200), [100, 0, 200])
  assert.deepEqual(recorteQuadrado(200, 500), [0, 150, 200])
  assert.deepEqual(recorteQuadrado(300, 300), [0, 0, 300])
})
test('foto: tipos e tamanho aceitos', () => {
  assert.equal(validarArquivoFoto({ type: 'image/png', size: 1000 }), null)
  assert.match(validarArquivoFoto({ type: 'application/pdf', size: 1000 }), /JPEG/)
  assert.match(validarArquivoFoto({ type: 'image/jpeg', size: 20 * 1024 * 1024 }), /grande/)
})

const item = (extra = {}) => ({ provedor: 'zapsign', ambiente: 'padrao', escopo: 'escritorio', versao: 0, estado: 'nao_configurado', parametros: {}, segredos: {}, testado_em: null, ...extra })

test('integrações: selos de estado', () => {
  assert.deepEqual(seloItem(item(), 'sandbox', false), { texto: 'Não configurado', cor: 'gray' })
  assert.equal(seloItem(item({ estado: 'ativo', versao: 2 }), 'sandbox', false).texto, 'Configurado')
  assert.equal(seloItem(item({ provedor: 'drive' }), 'sandbox', true).texto, 'Conta conectada')
  const asaas = item({ provedor: 'asaas', ambiente: 'producao', estado: 'ativo', versao: 1 })
  assert.equal(seloItem(asaas, 'producao', false).texto, 'Em uso')
  assert.equal(seloItem(asaas, 'sandbox', false).texto, 'Configurado')
})
test('integrações: títulos, estado e histórico', () => {
  assert.equal(tituloItem({ provedor: 'asaas', ambiente: 'sandbox' }), 'Asaas · Homologação')
  assert.equal(tituloItem({ provedor: 'smtp', ambiente: 'padrao' }), 'E-mail (SMTP)')
  assert.equal(estadoAtual(item()), 'Não configurado.')
  assert.match(estadoAtual(item({ estado: 'ativo', versao: 3 })), /versão 3 · Não testada/)
  assert.match(linhaHistorico({ instante: 1700000000, autor: 'usuario:ana', provedor: 'smtp', ambiente: 'padrao', acao: 'ativacao', resultado: 'ok' }, true), /usuario:ana · E-mail \(SMTP\) · ativacao · ok/)
})
test('integrações: agrupa por escopo e compara conteúdo', () => {
  const g = agruparCatalogo([item(), item({ provedor: 'smtp', escopo: 'sistema' })])
  assert.deepEqual(g.map(x => [x.chave, x.itens.length]), [['escritorio', 1], ['sistema', 1]])
  assert.equal(agruparCatalogo([item()]).length, 1)
  assert.equal(mesmoConteudo({ a: '1' }, { a: '1' }), true)
  assert.equal(mesmoConteudo({ a: '1' }, { a: '2' }), false)
  assert.match(textoAjuda('google_oauth', 'https://x.test'), /https:\/\/x\.test\/integracoes\/google\/callback/)
})
