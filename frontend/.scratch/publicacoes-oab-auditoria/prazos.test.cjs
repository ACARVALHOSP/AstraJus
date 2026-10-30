const assert = require('node:assert/strict');
const { calcularPrazo, detectarDias, dataValida } = require('../../src/routes/publicacoes-oab/prazos.ts');
const calendario = { municipio: 'São Paulo', tribunal: 'tjsp', anos: [2026, 2027], fonte: 'Fixture verificada', completo: true, impedimentos: [{ inicio: '2026-11-02', fim: '2026-11-02', descricao: 'Finados', tipo: 'feriado' }] };
let checks = 0;
function eq(actual, expected) { assert.equal(actual, expected); checks++; }
eq(dataValida('2026-02-30'), false); eq(dataValida('2028-02-29'), true);
eq(detectarDias('Manifeste-se no prazo de 15 (quinze) dias.'), 15);
eq(detectarDias('Prazo de 5 dias. Prazo de 15 dias.'), null);
eq(detectarDias('Intimação sem duração.'), null);
eq(detectarDias('Prazo de 0 dias.'), null);
eq(detectarDias('Prazo de 5 dias corridos.'), null);
const r = calcularPrazo('2026-10-30', 5, 'dje', calendario, false);
eq(r.termoInicial, '2026-11-04'); eq(r.dataFinal, '2026-11-10'); eq(r.pendenteRevisao, false);
eq(calcularPrazo('2026-10-30', 5, 'dje', { ...calendario, completo: false }, false).pendenteRevisao, true);
eq(calcularPrazo('2026-12-31', 5, 'inicio', { ...calendario, anos: [2026] }, false).pendenteRevisao, true);
const recesso = calcularPrazo('2026-12-18', 2, 'inicio', calendario, true);
eq(recesso.dataFinal, '2027-01-21');
const janeiro = calcularPrazo('2027-01-07', 1, 'dje', calendario, true);
eq(janeiro.linhas.find(l => l.evento === 'Publicação').data, '2027-01-08');
eq(janeiro.termoInicial, '2027-01-21');
const suspensao = { ...calendario, impedimentos: [{ inicio: '2026-11-03', fim: '2026-11-06', descricao: 'Provimento local', tipo: 'suspensao' }] };
const local = calcularPrazo('2026-11-02', 1, 'dje', suspensao, false);
eq(local.linhas.find(l => l.evento === 'Publicação').data, '2026-11-03'); eq(local.dataFinal, '2026-11-09');
for (const dias of [0, -1, 1.5, 1000, NaN]) { assert.throws(() => calcularPrazo('2026-10-30', dias, 'dje', calendario, false)); checks++; }
assert.throws(() => calcularPrazo('2026-02-30', 5, 'dje', calendario, false)); checks++;
console.log(`${checks} verificações de prazo aprovadas.`);
