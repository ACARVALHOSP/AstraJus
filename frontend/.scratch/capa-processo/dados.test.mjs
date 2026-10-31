import assert from 'node:assert/strict'
import { clienteDaParte, dataCapa, poloDaParte } from '../../src/routes/casos/dadosCapa.ts'
const registros = [{ id: '1', nome: 'João Silva', cpf_cnpj: '123.456.789-01', perfil: 'cliente' }]
assert.equal(clienteDaParte({ nome: ' JOAO  SILVA ' }, registros, ['1'])?.id, '1')
assert.equal(clienteDaParte({ nome: 'João Silva' }, registros, []), undefined)
assert.equal(clienteDaParte({ nome: 'João Silva' }, [...registros, { id: '2', nome: 'João Silva' }], ['1']), undefined)
assert.equal(clienteDaParte({ nome: 'João Silva', cpf_cnpj: '99999999999' }, registros, ['1']), undefined)
assert.equal(clienteDaParte({ nome: 'Outro nome', cpf_cnpj: '12345678901' }, registros, ['1'])?.id, '1')
assert.equal(clienteDaParte({ cliente_id: '2', nome: 'João Silva' }, registros, ['1']), undefined)
assert.equal(clienteDaParte({ nome: 'João Silva' }, [{ ...registros[0], perfil: 'parte_contraria' }], ['1']), undefined)
assert.equal(clienteDaParte({ nome: '' }, registros, ['1']), undefined)
assert.equal(poloDaParte({ polo: ' AT ' }), 'ativo')
assert.equal(poloDaParte({ polo: 'P' }), 'passivo')
assert.equal(poloDaParte({}), 'outro')
assert.equal(dataCapa('20260102123456'), '02/01/2026')
assert.equal(dataCapa('2026-01-02T00:00:00Z'), '02/01/2026')
assert.equal(dataCapa(null), 'Não informada')
console.log('14 verificações de identificação, polos e datas passaram.')
