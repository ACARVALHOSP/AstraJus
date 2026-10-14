// Painel web do cnj-processual. Fala o protocolo MCP (Streamable HTTP) direto do navegador,
// usando o token que a própria pessoa cola no topo da página. Sem bibliotecas externas:
// a CSP do servidor só libera scripts de /static.
"use strict";

const URL_MCP = "/mcp";
const CHAVE_TOKEN = "cnj_token";
const CHAVE_HISTORICO = "cnj_historico";
const CHAVE_FAVORITOS = "cnj_favoritos";
const CHAVE_PRAZO_MUNICIPIO = "cnj_prazo_municipio";
const HISTORICO_MAX = 10;

class ErroMCP extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

class ClienteMCP {
  constructor(token) {
    this.token = token;
    this.sessionId = null;
    this.proximoId = 1;
  }

  async _enviar(corpo, { comResposta = true, podeReiniciar = true } = {}) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.token}`,
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;

    const controlador = new AbortController();
    const limite = setTimeout(() => controlador.abort(), 170000);
    let resposta;
    try {
      resposta = await fetch(URL_MCP, {
        method: "POST",
        headers,
        body: JSON.stringify(corpo),
        signal: controlador.signal,
      });
    } catch (erro) {
      if (erro.name === "AbortError") {
        throw new ErroMCP(0, "A consulta demorou demais e foi interrompida. Tente novamente.");
      }
      throw new ErroMCP(0, "Não foi possível conectar ao servidor. Confira sua conexão.");
    } finally {
      clearTimeout(limite);
    }

    const sid = resposta.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    if (!resposta.ok) {
      const texto = await resposta.text().catch(() => "");
      if (resposta.status === 401) {
        throw new ErroMCP(401, "Token inválido, expirado ou revogado. Confira o token ou peça um novo em /cadastro.");
      }
      if (resposta.status === 429) {
        const espera = resposta.headers.get("retry-after");
        throw new ErroMCP(429, `Limite de uso atingido. Tente de novo em ${espera ? espera + "s" : "alguns instantes"}.`);
      }
      if ((resposta.status === 400 || resposta.status === 404) && podeReiniciar && this.sessionId) {
        // a sessão pode ter expirado no servidor (por exemplo, após um reinício): reinicia uma vez
        this.sessionId = null;
        await this._iniciar();
        return this._enviar(corpo, { comResposta, podeReiniciar: false });
      }
      throw new ErroMCP(resposta.status, texto || `Falha inesperada (HTTP ${resposta.status}).`);
    }

    if (!comResposta) {
      await resposta.text().catch(() => {});
      return null;
    }

    const tipo = resposta.headers.get("content-type") || "";
    const corpoTexto = await resposta.text();
    if (!corpoTexto) return null;

    let dados;
    if (tipo.includes("text/event-stream")) {
      const linha = corpoTexto
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .pop();
      dados = linha ? JSON.parse(linha.slice(5).trim()) : null;
    } else {
      dados = JSON.parse(corpoTexto);
    }
    if (dados && dados.error) {
      throw new ErroMCP(200, dados.error.message || "O servidor recusou a requisição.");
    }
    return dados ? dados.result : null;
  }

  async _iniciar() {
    this.proximoId = 1;
    await this._enviar({
      jsonrpc: "2.0",
      id: this.proximoId++,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "cnj-processual-painel", version: "1" },
      },
    });
    await this._enviar({ jsonrpc: "2.0", method: "notifications/initialized" }, { comResposta: false });
  }

  async chamarTool(nome, argumentos) {
    if (!this.sessionId) await this._iniciar();
    const resultado = await this._enviar({
      jsonrpc: "2.0",
      id: this.proximoId++,
      method: "tools/call",
      params: { name: nome, arguments: argumentos },
    });
    const item = resultado && resultado.content && resultado.content[0];
    if (!item || typeof item.text !== "string") {
      throw new ErroMCP(200, "Resposta vazia do servidor.");
    }
    return JSON.parse(item.text);
  }
}

// --- Auxiliares de DOM (sem innerHTML com dados do servidor: tudo via textContent) --------

function el(tag, attrs = {}, filhos = []) {
  const elemento = document.createElement(tag);
  for (const [chave, valor] of Object.entries(attrs)) {
    if (chave === "class") elemento.className = valor;
    else if (chave === "texto") elemento.textContent = valor;
    else if (chave.startsWith("on") && typeof valor === "function") {
      elemento.addEventListener(chave.slice(2), valor);
    } else if (valor !== null && valor !== undefined) {
      elemento.setAttribute(chave, valor);
    }
  }
  for (const filho of [].concat(filhos)) {
    if (filho === null || filho === undefined) continue;
    elemento.appendChild(typeof filho === "string" ? document.createTextNode(filho) : filho);
  }
  return elemento;
}

function limpar(container) {
  while (container.firstChild) container.removeChild(container.firstChild);
}

function notificacao(tipo, titulo, subtitulo) {
  const papel = tipo === "error" || tipo === "warning" ? "alert" : "status";
  const textoWrap = el("div", { class: "cds--inline-notification__text-wrapper" }, [
    el("p", { class: "cds--inline-notification__title", texto: titulo }),
    subtitulo ? el("p", { class: "cds--inline-notification__subtitle", texto: subtitulo }) : null,
  ]);
  return el("div", { class: `cds--inline-notification cds--inline-notification--${tipo}`, role: papel }, [
    el("div", { class: "cds--inline-notification__details" }, [textoWrap]),
  ]);
}

function mostrarErro(container, mensagem) {
  limpar(container);
  container.appendChild(notificacao("error", "Não foi possível concluir", mensagem));
}

function mostrarEspera(container, botao, titulo) {
  botao.disabled = true;
  limpar(container);
  const inicio = Date.now();
  const texto = el("p", { class: "app-espera" }, [
    el("span", { class: "espera-spinner", "aria-hidden": "true" }),
    `${titulo}… 0s`,
  ]);
  container.appendChild(texto);
  const atualizar = () => {
    const seg = Math.round((Date.now() - inicio) / 1000);
    texto.lastChild.textContent = `${titulo}… ${seg}s`;
  };
  const temporizador = setInterval(atualizar, 1000);
  return () => {
    clearInterval(temporizador);
    botao.disabled = false;
  };
}

function formatarData(valor) {
  if (!valor) return "não informado";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return String(valor);
  return data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatarDataSimples(valor) {
  if (!valor) return "não informado";
  const bruto = String(valor);
  // Data pura ("AAAA-MM-DD", sem hora): formata direto dos componentes. O construtor Date
  // trata esse formato como meia-noite UTC, e em fusos atrás de UTC (ex.: Brasília, UTC-3)
  // toLocaleDateString devolveria o dia anterior - crítico aqui porque esta função formata
  // datas de vencimento de prazo.
  const somenteData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bruto);
  if (somenteData) {
    const [, ano, mes, dia] = somenteData;
    return `${dia}/${mes}/${ano}`;
  }
  const data = new Date(bruto);
  if (Number.isNaN(data.getTime())) return bruto;
  return data.toLocaleDateString("pt-BR");
}

// --- Token e conexão -----------------------------------------------------------------------

const campoToken = document.getElementById("token");
const checkboxLembrar = document.getElementById("lembrar-token");
const statusConexao = document.getElementById("status-conexao");
let cliente = null;

function definirStatus(texto, tom) {
  statusConexao.textContent = texto;
  statusConexao.className = `cds--tag cds--tag--${tom}`;
}

function conectarComToken(valor) {
  cliente = valor ? new ClienteMCP(valor) : null;
  definirStatus(valor ? "Token definido" : "Sem token", valor ? "blue" : "gray");
}

(function carregarTokenSalvo() {
  const salvo = localStorage.getItem(CHAVE_TOKEN);
  if (salvo) {
    campoToken.value = salvo;
    checkboxLembrar.checked = true;
    conectarComToken(salvo);
  }
})();

document.getElementById("form-token").addEventListener("submit", (evento) => {
  evento.preventDefault();
  const valor = campoToken.value.trim();
  if (!valor) return;
  if (checkboxLembrar.checked) localStorage.setItem(CHAVE_TOKEN, valor);
  else localStorage.removeItem(CHAVE_TOKEN);
  conectarComToken(valor);
});

document.getElementById("esquecer-token").addEventListener("click", () => {
  localStorage.removeItem(CHAVE_TOKEN);
  campoToken.value = "";
  checkboxLembrar.checked = false;
  conectarComToken(null);
});

function exigirCliente(container) {
  if (cliente) return true;
  mostrarErro(container, "Informe o seu token no topo da página e clique em Conectar antes de consultar.");
  return false;
}

// --- Histórico e Favoritos (só neste navegador, via localStorage) --------------------------

function _lerLista(chave) {
  try {
    const bruto = localStorage.getItem(chave);
    const lista = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

function _salvarLista(chave, lista) {
  try {
    localStorage.setItem(chave, JSON.stringify(lista));
  } catch {
    // localStorage indisponível (modo privado, cota esgotada etc.): a utilidade só deixa de
    // persistir entre sessões, o restante do painel continua funcionando.
  }
}

function lerHistorico() {
  return _lerLista(CHAVE_HISTORICO);
}

function adicionarHistorico(item) {
  const lista = lerHistorico().filter((h) => h.resumo !== item.resumo || h.tipo !== item.tipo);
  lista.unshift({ ...item, quando: new Date().toISOString() });
  _salvarLista(CHAVE_HISTORICO, lista.slice(0, HISTORICO_MAX));
  renderizarListaRapida();
}

function lerFavoritos() {
  return _lerLista(CHAVE_FAVORITOS);
}

function _chaveFavorito(tribunal, numero) {
  return `${(tribunal || "").toLowerCase()}:${numero}`;
}

function ehFavorito(tribunal, numero) {
  const chave = _chaveFavorito(tribunal, numero);
  return lerFavoritos().some((f) => _chaveFavorito(f.tribunal, f.numero) === chave);
}

function alternarFavorito(tribunal, numero) {
  const chave = _chaveFavorito(tribunal, numero);
  const lista = lerFavoritos();
  const index = lista.findIndex((f) => _chaveFavorito(f.tribunal, f.numero) === chave);
  if (index === -1) lista.unshift({ tribunal, numero });
  else lista.splice(index, 1);
  _salvarLista(CHAVE_FAVORITOS, lista);
  renderizarListaRapida();
  return index === -1; // true = acabou de favoritar
}

function removerFavorito(tribunal, numero) {
  const chave = _chaveFavorito(tribunal, numero);
  _salvarLista(CHAVE_FAVORITOS, lerFavoritos().filter((f) => _chaveFavorito(f.tribunal, f.numero) !== chave));
  renderizarListaRapida();
}

function _usarItemRapido(item) {
  if (item.tipo === "processo") {
    selecionarAba(abas[0]);
    document.getElementById("tribunal").value = item.args.tribunal || "";
    document.getElementById("numero-processo").value = item.args.numero_processo || "";
    formProcesso.requestSubmit();
  } else {
    selecionarAba(abas[1]);
    document.getElementById("pub-numero-processo").value = item.args.numero_processo || "";
    document.getElementById("pub-sigla-tribunal").value = item.args.sigla_tribunal || "";
    document.getElementById("pub-numero-oab").value = item.args.numero_oab || "";
    document.getElementById("pub-uf-oab").value = item.args.uf_oab || "";
    formPublicacoes.requestSubmit();
  }
}

function renderizarListaRapida() {
  const listaFavoritos = document.getElementById("lista-favoritos");
  const listaHistorico = document.getElementById("lista-historico");
  if (!listaFavoritos || !listaHistorico) return;

  limpar(listaFavoritos);
  const favoritos = lerFavoritos();
  if (!favoritos.length) {
    listaFavoritos.appendChild(el("li", { class: "lista-rapida-vazio", texto: "Nenhum favorito ainda." }));
  }
  for (const fav of favoritos) {
    listaFavoritos.appendChild(
      el("li", { class: "lista-rapida-item cds--tile" }, [
        el("span", { texto: `${(fav.tribunal || "?").toUpperCase()} · ${fav.numero}` }),
        el("div", {}, [
          el("button", {
            class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "Consultar",
            onclick: () => _usarItemRapido({ tipo: "processo", args: { tribunal: fav.tribunal, numero_processo: fav.numero } }),
          }),
          el("button", {
            class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "Remover",
            onclick: () => removerFavorito(fav.tribunal, fav.numero),
          }),
        ]),
      ])
    );
  }

  limpar(listaHistorico);
  const historico = lerHistorico();
  if (!historico.length) {
    listaHistorico.appendChild(el("li", { class: "lista-rapida-vazio", texto: "Nenhuma consulta recente." }));
  }
  for (const item of historico) {
    listaHistorico.appendChild(
      el("li", { class: "lista-rapida-item cds--tile" }, [
        el("span", { texto: `${item.resumo} · ${formatarData(item.quando)}` }),
        el("button", {
          class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "Repetir",
          onclick: () => _usarItemRapido(item),
        }),
      ])
    );
  }
}

// --- Abas ------------------------------------------------------------------------------------

const abas = [
  { botao: document.getElementById("aba-processo-botao"), painel: document.getElementById("aba-processo") },
  { botao: document.getElementById("aba-publicacoes-botao"), painel: document.getElementById("aba-publicacoes") },
  { botao: document.getElementById("aba-historico-botao"), painel: document.getElementById("aba-historico") },
  { botao: document.getElementById("aba-monitoramentos-botao"), painel: document.getElementById("aba-monitoramentos") },
  { botao: document.getElementById("aba-jurimetria-botao"), painel: document.getElementById("aba-jurimetria") },
];

function selecionarAba(alvo) {
  for (const aba of abas) {
    const ativa = aba === alvo;
    aba.botao.setAttribute("aria-selected", String(ativa));
    aba.botao.parentElement.classList.toggle("cds--tabs__nav-item--selected", ativa);
    aba.painel.hidden = !ativa;
  }
  alvo.botao.focus();
  if (alvo.painel.id === "aba-historico") renderizarListaRapida();
  if (alvo.painel.id === "aba-monitoramentos") carregarMonitoramentos();
}

for (const aba of abas) aba.botao.addEventListener("click", () => selecionarAba(aba));

// --- Consulta de processo (DataJud) -----------------------------------------------------------

// A API devolve dezenas (às vezes centenas) de movimentações, a maioria burocrática
// (remessa, conclusão, expedição de documento). Agrupamos essa tramitação repetitiva
// em blocos expansíveis e destacamos decisões e petições, que são o que normalmente
// interessa a quem está acompanhando o processo.
const CATEGORIAS_MOVIMENTO = {
  decisao: { rotulo: "Decisão", tag: "red" },
  peticao: { rotulo: "Petição", tag: "teal" },
  tramitacao: { rotulo: "Tramitação", tag: "gray" },
};

function categorizarMovimento(nome) {
  const normalizado = (nome || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (
    normalizado.includes("decis") ||
    ["julgamento", "sentenca", "liminar", "improcedencia", "procedencia", "acordao"].some((termo) =>
      normalizado.includes(termo)
    )
  ) {
    return "decisao";
  }
  if (normalizado.includes("peticao")) return "peticao";
  return "tramitacao";
}

function agruparMovimentos(movimentos) {
  const ordenados = [...movimentos].sort((a, b) => new Date(b.dataHora) - new Date(a.dataHora));
  const entradas = [];
  let pendentes = [];
  const fecharPendentes = () => {
    if (!pendentes.length) return;
    if (pendentes.length < 3) {
      for (const mov of pendentes) entradas.push({ tipo: "item", categoria: "tramitacao", mov });
    } else {
      entradas.push({ tipo: "grupo", itens: pendentes });
    }
    pendentes = [];
  };
  for (const mov of ordenados) {
    const categoria = categorizarMovimento(mov.nome);
    if (categoria === "tramitacao") {
      pendentes.push(mov);
      continue;
    }
    fecharPendentes();
    entradas.push({ tipo: "item", categoria, mov });
  }
  fecharPendentes();
  return entradas;
}

function marcadorLinhaTempo(categoria) {
  const classe = categoria === "decisao" ? "linha-tempo-marcador linha-tempo-marcador--decisao" : "linha-tempo-marcador";
  return el("span", { class: classe, "aria-hidden": "true" });
}

function itemLinhaTempo(mov, categoria) {
  const info = CATEGORIAS_MOVIMENTO[categoria];
  const complementos = (mov.complementosTabelados || []).map((c) => c.nome).filter(Boolean).join(", ");
  return el("div", { class: "linha-tempo-item", "data-categoria": categoria }, [
    marcadorLinhaTempo(categoria),
    el("p", { class: "linha-tempo-data", texto: formatarData(mov.dataHora) }),
    el("div", { class: "linha-tempo-card" }, [
      el("span", { class: `cds--tag cds--tag--${info.tag}`, texto: info.rotulo }),
      el("h4", { texto: mov.nome || String(mov.codigo || "") }),
      complementos ? el("p", { class: "linha-tempo-complemento", texto: complementos }) : null,
    ]),
  ]);
}

function grupoLinhaTempo(itens) {
  const inicio = formatarDataSimples(itens[itens.length - 1].dataHora);
  const fim = formatarDataSimples(itens[0].dataHora);
  const detalhes = el("details", { class: "linha-tempo-item linha-tempo-grupo", "data-categoria": "tramitacao" });
  detalhes.appendChild(marcadorLinhaTempo("tramitacao"));
  detalhes.appendChild(el("summary", { texto: `${itens.length} eventos de tramitação entre ${inicio} e ${fim}` }));
  const lista = el("div", { class: "linha-tempo-grupo-lista" });
  for (const mov of itens) {
    lista.appendChild(el("p", { texto: `${formatarDataSimples(mov.dataHora)} — ${mov.nome || mov.codigo}` }));
  }
  detalhes.appendChild(lista);
  return detalhes;
}

function linhaDoTempoMovimentos(movimentos) {
  const entradas = agruparMovimentos(movimentos);
  const container = el("div", { class: "linha-tempo" });
  for (const entrada of entradas) {
    container.appendChild(entrada.tipo === "grupo" ? grupoLinhaTempo(entrada.itens) : itemLinhaTempo(entrada.mov, entrada.categoria));
  }

  const filtros = el("div", { class: "linha-tempo-filtros", role: "group", "aria-label": "Filtrar por tipo de movimentação" });
  const opcoes = [["todos", "Todos"], ["decisao", "Decisões"], ["peticao", "Petições"], ["tramitacao", "Tramitação"]];
  for (const [valor, rotulo] of opcoes) {
    const botao = el("button", {
      class: "cds--btn cds--btn--ghost cds--btn--sm",
      type: "button",
      "aria-pressed": valor === "todos" ? "true" : "false",
      texto: rotulo,
    });
    botao.addEventListener("click", () => {
      for (const outro of filtros.querySelectorAll("button")) outro.setAttribute("aria-pressed", "false");
      botao.setAttribute("aria-pressed", "true");
      for (const item of container.children) {
        item.hidden = valor !== "todos" && item.dataset.categoria !== valor;
      }
    });
    filtros.appendChild(botao);
  }

  return el("div", {}, [filtros, container]);
}

function cartaoProcesso(proc) {
  const card = el("article", { class: "cds--tile resultado-card" });
  card.appendChild(
    el("div", { class: "resultado-cabecalho" }, [
      el("span", { class: "cds--tag cds--tag--blue", texto: (proc.tribunal || "?").toUpperCase() }),
      el("span", { class: "cds--tag cds--tag--purple", texto: proc.grau_descricao || proc.grau || "grau não informado" }),
    ])
  );
  card.appendChild(el("h3", { texto: proc.classe || "Classe não informada" }));
  card.appendChild(el("p", { texto: `Número: ${proc.numeroProcesso || "não informado"}` }));
  card.appendChild(el("p", { texto: `Órgão julgador: ${proc.orgaoJulgador || "não informado"}` }));
  card.appendChild(el("p", { texto: `Distribuído em: ${formatarDataSimples(proc.dataAjuizamento)}` }));
  const movimentos = proc.movimentos || [];
  if (movimentos.length) {
    const detalhes = el("details", { class: "resultado-detalhes" });
    detalhes.appendChild(el("summary", { texto: `${proc.totalMovimentos || movimentos.length} movimentações` }));
    detalhes.appendChild(linhaDoTempoMovimentos(movimentos));
    card.appendChild(detalhes);
  }

  if (proc.numeroProcesso) {
    const acoes = el("div", { class: "resultado-acoes" });
    const favoritado = ehFavorito(proc.tribunal, proc.numeroProcesso);
    const botaoFavorito = el("button", {
      class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button",
      texto: favoritado ? "★ Favorito" : "☆ Favoritar",
    });
    botaoFavorito.addEventListener("click", () => {
      const ficouFavorito = alternarFavorito(proc.tribunal, proc.numeroProcesso);
      botaoFavorito.textContent = ficouFavorito ? "★ Favorito" : "☆ Favoritar";
    });
    acoes.appendChild(botaoFavorito);

    const botaoAcompanhar = el("button", {
      class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "Acompanhar por e-mail",
    });
    const statusAcompanhar = el("span", { class: "app-espera app-espera--inline" });
    botaoAcompanhar.addEventListener("click", () =>
      acompanharBusca({ numero_processo: proc.numeroProcesso, sigla_tribunal: proc.tribunal }, botaoAcompanhar, statusAcompanhar)
    );
    acoes.appendChild(botaoAcompanhar);
    acoes.appendChild(statusAcompanhar);
    card.appendChild(acoes);
  }

  return card;
}

function renderizarProcesso(container, dados) {
  limpar(container);
  if (dados.erro) {
    container.appendChild(notificacao("error", "Erro na consulta ao DataJud", dados.mensagem));
    return;
  }
  if (!dados.encontrado) {
    container.appendChild(notificacao("info", "Processo não encontrado", dados.mensagem));
    return;
  }
  const total = dados.total || (dados.processos || []).length;
  container.appendChild(notificacao("success", `${total} registro${total === 1 ? "" : "s"} encontrado${total === 1 ? "" : "s"}`));
  for (const proc of dados.processos || []) container.appendChild(cartaoProcesso(proc));
}

const formProcesso = document.getElementById("form-processo");
const resultadoProcesso = document.getElementById("resultado-processo");

formProcesso.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!exigirCliente(resultadoProcesso)) return;
  const tribunal = document.getElementById("tribunal").value.trim().toLowerCase();
  const numero = document.getElementById("numero-processo").value.trim();
  const botao = formProcesso.querySelector("button[type=submit]");
  const pararEspera = mostrarEspera(resultadoProcesso, botao, "Consultando o DataJud (pode levar até dois minutos)");
  try {
    const dados = await cliente.chamarTool("consultar_processo_datajud", { tribunal, numero_processo: numero });
    renderizarProcesso(resultadoProcesso, dados);
    if (!dados.erro) {
      adicionarHistorico({
        tipo: "processo",
        args: { tribunal, numero_processo: numero },
        resumo: `Processo ${numero} (${tribunal.toUpperCase()})`,
      });
    }
  } catch (erro) {
    mostrarErro(resultadoProcesso, erro.message);
  } finally {
    pararEspera();
  }
});

// --- Monitoramento: acompanhar um processo/OAB por e-mail -------------------------------------

async function acompanharBusca(criterio, botao, statusEl) {
  if (!cliente) return;
  const textoOriginal = botao.textContent;
  botao.disabled = true;
  botao.textContent = "Ativando…";
  limpar(statusEl);
  try {
    const dados = await cliente.chamarTool("monitorar_publicacoes", criterio);
    if (dados.erro) {
      statusEl.appendChild(el("span", { class: "resultado-aviso", texto: dados.mensagem }));
    } else {
      statusEl.appendChild(el("span", { texto: "Você será avisado por e-mail quando sair publicação nova." }));
    }
  } catch (erro) {
    statusEl.appendChild(el("span", { class: "resultado-aviso", texto: erro.message }));
  } finally {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
}

// --- Consulta de publicações (DJEN) -----------------------------------------------------------

function chips(lista) {
  const linha = el("div", { class: "chips" });
  for (const texto of lista) linha.appendChild(el("span", { class: "chip", texto }));
  return linha;
}

// --- Calculadora de prazo (dias úteis, a partir da publicação no DJEN) ---------------------
//
// Reproduz as 4 regras de contagem da "Calculadora de Prazos" da PGM-SP
// (https://pgmprazos.prefeitura.sp.gov.br/), conferidas uma a uma pelo demonstrativo dia-a-dia
// daquela ferramenta. Útil = não é sábado, domingo nem feriado forense do município informado
// (buscado da tool buscar_feriados_forenses, que consulta o TJSP).

const TIPOS_CONTAGEM_PRAZO = [
  { valor: "dje", rotulo: "Disponibilização no DJe" },
  { valor: "mandado", rotulo: "Juntada de mandado/AR" },
  { valor: "intimacao_saj", rotulo: "Intimação SAJ (+10 dias corridos)" },
  { valor: "citacao_saj", rotulo: "Citação SAJ (+5 dias úteis)" },
];

function _dataUTC(iso) {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(a, m - 1, d);
}

function _isoDaDataUTC(timestampUTC) {
  const data = new Date(timestampUTC);
  const ano = data.getUTCFullYear();
  const mes = String(data.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(data.getUTCDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function somarDiasCorridos(iso, n) {
  return _isoDaDataUTC(_dataUTC(iso) + n * 86400000);
}

function ehFimDeSemana(iso) {
  const diaSemana = new Date(_dataUTC(iso)).getUTCDay();
  return diaSemana === 0 || diaSemana === 6;
}

function ehDiaUtil(iso, feriados) {
  return !ehFimDeSemana(iso) && !feriados.has(iso);
}

function nEsimoDiaUtilApos(iso, n, feriados) {
  let atual = iso;
  let contados = 0;
  while (contados < n) {
    atual = somarDiasCorridos(atual, 1);
    if (ehDiaUtil(atual, feriados)) contados++;
  }
  return atual;
}

function calcularInicioPrazo(dataBaseISO, tipo, feriados) {
  if (tipo === "dje") {
    const publicacao = nEsimoDiaUtilApos(dataBaseISO, 1, feriados);
    return nEsimoDiaUtilApos(publicacao, 1, feriados);
  }
  if (tipo === "mandado") {
    return nEsimoDiaUtilApos(dataBaseISO, 1, feriados);
  }
  if (tipo === "intimacao_saj") {
    const marco = somarDiasCorridos(dataBaseISO, 10);
    return nEsimoDiaUtilApos(marco, 1, feriados);
  }
  if (tipo === "citacao_saj") {
    return nEsimoDiaUtilApos(dataBaseISO, 5, feriados);
  }
  throw new Error(`tipo de contagem desconhecido: ${tipo}`);
}

function calcularVencimentoPrazo(dataBaseISO, dias, tipo, feriados) {
  const dia1 = calcularInicioPrazo(dataBaseISO, tipo, feriados);
  const vencimento = dias <= 1 ? dia1 : nEsimoDiaUtilApos(dia1, dias - 1, feriados);
  return { dia1, vencimento };
}

const _cacheFeriados = new Map(); // `${municipio}|${ano}` -> Set(iso)

async function _buscarFeriadosAno(municipio, ano) {
  const chave = `${municipio}|${ano}`;
  if (_cacheFeriados.has(chave)) return _cacheFeriados.get(chave);
  const dados = await cliente.chamarTool("buscar_feriados_forenses", { municipio, ano });
  if (dados.erro) throw new Error(dados.mensagem);
  const conjunto = new Set((dados.feriados || []).map((f) => f.data));
  _cacheFeriados.set(chave, conjunto);
  return conjunto;
}

async function _uniaoFeriados(municipio, anos) {
  const conjuntos = await Promise.all(anos.map((ano) => _buscarFeriadosAno(municipio, ano)));
  const uniao = new Set();
  for (const conjunto of conjuntos) for (const data of conjunto) uniao.add(data);
  return uniao;
}

// Calcula o vencimento buscando os feriados necessários; se o vencimento cair num ano ainda não
// buscado (prazo longo), busca também esse ano e recalcula.
async function calcularPrazoComFeriados(dataBaseISO, dias, tipo, municipio) {
  if (!cliente) throw new Error("Informe o seu token e conecte antes de calcular o prazo.");
  const anoBase = Number(dataBaseISO.slice(0, 4));
  let anos = [anoBase, anoBase + 1];
  let feriados = await _uniaoFeriados(municipio, anos);
  let resultado = calcularVencimentoPrazo(dataBaseISO, dias, tipo, feriados);
  const anoVencimento = Number(resultado.vencimento.slice(0, 4));
  if (anoVencimento > anoBase + 1) {
    anos = [...anos, anoVencimento];
    feriados = await _uniaoFeriados(municipio, anos);
    resultado = calcularVencimentoPrazo(dataBaseISO, dias, tipo, feriados);
  }
  return resultado;
}

function painelCalculoPrazo(item) {
  const dataBase = (item.data_disponibilizacao || "").slice(0, 10);
  const painel = el("div", { class: "prazo-painel", hidden: "" });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataBase)) {
    painel.appendChild(
      el("p", { class: "resultado-aviso", texto: "Publicação sem data de disponibilização - não é possível calcular o prazo." })
    );
    return painel;
  }

  const campoDias = el("input", { class: "cds--text-input", type: "number", min: "1", value: "15" });
  const campoTipo = el(
    "select",
    { class: "cds--select-input" },
    TIPOS_CONTAGEM_PRAZO.map((t) => el("option", { value: t.valor, texto: t.rotulo }))
  );
  const campoMunicipio = el("input", {
    class: "cds--text-input",
    type: "text",
    value: localStorage.getItem(CHAVE_PRAZO_MUNICIPIO) || "São Paulo",
  });
  const botaoCalcular = el("button", { class: "cds--btn cds--btn--primary cds--btn--sm", type: "button", texto: "Calcular" });
  const resultadoEl = el("div", { class: "prazo-resultado" });

  painel.appendChild(
    el("p", { class: "campo-ajuda", texto: `Base: disponibilizado em ${formatarDataSimples(dataBase)}. A contagem exclui sábados, domingos e os feriados forenses do município informado.` })
  );
  painel.appendChild(
    el("div", { class: "prazo-painel-grade" }, [
      el("div", { class: "cds--form-item" }, [el("label", { class: "cds--label", texto: "Dias" }), campoDias]),
      el("div", { class: "cds--form-item" }, [el("label", { class: "cds--label", texto: "Contagem a partir de" }), campoTipo]),
      el("div", { class: "cds--form-item" }, [el("label", { class: "cds--label", texto: "Município/comarca" }), campoMunicipio]),
    ])
  );
  painel.appendChild(botaoCalcular);
  painel.appendChild(resultadoEl);

  botaoCalcular.addEventListener("click", async () => {
    const dias = Number(campoDias.value);
    limpar(resultadoEl);
    if (!Number.isInteger(dias) || dias < 1) {
      resultadoEl.appendChild(el("p", { class: "resultado-aviso", texto: "Informe um número de dias válido." }));
      return;
    }
    const municipio = campoMunicipio.value.trim() || "São Paulo";
    localStorage.setItem(CHAVE_PRAZO_MUNICIPIO, municipio);
    const textoOriginal = botaoCalcular.textContent;
    botaoCalcular.disabled = true;
    botaoCalcular.textContent = "Calculando…";
    try {
      const { dia1, vencimento } = await calcularPrazoComFeriados(dataBase, dias, campoTipo.value, municipio);
      resultadoEl.appendChild(
        notificacao(
          "success",
          `Vencimento: ${formatarDataSimples(vencimento)}`,
          `Início da contagem (dia 1): ${formatarDataSimples(dia1)} · ${dias} dia(s) úteis em ${municipio}`
        )
      );
      resultadoEl.appendChild(
        el("p", { class: "campo-ajuda", texto: "Cálculo informativo, sem valor oficial - confirme sempre no sistema do tribunal." })
      );
    } catch (erro) {
      resultadoEl.appendChild(el("p", { class: "resultado-aviso", texto: erro.message }));
    } finally {
      botaoCalcular.disabled = false;
      botaoCalcular.textContent = textoOriginal;
    }
  });

  return painel;
}

function cartaoPublicacao(item) {
  const card = el("article", { class: "cds--tile resultado-card" });
  card.appendChild(
    el("div", { class: "resultado-cabecalho" }, [
      el("span", { class: "cds--tag cds--tag--blue", texto: item.siglaTribunal || "?" }),
      item.tipoComunicacao ? el("span", { class: "cds--tag cds--tag--teal", texto: item.tipoComunicacao }) : null,
      item.tipoDocumento ? el("span", { class: "cds--tag cds--tag--gray", texto: item.tipoDocumento }) : null,
    ])
  );
  card.appendChild(el("h3", { texto: item.nomeClasse || "Classe não informada" }));
  card.appendChild(el("p", { texto: `Processo: ${item.numeroprocessocommascara || "não informado"}` }));
  card.appendChild(el("p", { texto: `${item.nomeOrgao || "Órgão não informado"} · disponibilizado em ${formatarDataSimples(item.data_disponibilizacao)}` }));

  const destinatarios = (item.destinatarios || []).map((d) => `${d.nome || "?"} (${d.polo || "?"})`);
  if (destinatarios.length) {
    card.appendChild(el("p", { class: "resultado-rotulo", texto: "Partes" }));
    card.appendChild(chips(destinatarios));
  }
  const advogados = (item.destinatarioadvogados || []).map(
    (a) => `${a.nome || "?"} OAB ${a.numero_oab || "?"}/${a.uf_oab || "?"}`
  );
  if (advogados.length) {
    card.appendChild(el("p", { class: "resultado-rotulo", texto: "Advogados" }));
    card.appendChild(chips(advogados));
  }

  if (item.texto) {
    const detalhes = el("details", { class: "resultado-detalhes" });
    detalhes.appendChild(el("summary", { texto: "Texto da publicação" }));
    detalhes.appendChild(el("div", { class: "resultado-texto", texto: item.texto }));
    card.appendChild(detalhes);
  }

  const acoes = el("div", { class: "resultado-acoes" });
  if (item.texto) {
    const botaoCopiar = el("button", {
      class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "Copiar texto",
    });
    botaoCopiar.addEventListener("click", async () => {
      const textoOriginal = botaoCopiar.textContent;
      try {
        await navigator.clipboard.writeText(item.texto);
        botaoCopiar.textContent = "Copiado!";
      } catch {
        botaoCopiar.textContent = "Não foi possível copiar";
      }
      setTimeout(() => { botaoCopiar.textContent = textoOriginal; }, 2000);
    });
    acoes.appendChild(botaoCopiar);
  }
  if (item.link) {
    acoes.appendChild(
      el("a", { class: "cds--btn cds--btn--tertiary cds--btn--sm", href: item.link, target: "_blank", rel: "noopener noreferrer", texto: "Ver no sistema do tribunal" })
    );
  }
  if (item.hash) {
    const botaoCertidao = el("button", {
      class: "cds--btn cds--btn--secondary cds--btn--sm",
      type: "button",
      texto: "Baixar certidão",
    });
    acoes.appendChild(botaoCertidao);
    const statusCertidao = el("p", { class: "app-espera app-espera--inline" });
    acoes.appendChild(statusCertidao);
    botaoCertidao.addEventListener("click", () => baixarCertidao(item.hash, botaoCertidao, statusCertidao));
  }
  const painelPrazo = painelCalculoPrazo(item);
  const botaoPrazo = el("button", {
    class: "cds--btn cds--btn--tertiary cds--btn--sm", type: "button", texto: "Calcular prazo",
  });
  botaoPrazo.addEventListener("click", () => { painelPrazo.hidden = !painelPrazo.hidden; });
  acoes.appendChild(botaoPrazo);

  if (acoes.childNodes.length) card.appendChild(acoes);
  card.appendChild(painelPrazo);

  return card;
}

async function baixarCertidao(hash, botao, statusEl) {
  if (!cliente) return;
  const textoOriginal = botao.textContent;
  botao.disabled = true;
  botao.textContent = "Gerando…";
  limpar(statusEl);
  try {
    const dados = await cliente.chamarTool("baixar_certidao_djen", { hash });
    if (dados.erro) {
      statusEl.appendChild(el("span", { class: "resultado-aviso", texto: dados.mensagem }));
      return;
    }
    if (dados.link_download) {
      window.open(dados.link_download, "_blank", "noopener,noreferrer");
      statusEl.appendChild(el("span", { texto: `Link aberto. Válido por ${dados.validade_link || "15 minutos"}.` }));
    } else {
      statusEl.appendChild(el("span", { class: "resultado-aviso", texto: dados.aviso || "Não foi possível gerar o link." }));
    }
  } catch (erro) {
    statusEl.appendChild(el("span", { class: "resultado-aviso", texto: erro.message }));
  } finally {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
}

function renderizarPublicacoes(container, dados) {
  limpar(container);
  if (dados.erro) {
    container.appendChild(notificacao("error", "Erro na consulta ao DJEN", dados.mensagem));
    return;
  }
  const itens = dados.itens || [];
  const total = dados.total || 0;
  container.appendChild(
    notificacao(
      itens.length ? "success" : "info",
      `${total} publicação${total === 1 ? "" : "ões"} encontrada${total === 1 ? "" : "s"}`,
      itens.length ? `Mostrando ${itens.length} nesta página.` : "Tente ajustar os filtros ou o período."
    )
  );
  for (const item of itens) container.appendChild(cartaoPublicacao(item));
}

const formPublicacoes = document.getElementById("form-publicacoes");
const resultadoPublicacoes = document.getElementById("resultado-publicacoes");
const paginacaoPublicacoes = document.getElementById("paginacao-publicacoes");
const botaoPaginaAnterior = document.getElementById("pagina-anterior");
const botaoPaginaProxima = document.getElementById("pagina-proxima");
const textoPaginaAtual = document.getElementById("pagina-atual-texto");
const botaoAcompanharBusca = document.getElementById("botao-acompanhar-busca");

let ultimaBuscaPublicacoes = null; // { args, pagina, itensPorPagina, totalRecebido }

function _criterioMonitoramento(args) {
  const { numero_processo, sigla_tribunal, numero_oab, uf_oab } = args;
  return { numero_processo, sigla_tribunal, numero_oab, uf_oab };
}

async function executarBuscaPublicacoes(args, pagina) {
  const argsComPagina = { ...args, pagina };
  const botao = formPublicacoes.querySelector("button[type=submit]");
  const pararEspera = mostrarEspera(resultadoPublicacoes, botao, "Consultando o DJEN");
  try {
    const dados = await cliente.chamarTool("consultar_publicacoes_djen", argsComPagina);
    renderizarPublicacoes(resultadoPublicacoes, dados);

    if (!dados.erro) {
      ultimaBuscaPublicacoes = { args, pagina, itensRecebidos: (dados.itens || []).length, total: dados.total || 0 };
      const itensPorPagina = args.itens_por_pagina || 20;
      textoPaginaAtual.textContent = `Página ${pagina}`;
      botaoPaginaAnterior.disabled = pagina <= 1;
      botaoPaginaProxima.disabled = pagina * itensPorPagina >= (dados.total || 0);
      paginacaoPublicacoes.hidden = (dados.total || 0) <= itensPorPagina && pagina <= 1;

      botaoAcompanharBusca.hidden = false;

      if (pagina === 1) {
        const resumo = args.numero_processo
          ? `Publicações do processo ${args.numero_processo}`
          : `Publicações da OAB ${args.numero_oab}/${args.uf_oab || "?"}`;
        adicionarHistorico({ tipo: "publicacoes", args, resumo });
      }
    } else {
      paginacaoPublicacoes.hidden = true;
      botaoAcompanharBusca.hidden = true;
    }
  } catch (erro) {
    mostrarErro(resultadoPublicacoes, erro.message);
  } finally {
    pararEspera();
  }
}

formPublicacoes.addEventListener("submit", (evento) => {
  evento.preventDefault();
  if (!exigirCliente(resultadoPublicacoes)) return;

  const numero = document.getElementById("pub-numero-processo").value.trim();
  const oab = document.getElementById("pub-numero-oab").value.trim();
  if (!numero && !oab) {
    mostrarErro(resultadoPublicacoes, "Informe o número do processo ou o número da OAB.");
    return;
  }

  const args = {};
  if (numero) args.numero_processo = numero;
  if (oab) args.numero_oab = oab;
  const sigla = document.getElementById("pub-sigla-tribunal").value.trim();
  if (sigla) args.sigla_tribunal = sigla.toUpperCase();
  const uf = document.getElementById("pub-uf-oab").value.trim();
  if (uf) args.uf_oab = uf.toUpperCase();
  const inicio = document.getElementById("pub-data-inicio").value;
  if (inicio) args.data_disponibilizacao_inicio = inicio;
  const fim = document.getElementById("pub-data-fim").value;
  if (fim) args.data_disponibilizacao_fim = fim;
  const itens = parseInt(document.getElementById("pub-itens").value, 10);
  if (itens > 0) args.itens_por_pagina = itens;

  executarBuscaPublicacoes(args, 1);
});

botaoPaginaAnterior.addEventListener("click", () => {
  if (!ultimaBuscaPublicacoes || ultimaBuscaPublicacoes.pagina <= 1) return;
  executarBuscaPublicacoes(ultimaBuscaPublicacoes.args, ultimaBuscaPublicacoes.pagina - 1);
});

botaoPaginaProxima.addEventListener("click", () => {
  if (!ultimaBuscaPublicacoes) return;
  executarBuscaPublicacoes(ultimaBuscaPublicacoes.args, ultimaBuscaPublicacoes.pagina + 1);
});

botaoAcompanharBusca.addEventListener("click", () => {
  if (!ultimaBuscaPublicacoes) return;
  const statusEl = el("p", { class: "app-espera app-espera--inline" });
  botaoAcompanharBusca.insertAdjacentElement("afterend", statusEl);
  acompanharBusca(_criterioMonitoramento(ultimaBuscaPublicacoes.args), botaoAcompanharBusca, statusEl);
});

// --- Monitoramentos: "Meus monitoramentos" ----------------------------------------------------

function _descreverCriterioMonitoramento(criterio) {
  if (criterio.numero_processo) return `Processo ${criterio.numero_processo}`;
  return `OAB ${criterio.numero_oab}/${criterio.uf_oab || "?"}`;
}

function cartaoMonitoramento(m) {
  const card = el("article", { class: "cds--tile resultado-card" });
  card.appendChild(el("h3", { texto: _descreverCriterioMonitoramento(m.criterio || {}) }));
  card.appendChild(el("p", { texto: `Criado em ${formatarData(m.criado_em)}` }));
  card.appendChild(el("p", { texto: `Expira em ${formatarData(m.expira_em)} se não houver publicação nova antes` }));
  const acoes = el("div", { class: "resultado-acoes" });
  const botaoRemover = el("button", { class: "cds--btn cds--btn--danger--tertiary cds--btn--sm", type: "button", texto: "Remover" });
  botaoRemover.addEventListener("click", async () => {
    botaoRemover.disabled = true;
    try {
      await cliente.chamarTool("remover_monitoramento", { id: m.id });
      carregarMonitoramentos();
    } catch (erro) {
      mostrarErro(resultadoMonitoramentos, erro.message);
    }
  });
  acoes.appendChild(botaoRemover);
  card.appendChild(acoes);
  return card;
}

const resultadoMonitoramentos = document.getElementById("resultado-monitoramentos");

async function carregarMonitoramentos() {
  if (!exigirCliente(resultadoMonitoramentos)) return;
  limpar(resultadoMonitoramentos);
  resultadoMonitoramentos.appendChild(el("p", { class: "app-espera" }, ["Carregando…"]));
  try {
    const dados = await cliente.chamarTool("listar_monitoramentos", {});
    limpar(resultadoMonitoramentos);
    if (dados.erro) {
      resultadoMonitoramentos.appendChild(notificacao("error", "Não foi possível carregar", dados.mensagem));
      return;
    }
    const lista = dados.monitoramentos || [];
    if (!lista.length) {
      resultadoMonitoramentos.appendChild(notificacao("info", "Nenhum monitoramento ativo", "Use \"Acompanhar\" numa consulta de processo ou publicações para criar um."));
      return;
    }
    for (const m of lista) resultadoMonitoramentos.appendChild(cartaoMonitoramento(m));
  } catch (erro) {
    limpar(resultadoMonitoramentos);
    mostrarErro(resultadoMonitoramentos, erro.message);
  }
}

// --- Jurimetria: seletores de árvore (Vara/Classe/Assunto) e autocomplete (Magistrado) --------
//
// As árvores (Vara/Classe/Assunto) e a lista de Magistrados vêm de endpoints HTTP simples
// (não tools MCP - são só suporte de UI, ver server.py). Usam o mesmo token Bearer do /mcp.

async function _buscarJson(url) {
  if (!cliente) throw new ErroMCP(401, "Conecte-se primeiro.");
  const resposta = await fetch(url, { headers: { Authorization: `Bearer ${cliente.token}` } });
  if (!resposta.ok) throw new ErroMCP(resposta.status, `Falha ao consultar ${url} (HTTP ${resposta.status}).`);
  return resposta.json();
}

function criarSeletorArvore(container, campo) {
  const selecionados = new Map(); // id -> {nome, busca}

  const busca = el("div", { class: "seletor-arvore-busca" }, [
    el("input", { class: "cds--text-input", type: "text", placeholder: `Buscar ${campo}… (mín. 2 letras)` }),
  ]);
  const inputBusca = busca.querySelector("input");
  const resultados = el("div", { class: "seletor-arvore-resultados" }, [
    el("p", { class: "seletor-arvore-vazio", texto: "Digite para buscar." }),
  ]);
  const chipsSelecionados = el("div", { class: "seletor-arvore-selecionados" });

  function renderizarChips() {
    limpar(chipsSelecionados);
    for (const [id, info] of selecionados) {
      const remover = el("button", { type: "button", texto: "×", "aria-label": `Remover ${info.nome}` });
      remover.addEventListener("click", () => {
        selecionados.delete(id);
        renderizarChips();
        const caixa = resultados.querySelector(`input[value="${CSS.escape(id)}"]`);
        if (caixa) caixa.checked = false;
      });
      chipsSelecionados.appendChild(el("span", { class: "chip" }, [info.nome, remover]));
    }
  }

  function renderizarResultados(lista) {
    limpar(resultados);
    if (!lista.length) {
      resultados.appendChild(el("p", { class: "seletor-arvore-vazio", texto: "Nada encontrado." }));
      return;
    }
    for (const no of lista) {
      const caixa = el("input", { type: "checkbox", value: no.id });
      caixa.checked = selecionados.has(no.id);
      caixa.addEventListener("change", () => {
        if (caixa.checked) selecionados.set(no.id, { nome: no.nome });
        else selecionados.delete(no.id);
        renderizarChips();
      });
      const rotulo = el("label", {}, [
        caixa,
        el("span", {}, [no.nome, el("span", { class: "seletor-arvore-caminho", texto: no.busca || "" })]),
      ]);
      resultados.appendChild(rotulo);
    }
  }

  let temporizador = null;
  inputBusca.addEventListener("input", () => {
    clearTimeout(temporizador);
    const termo = inputBusca.value.trim();
    if (termo.length < 2) {
      limpar(resultados);
      resultados.appendChild(el("p", { class: "seletor-arvore-vazio", texto: "Digite para buscar." }));
      return;
    }
    temporizador = setTimeout(async () => {
      try {
        const dados = await _buscarJson(`/cjpg-arvore/buscar?campo=${campo}&q=${encodeURIComponent(termo)}`);
        renderizarResultados(dados.resultados || []);
      } catch (erro) {
        limpar(resultados);
        resultados.appendChild(el("p", { class: "seletor-arvore-vazio", texto: erro.message }));
      }
    }, 300);
  });

  container.appendChild(busca);
  container.appendChild(resultados);
  container.appendChild(chipsSelecionados);

  return {
    codigosSelecionados: () => Array.from(selecionados.keys()).join(","),
    nomesSelecionados: () => Array.from(selecionados.values()).map((i) => i.nome),
  };
}

function criarAutocompleteMagistrado(inputEl, sugestoesEl) {
  let lista = null;
  let codigoSelecionado = null;

  async function carregar() {
    if (lista) return lista;
    const dados = await _buscarJson("/cjpg-arvore/magistrados");
    lista = dados.magistrados || [];
    return lista;
  }

  function semAcento(texto) {
    return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function mostrarSugestoes(itens) {
    limpar(sugestoesEl);
    if (!itens.length) {
      sugestoesEl.hidden = true;
      return;
    }
    for (const item of itens.slice(0, 20)) {
      const botao = el("button", { type: "button", texto: item.nome });
      botao.addEventListener("click", () => {
        inputEl.value = item.nome;
        codigoSelecionado = item.codigo;
        sugestoesEl.hidden = true;
      });
      sugestoesEl.appendChild(botao);
    }
    sugestoesEl.hidden = false;
  }

  inputEl.addEventListener("input", async () => {
    codigoSelecionado = null; // mudou o texto, a seleção anterior não vale mais
    const termo = semAcento(inputEl.value.trim());
    if (termo.length < 2) {
      sugestoesEl.hidden = true;
      return;
    }
    try {
      const todos = await carregar();
      mostrarSugestoes(todos.filter((m) => semAcento(m.nome).includes(termo)));
    } catch {
      sugestoesEl.hidden = true;
    }
  });
  document.addEventListener("click", (evento) => {
    if (!sugestoesEl.contains(evento.target) && evento.target !== inputEl) sugestoesEl.hidden = true;
  });

  return {
    nome: () => inputEl.value.trim(),
    codigo: () => codigoSelecionado,
  };
}

const seletorVara = criarSeletorArvore(document.querySelector('.seletor-arvore[data-campo="vara"]'), "vara");
const seletorClasse = criarSeletorArvore(document.querySelector('.seletor-arvore[data-campo="classe"]'), "classe");
const seletorAssunto = criarSeletorArvore(document.querySelector('.seletor-arvore[data-campo="assunto"]'), "assunto");
const autocompleteMagistrado = criarAutocompleteMagistrado(
  document.getElementById("jur-magistrado"),
  document.getElementById("jur-magistrado-sugestoes")
);

// --- Jurimetria: consulta e resultado ----------------------------------------------------------

function formatarReais(valor) {
  if (valor === null || valor === undefined) return "-";
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const RÓTULO_DESFECHO = {
  procedente: ["Procedente", "cds--tag--green"],
  parcial: ["Parcialmente procedente", "cds--tag--teal"],
  improcedente: ["Improcedente", "cds--tag--red"],
  acordo: ["Acordo homologado", "cds--tag--blue"],
  extinto: ["Extinto sem mérito", "cds--tag--gray"],
};

function cartaoJurimetria(item) {
  const card = el("article", { class: "cds--tile resultado-card" });
  const [rotuloDesfecho, corDesfecho] = RÓTULO_DESFECHO[item.desfecho] || ["Não classificado", "cds--tag--gray"];
  card.appendChild(
    el("div", { class: "resultado-cabecalho" }, [
      el("span", { class: `cds--tag ${corDesfecho}`, texto: rotuloDesfecho }),
      item.valor_condenacao != null ? el("span", { class: "cds--tag cds--tag--purple", texto: formatarReais(item.valor_condenacao) }) : null,
    ])
  );
  card.appendChild(el("h3", { texto: item.numero_processo || "Número não identificado" }));
  card.appendChild(el("p", { texto: `${item.classe || "?"} / ${item.assunto || "?"}` }));
  card.appendChild(el("p", { texto: `${item.magistrado || "?"} · ${item.vara || "?"} · ${item.comarca || "?"} · ${item.data_disponibilizacao || "?"}` }));
  if (item.trecho) {
    const detalhes = el("details", { class: "resultado-detalhes" });
    detalhes.appendChild(el("summary", { texto: "Trecho" }));
    detalhes.appendChild(el("div", { class: "resultado-texto", texto: item.trecho }));
    card.appendChild(detalhes);
  }
  return card;
}

function renderizarResumoJurimetria(agregado) {
  const grade = el("div", { class: "jurimetria-resumo" });
  const tile = (rotulo, valor) =>
    el("div", { class: "cds--tile" }, [el("span", { class: "valor", texto: valor }), el("span", { class: "rotulo", texto: rotulo })]);
  grade.appendChild(tile("Procedentes/parciais", String(agregado.procedentes_ou_parciais)));
  grade.appendChild(tile("Com valor extraído", String(agregado.com_valor_extraido)));
  if (agregado.mediana !== undefined) {
    grade.appendChild(tile("Mediana", formatarReais(agregado.mediana)));
    grade.appendChild(tile("P25", formatarReais(agregado.p25)));
    grade.appendChild(tile("P75", formatarReais(agregado.p75)));
  }
  const bloco = el("div", {}, [grade]);
  if (agregado.aviso) bloco.appendChild(notificacao("warning", "Amostra pequena", agregado.aviso));
  return bloco;
}

// --- Perfil decisório de magistrado (renderização) ---------------------------------------------

const ROTULO_TAXA = {
  taxa_procedente: ["Procedente", "cds--tag--green"],
  taxa_parcial: ["Parcialmente procedente", "cds--tag--teal"],
  taxa_improcedente: ["Improcedente", "cds--tag--red"],
  taxa_acordo: ["Acordo homologado", "cds--tag--blue"],
  taxa_extinto: ["Extinto sem mérito", "cds--tag--gray"],
};

function formatarPercentual(valor) {
  if (valor === null || valor === undefined) return "-";
  return valor.toLocaleString("pt-BR", { style: "percent", minimumFractionDigits: 1 });
}

function renderizarPerfilMagistrado(perfil) {
  const grade = el("div", { class: "jurimetria-resumo" });
  const tile = (rotulo, valor) =>
    el("div", { class: "cds--tile" }, [el("span", { class: "valor", texto: valor }), el("span", { class: "rotulo", texto: rotulo })]);
  for (const [chave, [rotulo]] of Object.entries(ROTULO_TAXA)) {
    grade.appendChild(tile(rotulo, formatarPercentual(perfil[chave])));
  }
  grade.appendChild(tile("Valor médio de indenização", formatarReais(perfil.valor_medio_indenizacao)));
  grade.appendChild(tile("Decisões classificadas", String(perfil.total_classificados)));
  grade.appendChild(tile("Com valor extraído", String(perfil.com_valor_extraido)));
  const bloco = el("div", {}, [grade]);
  if (perfil.aviso) bloco.appendChild(notificacao("warning", "Amostra pequena", perfil.aviso));
  return bloco;
}

// --- Jurimetria: formulário único, uma análise por botão ---------------------------------------

const formJurimetria = document.getElementById("form-jurimetria");
const resultadoJurimetria = document.getElementById("resultado-jurimetria");
const esperaJurimetria = document.getElementById("jur-espera");
const botoesAnaliseJurimetria = Array.from(formJurimetria.querySelectorAll('button[name="analise"]'));

const TITULO_ANALISE = {
  benchmark_valor: "Benchmark de valor",
  perfil_magistrado: "Perfil do magistrado",
};

function camposComunsJurimetria() {
  return {
    termo: document.getElementById("jur-termo").value.trim() || null,
    magistrado_nome: autocompleteMagistrado.nome() || null,
    magistrado_codigo: autocompleteMagistrado.codigo(),
    data_inicio: document.getElementById("jur-data-inicio").value.trim() || null,
    data_fim: document.getElementById("jur-data-fim").value.trim() || null,
    paginas: Number(document.getElementById("jur-paginas").value) || 1,
    vara_codigo: seletorVara.codigosSelecionados() || null,
    classe_codigo: seletorClasse.codigosSelecionados() || null,
    assunto_codigo: seletorAssunto.codigosSelecionados() || null,
  };
}

formJurimetria.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!exigirCliente(resultadoJurimetria)) return;

  const analise = evento.submitter?.value;
  const comuns = camposComunsJurimetria();

  if (analise === "perfil_magistrado" && !comuns.magistrado_nome && !comuns.magistrado_codigo) {
    mostrarErro(resultadoJurimetria, "Informe o magistrado.");
    return;
  }

  for (const botao of botoesAnaliseJurimetria) botao.disabled = true;
  esperaJurimetria.hidden = false;
  esperaJurimetria.textContent = "Consultando o CJPG — pode levar alguns segundos por página pedida…";
  limpar(resultadoJurimetria);
  try {
    let dados;
    if (analise === "perfil_magistrado") {
      dados = await cliente.chamarTool("perfil_decisorio_magistrado", comuns);
    } else {
      dados = await cliente.chamarTool("consultar_jurimetria_cjpg", {
        ...comuns,
        classe_nome: seletorClasse.nomesSelecionados().join(", ") || null,
        assunto_nome: seletorAssunto.nomesSelecionados().join(", ") || null,
      });
    }
    if (dados.erro) {
      mostrarErro(resultadoJurimetria, dados.mensagem);
      return;
    }
    resultadoJurimetria.appendChild(el("h3", { class: "jurimetria-resumo-titulo", texto: `Resultado: ${TITULO_ANALISE[analise] || analise}` }));
    for (const aviso of dados.avisos || []) {
      resultadoJurimetria.appendChild(notificacao("warning", "Busca parcial", aviso));
    }
    resultadoJurimetria.appendChild(
      el("p", { class: "campo-ajuda" }, [`Total no servidor: ${dados.total_servidor ?? "?"} | Buscados nesta consulta: ${dados.buscados}`])
    );
    if (dados.agregado) resultadoJurimetria.appendChild(renderizarResumoJurimetria(dados.agregado));
    if (dados.perfil) resultadoJurimetria.appendChild(renderizarPerfilMagistrado(dados.perfil));
    for (const item of dados.resultados || []) resultadoJurimetria.appendChild(cartaoJurimetria(item));
    if (!(dados.resultados || []).length) {
      resultadoJurimetria.appendChild(notificacao("info", "Nenhum resultado", "Tente ampliar os filtros ou o termo de busca."));
    }
  } catch (erro) {
    mostrarErro(resultadoJurimetria, erro.message);
  } finally {
    for (const botao of botoesAnaliseJurimetria) botao.disabled = false;
    esperaJurimetria.hidden = true;
  }
});

document.getElementById("botao-atualizar-monitoramentos").addEventListener("click", carregarMonitoramentos);
