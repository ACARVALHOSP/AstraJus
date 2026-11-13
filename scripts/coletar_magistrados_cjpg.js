// Coleta a lista de magistrados do CJPG (TJSP) e grava em modulos/jurimetria/dados/magistrado.json.
//
// Por que um navegador: a grade da lupa de Magistrado é montada por JavaScript do e-SAJ e só aparece
// depois de clicar em "Procurar" dentro da página do formulário; um GET/POST simples devolve 0
// registros. A lista muda pouco (novos juízes entram de vez em quando): rode de vez em quando.
//
// Uso (precisa do Playwright com Chromium):  node scripts/coletar_magistrados_cjpg.js [arquivo-de-saida]
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const SAIDA = process.argv[2] || path.join(__dirname, '..', 'modulos', 'jurimetria', 'dados', 'magistrado.json')

;(async () => {
  const navegador = await chromium.launch()
  try {
    const contexto = await navegador.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      locale: 'pt-BR',
      viewport: { width: 1400, height: 1000 },
    })
    const pagina = await contexto.newPage()
    await pagina.goto('https://esaj.tjsp.jus.br/cjpg/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await pagina.click("img[onclick*=\"IS_request('agente'\"]", { timeout: 15000 })
    await pagina.waitForTimeout(3000)

    const quadroDaGrade = async () => {
      for (const quadro of pagina.frames()) if (await quadro.locator('#pbProcurar').count()) return quadro
      return null
    }
    let quadro = await quadroDaGrade()
    if (!quadro) throw new Error('Não achei a janela de busca de magistrados (o layout do e-SAJ mudou?).')
    await quadro.click('#pbProcurar')

    let linhas = []
    for (let tentativa = 0; tentativa < 40 && linhas.length === 0; tentativa++) {
      await pagina.waitForTimeout(1500)
      quadro = (await quadroDaGrade()) || quadro
      linhas = await quadro.evaluate(() => [...document.querySelectorAll('td[reference=cdAgente]')].map(td => ({
        codigo: td.getAttribute('beanvalue'),
        nome: (td.parentElement.querySelector('td[reference=nmAgente]')?.textContent || '').trim(),
      })))
    }
    if (linhas.length === 0) throw new Error('A grade de magistrados veio vazia.')

    const porCodigo = new Map()
    for (const { codigo, nome } of linhas) {
      const limpo = nome.replace(/\s+/g, ' ')
      // descarta placeholders (ex.: ".") e linhas sem código
      if (codigo && codigo !== '-1' && /[A-Za-zÀ-ÿ]{3}/.test(limpo)) porCodigo.set(codigo, { codigo, nome: limpo })
    }
    const lista = [...porCodigo.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.codigo.localeCompare(b.codigo))
    fs.mkdirSync(path.dirname(SAIDA), { recursive: true })
    fs.writeFileSync(SAIDA, JSON.stringify(lista))
    console.log(`${lista.length} magistrados salvos em ${SAIDA}`)
  } finally {
    await navegador.close()
  }
})().catch(erro => { console.error(erro.message); process.exit(1) })
