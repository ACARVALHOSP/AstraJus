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
  { botao: document.getElementById("aba-clientes-botao"), painel: document.getElementById("aba-clientes") },
  { botao: document.getElementById("aba-publicacoes-oab-botao"), painel: document.getElementById("aba-publicacoes-oab") },
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
  if (alvo.painel.id === "aba-clientes") carregarClientesECasos();
  if (alvo.painel.id === "aba-publicacoes-oab") carregarPublicacoesOab();
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
    anexarBotaoCadastrarCaso(acoes, proc.numeroProcesso);
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

const _ABREV_DIA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function _abrevDiaSemana(iso) {
  return _ABREV_DIA_SEMANA[new Date(_dataUTC(iso)).getUTCDay()];
}

// feriados: Map(data ISO -> descrição). Rotulo de dia não útil só por sábado/domingo/feriado -
// usado tanto pra decidir a contagem quanto pro texto da linha no demonstrativo.
function _rotuloNaoUtil(iso, feriados) {
  const diaSemana = new Date(_dataUTC(iso)).getUTCDay();
  if (diaSemana === 0) return "Domingo";
  if (diaSemana === 6) return "Sábado";
  return feriados.get(iso) || null;
}

function ehDiaUtil(iso, feriados) {
  return _rotuloNaoUtil(iso, feriados) === null;
}

// Classifica o DIA em si (independente do evento/marco da linha), pra colorir o demonstrativo:
// "provimento" é o caso de feriado que na verdade é suspensão administrativa de expediente (não
// é data comemorativa - o TJSP descreve como "SUSPENSÃO DO EXPEDIENTE (PROVIMENTO ...)"), que vale
// a pena distinguir visualmente de um feriado de verdade mesmo os dois bloqueando a contagem igual.
function _classificarDia(iso, feriados) {
  const diaSemana = new Date(_dataUTC(iso)).getUTCDay();
  if (diaSemana === 0 || diaSemana === 6) return "fim-de-semana";
  const descricao = feriados.get(iso);
  if (descricao) return /suspens[ãa]o do expediente/i.test(descricao) ? "provimento" : "feriado";
  return "util";
}

const ROTULO_TIPO_DIA = {
  util: "Dia útil",
  "fim-de-semana": "Fim de semana",
  feriado: "Feriado forense",
  provimento: "Suspensão de expediente (provimento)",
};

function nEsimoDiaUtilApos(iso, n, feriados) {
  let atual = iso;
  let contados = 0;
  while (contados < n) {
    atual = somarDiasCorridos(atual, 1);
    if (ehDiaUtil(atual, feriados)) contados++;
  }
  return atual;
}

// Gera o demonstrativo dia-a-dia completo (mesmo formato do "Demonstrativo" da calculadora da
// PGM-SP): cada linha tem a data, o nº do dia do prazo (só nos dias úteis já dentro da contagem)
// e o evento (fim de semana, feriado, marco de cada regra, ou "Vencimento" na última linha).
// dia1/vencimento são derivados das próprias linhas geradas - uma só fonte de verdade.
function gerarDemonstrativoPrazo(dataBaseISO, dias, tipo, feriados) {
  const linhas = [];
  const adicionar = (data, evento, diaPrazo = null) =>
    linhas.push({ data, evento, diaPrazo, tipoDia: _classificarDia(data, feriados) });
  let atual = dataBaseISO;
  let dia1;

  if (tipo === "dje") {
    adicionar(atual, "Disponibilização no DJe");
    let publicacao = null;
    while (publicacao === null) {
      atual = somarDiasCorridos(atual, 1);
      const naoUtil = _rotuloNaoUtil(atual, feriados);
      if (naoUtil) { adicionar(atual, naoUtil); continue; }
      adicionar(atual, "Publicação");
      publicacao = atual;
    }
    while (dia1 === undefined) {
      atual = somarDiasCorridos(atual, 1);
      const naoUtil = _rotuloNaoUtil(atual, feriados);
      if (naoUtil) { adicionar(atual, naoUtil); continue; }
      dia1 = atual;
    }
  } else if (tipo === "mandado") {
    adicionar(atual, "Juntada de mandado/AR");
    while (dia1 === undefined) {
      atual = somarDiasCorridos(atual, 1);
      const naoUtil = _rotuloNaoUtil(atual, feriados);
      if (naoUtil) { adicionar(atual, naoUtil); continue; }
      dia1 = atual;
    }
  } else if (tipo === "intimacao_saj") {
    adicionar(atual, "1º dia corrido (entrada no Portal SAJ)");
    for (let i = 2; i <= 10; i++) {
      atual = somarDiasCorridos(atual, 1);
      adicionar(atual, `${i}º dia corrido${i === 10 ? " (intimação recebida)" : ""}`);
    }
    while (dia1 === undefined) {
      atual = somarDiasCorridos(atual, 1);
      const naoUtil = _rotuloNaoUtil(atual, feriados);
      if (naoUtil) { adicionar(atual, naoUtil); continue; }
      dia1 = atual;
    }
  } else if (tipo === "citacao_saj") {
    adicionar(atual, "Recebimento da citação no Portal SAJ");
    let contados = 0;
    while (contados < 5) {
      atual = somarDiasCorridos(atual, 1);
      const naoUtil = _rotuloNaoUtil(atual, feriados);
      if (naoUtil) { adicionar(atual, naoUtil); continue; }
      contados++;
      const marcador = `${contados}º dia útil (art. 231, IX, do CPC)`;
      if (contados === 5) {
        dia1 = atual;
        adicionar(atual, `${marcador} | Início do prazo`, 1);
      } else {
        adicionar(atual, marcador);
      }
    }
  } else {
    throw new Error(`tipo de contagem desconhecido: ${tipo}`);
  }

  let contador = tipo === "citacao_saj" ? 1 : 0;
  if (tipo !== "citacao_saj") {
    atual = dia1;
    contador = 1;
    adicionar(atual, contador === dias ? "Vencimento" : "", contador);
  }
  while (contador < dias) {
    atual = somarDiasCorridos(atual, 1);
    const naoUtil = _rotuloNaoUtil(atual, feriados);
    if (naoUtil) { adicionar(atual, naoUtil); continue; }
    contador++;
    adicionar(atual, contador === dias ? "Vencimento" : "", contador);
  }

  return { linhas, dia1, vencimento: atual };
}

const _cacheFeriados = new Map(); // `${municipio}|${ano}` -> Map(iso -> descricao)

async function _buscarFeriadosAno(municipio, ano) {
  const chave = `${municipio}|${ano}`;
  if (_cacheFeriados.has(chave)) return _cacheFeriados.get(chave);
  const dados = await cliente.chamarTool("buscar_feriados_forenses", { municipio, ano });
  if (dados.erro) throw new Error(dados.mensagem);
  const mapa = new Map((dados.feriados || []).map((f) => [f.data, f.descricao || "Feriado forense"]));
  _cacheFeriados.set(chave, mapa);
  return mapa;
}

async function _uniaoFeriados(municipio, anos) {
  const mapas = await Promise.all(anos.map((ano) => _buscarFeriadosAno(municipio, ano)));
  const uniao = new Map();
  for (const mapa of mapas) for (const [data, descricao] of mapa) uniao.set(data, descricao);
  return uniao;
}

// Calcula o demonstrativo completo buscando os feriados necessários; se o vencimento cair num ano
// ainda não buscado (prazo longo), busca também esse ano e recalcula.
async function calcularPrazoComFeriados(dataBaseISO, dias, tipo, municipio) {
  if (!cliente) throw new Error("Informe o seu token e conecte antes de calcular o prazo.");
  const anoBase = Number(dataBaseISO.slice(0, 4));
  let anos = [anoBase, anoBase + 1];
  let feriados = await _uniaoFeriados(municipio, anos);
  let resultado = gerarDemonstrativoPrazo(dataBaseISO, dias, tipo, feriados);
  const anoVencimento = Number(resultado.vencimento.slice(0, 4));
  if (anoVencimento > anoBase + 1) {
    anos = [...anos, anoVencimento];
    feriados = await _uniaoFeriados(municipio, anos);
    resultado = gerarDemonstrativoPrazo(dataBaseISO, dias, tipo, feriados);
  }
  return resultado;
}

// --- Demonstrativo em PDF (janela nova, impressão pelo próprio navegador) -------------------
//
// Mesma técnica da calculadora da PGM-SP: uma janela com a tabela dia-a-dia e um botão que chama
// window.print() - o navegador gera o PDF (ou imprime de verdade) sem precisar de nenhuma
// biblioteca extra. Conteúdo é todo montado via DOM (nunca innerHTML/document.write com dados),
// igual ao resto do painel.

function _elEm(doc, tag, attrs = {}, filhos = []) {
  const elemento = doc.createElement(tag);
  for (const [chave, valor] of Object.entries(attrs)) {
    if (chave === "class") elemento.className = valor;
    else if (chave === "texto") elemento.textContent = valor;
    else if (valor !== null && valor !== undefined) elemento.setAttribute(chave, valor);
  }
  for (const filho of [].concat(filhos)) {
    if (filho === null || filho === undefined) continue;
    elemento.appendChild(typeof filho === "string" ? doc.createTextNode(filho) : filho);
  }
  return elemento;
}

const _SVG_NS = "http://www.w3.org/2000/svg";

function _elSvg(doc, tag, attrs = {}, filhos = []) {
  const elemento = doc.createElementNS(_SVG_NS, tag);
  for (const [chave, valor] of Object.entries(attrs)) elemento.setAttribute(chave, valor);
  for (const filho of [].concat(filhos)) if (filho) elemento.appendChild(filho);
  return elemento;
}

// Ícones próprios (sem biblioteca externa): um círculo com check (útil), círculo com traço (fim
// de semana), estrela (feriado) e duas barras de "pausa" (provimento - suspensão de expediente).
// Usam currentColor pra herdar a cor da célula/legenda que os envolve.
function _iconeTipoDia(doc, tipoDia) {
  const svg = _elSvg(doc, "svg", { viewBox: "0 0 16 16", width: "14", height: "14", class: "icone-dia", "aria-hidden": "true" });
  const tracoFino = { fill: "none", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round" };
  if (tipoDia === "util") {
    svg.appendChild(_elSvg(doc, "circle", { cx: "8", cy: "8", r: "7", fill: "none", stroke: "currentColor", "stroke-width": "1.5" }));
    svg.appendChild(_elSvg(doc, "path", { d: "M4.6 8.3l2.2 2.2 4.4-4.9", ...tracoFino }));
  } else if (tipoDia === "fim-de-semana") {
    svg.appendChild(_elSvg(doc, "circle", { cx: "8", cy: "8", r: "7", fill: "none", stroke: "currentColor", "stroke-width": "1.5" }));
    svg.appendChild(_elSvg(doc, "line", { x1: "4.7", y1: "8", x2: "11.3", y2: "8", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" }));
  } else if (tipoDia === "feriado") {
    svg.appendChild(_elSvg(doc, "path", {
      d: "M8 1.3l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.1l-3.8 2 .7-4.3-3.1-3 4.3-.6z",
      fill: "currentColor",
    }));
  } else if (tipoDia === "provimento") {
    svg.appendChild(_elSvg(doc, "rect", { x: "3.8", y: "3", width: "2.6", height: "10", rx: "0.8", fill: "currentColor" }));
    svg.appendChild(_elSvg(doc, "rect", { x: "9.6", y: "3", width: "2.6", height: "10", rx: "0.8", fill: "currentColor" }));
  }
  return svg;
}

function abrirDemonstrativoPdf({ dataBase, dias, tipo, municipio, dia1, vencimento, linhas }) {
  // Sem noopener/noreferrer aqui: o conteúdo é escrito por este mesmo script logo abaixo (não é
  // uma URL de terceiro), e noopener faz window.open devolver null - a janela ainda abre (em
  // branco), mas perdemos a referência pra preenchê-la.
  const janela = window.open("", "_blank", "width=860,height=900");
  if (!janela) {
    window.alert("O navegador bloqueou a nova janela. Permita pop-ups para este site e tente novamente.");
    return;
  }
  const doc = janela.document;
  const tipoRotulo = (TIPOS_CONTAGEM_PRAZO.find((t) => t.valor === tipo) || {}).rotulo || tipo;

  const estilo = doc.createElement("style");
  estilo.textContent = `
    body { font-family: Arial, Helvetica, sans-serif; color: #161616; margin: 2rem; }
    h1 { font-size: 1.25rem; margin: 0 0 0.25rem; }
    p.base { margin: 0 0 1rem; color: #525252; font-size: 0.9rem; }
    .legenda { display: flex; flex-wrap: wrap; gap: 0.25rem 1.1rem; margin: 0 0 1rem; font-size: 0.8125rem; }
    .legenda-item { display: inline-flex; align-items: center; gap: 0.35rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td { border: 1px solid #c6c6c6; padding: 0.35rem 0.5rem; text-align: left; vertical-align: middle; }
    th { background: #f4f4f4; }
    td.col-icone { width: 1.75rem; text-align: center; }
    tr.dia-util td { background: #f1fbf4; color: #0e6027; }
    tr.dia-fim-de-semana td { background: #f4f4f4; color: #525252; }
    tr.dia-feriado td { background: #fff1f1; color: #a2191f; }
    tr.dia-provimento td { background: #fff8e6; color: #8a5300; }
    tr.dia-util td.col-data, tr.dia-util td.col-dia, tr.dia-util td.col-prazo,
    tr.dia-fim-de-semana td.col-data, tr.dia-fim-de-semana td.col-dia, tr.dia-fim-de-semana td.col-prazo,
    tr.dia-feriado td.col-data, tr.dia-feriado td.col-dia, tr.dia-feriado td.col-prazo,
    tr.dia-provimento td.col-data, tr.dia-provimento td.col-dia, tr.dia-provimento td.col-prazo { color: #161616; }
    tr.venc td { font-weight: bold; background: #defbe6 !important; }
    .acoes { margin-bottom: 1rem; }
    .aviso { margin-top: 1rem; font-size: 0.8rem; color: #525252; }
    @media print { .acoes { display: none; } }
  `;
  doc.head.appendChild(estilo);
  doc.title = "Demonstrativo do prazo";

  const botaoPdf = _elEm(doc, "button", { texto: "Gerar PDF" });
  botaoPdf.addEventListener("click", () => janela.print());
  doc.body.appendChild(_elEm(doc, "div", { class: "acoes" }, [botaoPdf]));

  doc.body.appendChild(_elEm(doc, "h1", { texto: "Demonstrativo do prazo" }));
  doc.body.appendChild(
    _elEm(doc, "p", { class: "base" }, [
      `Prazo de ${dias} dia(s) úteis · ${tipoRotulo} · município/comarca: ${municipio}.`,
      _elEm(doc, "br"),
      `Base: ${formatarDataSimples(dataBase)} · Início da contagem (dia 1): ${formatarDataSimples(dia1)} · Vencimento: ${formatarDataSimples(vencimento)}`,
    ])
  );

  doc.body.appendChild(
    _elEm(
      doc,
      "div",
      { class: "legenda" },
      Object.entries(ROTULO_TIPO_DIA).map(([tipoDia, rotulo]) =>
        _elEm(doc, "span", { class: `legenda-item dia-${tipoDia}` }, [_iconeTipoDia(doc, tipoDia), rotulo])
      )
    )
  );

  const corpoTabela = _elEm(doc, "tbody");
  for (const linha of linhas) {
    const classes = [`dia-${linha.tipoDia}`, linha.evento === "Vencimento" ? "venc" : null].filter(Boolean).join(" ");
    corpoTabela.appendChild(
      _elEm(doc, "tr", { class: classes }, [
        _elEm(doc, "td", { class: "col-icone" }, [_iconeTipoDia(doc, linha.tipoDia)]),
        _elEm(doc, "td", { class: "col-data", texto: formatarDataSimples(linha.data) }),
        _elEm(doc, "td", { class: "col-dia", texto: _abrevDiaSemana(linha.data) }),
        _elEm(doc, "td", { class: "col-prazo", texto: linha.diaPrazo === null ? "-" : String(linha.diaPrazo) }),
        _elEm(doc, "td", { texto: linha.evento || "" }),
      ])
    );
  }
  doc.body.appendChild(
    _elEm(doc, "table", {}, [
      _elEm(doc, "thead", {}, [
        _elEm(doc, "tr", {}, [
          _elEm(doc, "th", { texto: "" }),
          _elEm(doc, "th", { texto: "Data" }),
          _elEm(doc, "th", { texto: "Dia" }),
          _elEm(doc, "th", { texto: "Dia do prazo" }),
          _elEm(doc, "th", { texto: "Evento" }),
        ]),
      ]),
      corpoTabela,
    ])
  );
  doc.body.appendChild(
    _elEm(doc, "p", {
      class: "aviso",
      texto: "Cálculo informativo, sem valor oficial - confirme sempre no sistema do tribunal. Considera sábados, domingos e os feriados forenses do município informado.",
    })
  );
  janela.focus();
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
      const tipo = campoTipo.value;
      const { dia1, vencimento, linhas } = await calcularPrazoComFeriados(dataBase, dias, tipo, municipio);
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
      const botaoPdf = el("button", {
        class: "cds--btn cds--btn--tertiary cds--btn--sm", type: "button", texto: "Ver demonstrativo dia a dia (PDF)",
      });
      botaoPdf.addEventListener("click", () => {
        abrirDemonstrativoPdf({ dataBase, dias, tipo, municipio, dia1, vencimento, linhas });
      });
      resultadoEl.appendChild(botaoPdf);
      if (item.numeroprocessocommascara) {
        anexarBotaoEventoAgenda(resultadoEl, item.numeroprocessocommascara, vencimento, `Prazo: ${dias} dias (${municipio})`);
      }
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

  if (item.numeroprocessocommascara) {
    const nomesPartes = (item.destinatarios || []).map((d) => d.nome).filter(Boolean);
    anexarBotaoCadastrarCaso(acoes, item.numeroprocessocommascara, null, {
      rotulo: "Cadastrar cliente e caso",
      nomeSugerido: nomesPartes[0] || "",
      tituloSugerido: item.nomeClasse || item.tipoComunicacao || "",
      partes: nomesPartes,
      tribunal: (item.siglaTribunal || "").toLowerCase() || null,
    });
  }

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
  const campoNome = document.getElementById("pub-nome-oab");
  const nome = campoNome ? campoNome.value.trim() || undefined : undefined;
  return { numero_processo, sigla_tribunal, numero_oab, uf_oab, nome };
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

async function _enviarJson(url, corpo) {
  if (!cliente) throw new ErroMCP(401, "Conecte-se primeiro.");
  const resposta = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cliente.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new ErroMCP(resposta.status, dados.mensagem || `Falha ao enviar para ${url} (HTTP ${resposta.status}).`);
  return dados;
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

// --- Clientes e casos (Fase 1 da gestão de escritório) ------------------------------------
//
// /clientes e /casos são endpoints HTTP simples (não tools MCP, mesmo padrão das árvores do
// CJPG acima): CRUD de apoio ao painel, não faz sentido expor isso a um agente de IA.

let _cacheClientes = [];

function cartaoCliente(c) {
  const card = el("article", { class: "cds--tile resultado-card" });
  card.appendChild(el("h3", { texto: c.nome }));
  if (c.cpf_cnpj) card.appendChild(el("p", { texto: `CPF/CNPJ: ${c.cpf_cnpj}` }));
  if (c.telefone) card.appendChild(el("p", { texto: `Telefone: ${c.telefone}` }));
  if (c.email) card.appendChild(el("p", { texto: `E-mail: ${c.email}` }));
  if (c.observacoes) card.appendChild(el("p", { texto: c.observacoes }));
  return card;
}

function _resumoEventoCaso(evento) {
  const c = evento.conteudo || {};
  if (evento.tipo === "publicacao") {
    const partes = [c.tipoComunicacao, c.nomeOrgao].filter(Boolean).join(" · ");
    return partes || c.texto || "Publicação";
  }
  if (evento.tipo === "prazo_agenda") {
    return `Evento criado na agenda: ${c.titulo || "Prazo"} em ${formatarDataSimples(c.data)}`;
  }
  if (evento.tipo === "evento_agenda_alterado") {
    if (c.status === "cancelled") return "Evento da agenda foi cancelado";
    return `Evento da agenda mudou: ${c.titulo || "Prazo"} agora em ${formatarDataSimples(c.data)}`;
  }
  return evento.tipo;
}

function linhaDoTempoCaso(eventos) {
  if (!eventos.length) {
    return notificacao("info", "Nenhuma movimentação registrada ainda", "Publicações de processos monitorados vinculados a este caso aparecem aqui automaticamente.");
  }
  const lista = el("ul", { class: "linha-tempo-caso" });
  for (const evento of eventos) {
    lista.appendChild(
      el("li", {}, [
        el("strong", { texto: formatarData(evento.criado_em) }),
        ` — ${_resumoEventoCaso(evento)}`,
        evento.numero_processo ? el("span", { class: "campo-ajuda", texto: ` (processo ${evento.numero_processo})` }) : null,
      ])
    );
  }
  return lista;
}

function cartaoCaso(caso) {
  const nomeCliente = (id) => (_cacheClientes.find((c) => c.id === id) || {}).nome || id;
  const nomesClientes = [caso.cliente_id, ...(caso.clientes_adicionais || [])].map(nomeCliente);
  const card = el("article", { class: "cds--tile resultado-card" });
  card.appendChild(el("h3", { texto: caso.titulo || "(sem título)" }));
  card.appendChild(el("p", { texto: `Cliente(s): ${nomesClientes.join(", ")}` }));
  if (caso.responsavel) card.appendChild(el("p", { texto: `Responsável: ${caso.responsavel}` }));
  card.appendChild(el("p", { texto: `Processo(s): ${(caso.processos || []).join(", ") || "nenhum"}` }));
  card.appendChild(el("span", { class: "cds--tag cds--tag--gray", texto: caso.status }));
  if (caso.drive_pasta_id) {
    card.appendChild(
      el("p", {}, [el("a", {
        href: `https://drive.google.com/drive/folders/${caso.drive_pasta_id}`, target: "_blank", rel: "noopener",
        texto: "Abrir pasta no Drive",
      })])
    );
  }

  const botaoTimeline = el("button", {
    class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "Ver linha do tempo",
  });
  const areaTimeline = el("div", { class: "linha-tempo-area", hidden: "hidden" });
  botaoTimeline.addEventListener("click", async () => {
    const abrindo = areaTimeline.hidden;
    areaTimeline.hidden = !abrindo;
    if (!abrindo || areaTimeline.dataset.carregado) return;
    limpar(areaTimeline);
    areaTimeline.appendChild(el("p", { class: "app-espera" }, ["Carregando…"]));
    try {
      const detalhe = await _buscarJson(`/casos/${caso.id}`);
      limpar(areaTimeline);
      areaTimeline.appendChild(linhaDoTempoCaso(detalhe.eventos || []));
      areaTimeline.dataset.carregado = "1";
    } catch (erro) {
      limpar(areaTimeline);
      areaTimeline.appendChild(notificacao("error", "Não foi possível carregar a linha do tempo", erro.message));
    }
  });
  card.appendChild(botaoTimeline);
  card.appendChild(areaTimeline);
  return card;
}

function cartaoPendente(p) {
  const d = p.dados || {};
  const card = el("article", { class: "cds--tile resultado-card" });
  card.appendChild(el("h3", { texto: d.tipoComunicacao || "Processo novo encontrado" }));
  card.appendChild(el("p", { texto: `Processo: ${d.numeroprocessocommascara || p.numero_processo}` }));
  if (d.nomeOrgao) card.appendChild(el("p", { texto: `Órgão: ${d.nomeOrgao}` }));
  if (d.siglaTribunal) card.appendChild(el("p", { texto: `Tribunal: ${d.siglaTribunal}` }));
  card.appendChild(el("p", { class: "campo-ajuda", texto: `Encontrado monitorando a OAB de ${p.usuario} em ${formatarData(p.criado_em)}` }));

  const acoes = el("div", { class: "resultado-acoes" });
  anexarBotaoCadastrarCaso(acoes, p.numero_processo, () => {
    card.remove();
    carregarClientesECasos();
  });
  const botaoDescartar = el("button", {
    class: "cds--btn cds--btn--danger--tertiary cds--btn--sm", type: "button", texto: "Descartar",
  });
  botaoDescartar.addEventListener("click", async () => {
    botaoDescartar.disabled = true;
    try {
      await _enviarJson(`/pendentes/${p.numero_processo}/descartar`, {});
      card.remove();
    } catch (erro) {
      mostrarErro(acoes, erro.message);
      botaoDescartar.disabled = false;
    }
  });
  acoes.appendChild(botaoDescartar);
  card.appendChild(acoes);
  return card;
}

async function carregarPendentes() {
  const listaPendentesEl = document.getElementById("lista-pendentes");
  limpar(listaPendentesEl);
  try {
    const { pendentes } = await _buscarJson("/pendentes");
    if (!(pendentes || []).length) {
      listaPendentesEl.appendChild(notificacao("info", "Nenhum processo pendente de triagem"));
    } else {
      for (const p of pendentes) listaPendentesEl.appendChild(cartaoPendente(p));
    }
  } catch (erro) {
    mostrarErro(listaPendentesEl, erro.message);
  }
}

async function carregarClientesECasos() {
  if (!exigirCliente(document.getElementById("lista-clientes"))) return;
  const listaClientesEl = document.getElementById("lista-clientes");
  const listaCasosEl = document.getElementById("lista-casos");
  const selectCliente = document.getElementById("caso-cliente");
  limpar(listaClientesEl);
  limpar(listaCasosEl);
  carregarPendentes();
  try {
    const { clientes } = await _buscarJson("/clientes");
    _cacheClientes = clientes || [];
    limpar(selectCliente);
    if (!_cacheClientes.length) {
      selectCliente.appendChild(el("option", { value: "" }, ["Cadastre um cliente primeiro"]));
    }
    for (const c of _cacheClientes) {
      selectCliente.appendChild(el("option", { value: c.id }, [c.nome]));
    }
    if (!_cacheClientes.length) {
      listaClientesEl.appendChild(notificacao("info", "Nenhum cliente cadastrado ainda"));
    } else {
      for (const c of _cacheClientes) listaClientesEl.appendChild(cartaoCliente(c));
    }

    const { casos } = await _buscarJson("/casos");
    if (!(casos || []).length) {
      listaCasosEl.appendChild(notificacao("info", "Nenhum caso cadastrado ainda"));
    } else {
      for (const caso of casos) listaCasosEl.appendChild(cartaoCaso(caso));
    }
  } catch (erro) {
    mostrarErro(listaClientesEl, erro.message);
  }
}

const formCliente = document.getElementById("form-cliente");
const resultadoCliente = document.getElementById("resultado-cliente");

formCliente.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!exigirCliente(resultadoCliente)) return;
  const botao = formCliente.querySelector("button[type=submit]");
  const dados = Object.fromEntries(new FormData(formCliente).entries());
  const pararEspera = mostrarEspera(resultadoCliente, botao, "Cadastrando cliente");
  try {
    await _enviarJson("/clientes", dados);
    limpar(resultadoCliente);
    resultadoCliente.appendChild(notificacao("success", "Cliente cadastrado"));
    formCliente.reset();
    carregarClientesECasos();
  } catch (erro) {
    mostrarErro(resultadoCliente, erro.message);
  } finally {
    pararEspera();
  }
});

const formCaso = document.getElementById("form-caso");
const resultadoCaso = document.getElementById("resultado-caso");

formCaso.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!exigirCliente(resultadoCaso)) return;
  const botao = formCaso.querySelector("button[type=submit]");
  const numeros = document.getElementById("caso-processos").value.split(",").map((s) => s.trim()).filter(Boolean);
  const corpo = {
    cliente_id: document.getElementById("caso-cliente").value,
    titulo: document.getElementById("caso-titulo").value.trim(),
    responsavel: document.getElementById("caso-responsavel").value.trim(),
    numeros_processo: numeros,
  };
  const pararEspera = mostrarEspera(resultadoCaso, botao, "Cadastrando caso");
  try {
    await _enviarJson("/casos", corpo);
    limpar(resultadoCaso);
    resultadoCaso.appendChild(notificacao("success", "Caso cadastrado"));
    formCaso.reset();
    carregarClientesECasos();
  } catch (erro) {
    mostrarErro(resultadoCaso, erro.message);
  } finally {
    pararEspera();
  }
});

// Botão "Cadastrar como caso" no resultado da consulta de processo (DataJud): abre um mini
// formulário inline, sem precisar trocar de aba. Cria o cliente na hora se for novo (Fase 1).
function anexarBotaoCadastrarCaso(acoes, numeroProcesso, aoSalvar, opcoes = {}) {
  const { rotulo, nomeSugerido, tituloSugerido, partes, tribunal } = opcoes;
  const botao = el("button", {
    class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: rotulo || "Cadastrar como caso",
  });
  acoes.appendChild(botao);

  botao.addEventListener("click", async () => {
    if (botao.nextSibling && botao.nextSibling.classList && botao.nextSibling.classList.contains("mini-form-caso")) {
      botao.nextSibling.remove();
      return;
    }
    if (!_cacheClientes.length) {
      try {
        const { clientes } = await _buscarJson("/clientes");
        _cacheClientes = clientes || [];
      } catch {
        // segue mesmo sem conseguir pré-carregar: o select só vai ficar com "Novo cliente"
      }
    }

    const usaCheckboxesPartes = Boolean(partes && partes.length);

    const selectCliente = el("select", { class: "cds--text-input" }, [
      el("option", { value: "" }, ["+ Novo cliente"]),
      ..._cacheClientes.map((c) => el("option", { value: c.id }, [c.nome])),
    ]);
    const campoNomeNovo = el("input", {
      class: "cds--text-input",
      placeholder: usaCheckboxesPartes ? "+ outro cliente (opcional)" : "Nome do novo cliente",
      value: usaCheckboxesPartes ? "" : (nomeSugerido || ""),
    });
    const campoTitulo = el("input", { class: "cds--text-input", placeholder: "Título do caso (opcional)", value: tituloSugerido || "" });
    const botaoSalvar = el("button", { class: "cds--btn cds--btn--primary cds--btn--sm", type: "button", texto: "Salvar caso" });
    const statusMini = el("span", { class: "app-espera app-espera--inline" });

    selectCliente.addEventListener("change", () => {
      campoNomeNovo.hidden = selectCliente.value !== "";
    });

    // Publicações do DJEN costumam listar mais de uma parte (autor e réu). Em vez de forçar
    // escolher só uma, cada parte vira uma checkbox: as marcadas viram clientes do mesmo caso
    // (a primeira marcada é o cliente principal, as demais entram em clientes_adicionais).
    let checkboxesPartes = null;
    let blocoPartes = null;
    if (usaCheckboxesPartes) {
      checkboxesPartes = partes.map((nome, i) => {
        const cb = el("input", { type: "checkbox", id: `parte-cb-${i}-${Math.random().toString(36).slice(2, 7)}` });
        cb.checked = i === 0;
        return { nome, checkbox: cb };
      });
      blocoPartes = el(
        "div", { class: "cds--form-item partes-checkbox-lista" },
        [
          el("label", { class: "cds--label", texto: "Cadastrar como cliente(s) deste caso" }),
          ...checkboxesPartes.map(({ nome, checkbox }) =>
            el("label", { class: "parte-checkbox-item" }, [checkbox, ` ${nome}`])
          ),
        ]
      );
      selectCliente.hidden = true; // nesse modo, cliente existente também é resolvido pelo nome no servidor
    }

    // DataJud não tem nome de parte (ver server.py), só classe/órgão - por isso é um botão à
    // parte (opcional, pode levar até 2min), não algo que trava o cadastro básico vindo do DJEN.
    let botaoDataJud = null;
    let statusDataJud = null;
    if (tribunal) {
      botaoDataJud = el("button", {
        class: "cds--btn cds--btn--tertiary cds--btn--sm", type: "button", texto: "Buscar classe/órgão no DataJud",
      });
      statusDataJud = el("span", { class: "app-espera app-espera--inline" });
      const rotuloOriginalDataJud = botaoDataJud.textContent;
      botaoDataJud.addEventListener("click", async () => {
        if (botaoDataJud.disabled) return; // já consultando - evita disparo duplicado
        botaoDataJud.disabled = true;
        botaoDataJud.textContent = "Consultando…";
        statusDataJud.textContent = "Pode levar até 2min, aguarde…";
        try {
          const dados = await cliente.chamarTool("consultar_processo_datajud", { tribunal, numero_processo: numeroProcesso });
          if (dados.erro) throw new ErroMCP(200, dados.mensagem || "Falha ao consultar o DataJud.");
          const proc = (dados.processos || [])[0];
          if (!proc) throw new ErroMCP(200, dados.mensagem || "Processo não encontrado no DataJud.");
          const partesTitulo = [proc.classe, proc.orgaoJulgador].filter(Boolean).join(" - ");
          // idempotente: um segundo clique não duplica o mesmo trecho se já estiver no título
          if (partesTitulo && !campoTitulo.value.includes(partesTitulo)) {
            campoTitulo.value = campoTitulo.value ? `${campoTitulo.value} (${partesTitulo})` : partesTitulo;
          }
          statusDataJud.textContent = "Classe/órgão adicionados.";
          botaoDataJud.textContent = "Atualizar classe/órgão do DataJud";
        } catch (erro) {
          statusDataJud.textContent = erro.message || "Falha ao consultar o DataJud (sem detalhes do servidor).";
          botaoDataJud.textContent = rotuloOriginalDataJud;
        } finally {
          botaoDataJud.disabled = false;
        }
      });
    }

    botaoSalvar.addEventListener("click", async () => {
      botaoSalvar.disabled = true;
      limpar(statusMini);
      try {
        const corpo = {
          titulo: campoTitulo.value.trim() || null,
          numeros_processo: [numeroProcesso],
        };
        if (usaCheckboxesPartes) {
          const nomesEscolhidos = checkboxesPartes.filter((p) => p.checkbox.checked).map((p) => p.nome);
          const nomeExtra = campoNomeNovo.value.trim();
          if (nomeExtra) nomesEscolhidos.push(nomeExtra);
          if (!nomesEscolhidos.length) {
            throw new ErroMCP(400, "Marque ao menos uma parte como cliente, ou informe um nome em \"+ outro cliente\".");
          }
          const [primeiro, ...resto] = nomesEscolhidos;
          corpo.cliente_novo = { nome: primeiro };
          corpo.clientes_adicionais = resto.map((nome) => ({ cliente_novo: { nome } }));
        } else if (selectCliente.value) {
          corpo.cliente_id = selectCliente.value;
        } else {
          const nomeNovo = campoNomeNovo.value.trim();
          if (!nomeNovo) throw new ErroMCP(400, "Informe o nome do novo cliente ou escolha um existente.");
          corpo.cliente_novo = { nome: nomeNovo };
        }
        await _enviarJson("/casos", corpo);
        miniForm.replaceWith(notificacao("success", "Caso cadastrado"));
        if (aoSalvar) aoSalvar();
      } catch (erro) {
        statusMini.textContent = erro.message;
        botaoSalvar.disabled = false;
      }
    });

    const miniForm = el("div", { class: "mini-form-caso" }, [
      el("div", { class: "cds--form-item" }, [selectCliente]),
      blocoPartes,
      el("div", { class: "cds--form-item" }, [campoNomeNovo]),
      el("div", { class: "cds--form-item" }, [campoTitulo]),
      botaoDataJud,
      statusDataJud,
      botaoSalvar,
      statusMini,
    ]);
    botao.insertAdjacentElement("afterend", miniForm);
  });
}

function _soDigitos(valor) {
  return (valor || "").replace(/\D/g, "");
}

// Botão "Criar evento na agenda (Google)" no resultado da calculadora de prazo (Fase 4):
// pede qual caso, e cria o evento via POST /casos/<id>/evento-calendar. Só aparece quando há
// pelo menos um caso cadastrado - sem caso, não há onde vincular o evento.
function anexarBotaoEventoAgenda(container, numeroProcesso, dataVencimentoISO, tituloSugerido) {
  const botao = el("button", {
    class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "Criar evento na agenda (Google)",
  });
  container.appendChild(botao);

  botao.addEventListener("click", async () => {
    if (botao.nextSibling && botao.nextSibling.classList && botao.nextSibling.classList.contains("mini-form-caso")) {
      botao.nextSibling.remove();
      return;
    }
    let casos = [];
    try {
      const resposta = await _buscarJson("/casos");
      casos = resposta.casos || [];
    } catch (erro) {
      mostrarErro(container, erro.message);
      return;
    }
    if (!casos.length) {
      container.appendChild(notificacao("info", "Nenhum caso cadastrado", "Cadastre um caso para este processo antes de criar o evento na agenda."));
      return;
    }
    const numeroDigitos = _soDigitos(numeroProcesso);
    const casosDoProcesso = casos.filter((c) => (c.processos || []).includes(numeroDigitos));
    const opcoes = casosDoProcesso.length ? casosDoProcesso : casos;

    const selectCaso = el(
      "select", { class: "cds--text-input" },
      opcoes.map((c) => el("option", { value: c.id }, [c.titulo || c.id]))
    );
    const botaoSalvar = el("button", { class: "cds--btn cds--btn--primary cds--btn--sm", type: "button", texto: "Criar evento" });
    const statusMini = el("span", { class: "app-espera app-espera--inline" });

    botaoSalvar.addEventListener("click", async () => {
      botaoSalvar.disabled = true;
      limpar(statusMini);
      try {
        const resultado = await _enviarJson(`/casos/${selectCaso.value}/evento-calendar`, {
          data: dataVencimentoISO, titulo: tituloSugerido,
        });
        const aviso = notificacao("success", "Evento criado na agenda");
        if (resultado.link) aviso.appendChild(el("p", {}, [el("a", { href: resultado.link, target: "_blank", rel: "noopener", texto: "Abrir no Google Calendar" })]));
        miniForm.replaceWith(aviso);
      } catch (erro) {
        statusMini.textContent = erro.message;
        botaoSalvar.disabled = false;
      }
    });

    const miniForm = el("div", { class: "mini-form-caso" }, [
      el("div", { class: "cds--form-item" }, [el("label", { class: "cds--label", texto: "Vincular ao caso" }), selectCaso]),
      botaoSalvar,
      statusMini,
    ]);
    botao.insertAdjacentElement("afterend", miniForm);
  });
}

// --- Publicações por OAB (log geral, captura a cada 24h) ----------------------------------
//
// Diferente de "Processos novos para triagem" (aba Clientes e casos): aqui entra TODA
// publicação achada pelo monitoramento de OAB, tenha ou não caso já cadastrado, com um status
// de tratamento manual (não tratada / tratada / arquivada). Captura roda a cada 24h no servidor.

const _ROTULO_STATUS_PUB_OAB = { nao_tratada: "Não tratada", tratada: "Tratada", arquivada: "Arquivada" };

const _TAG_COR_STATUS_PUB_OAB = { nao_tratada: "warm-gray", tratada: "green", arquivada: "gray" };

function _badgeStatusPubOab(status) {
  const cor = _TAG_COR_STATUS_PUB_OAB[status] || "gray";
  return el("span", { class: `cds--tag cds--tag--${cor} cds--tag--sm`, texto: _ROTULO_STATUS_PUB_OAB[status] || status });
}

function _irParaConsultaProcesso(numeroProcesso) {
  const abaProcesso = abas.find((a) => a.painel.id === "aba-processo");
  if (abaProcesso) selecionarAba(abaProcesso);
  const campo = document.getElementById("numero-processo");
  if (campo) campo.value = numeroProcesso || "";
}

const _publicacoesOabSelecionadas = new Set();

function _atualizarBotoesLotePubOab() {
  const tem = _publicacoesOabSelecionadas.size > 0;
  document.getElementById("pub-oab-marcar-tratada").disabled = !tem;
  document.getElementById("pub-oab-arquivar").disabled = !tem;
}

function _statusGeralPubOab(mensagem, erro) {
  const areaStatus = document.getElementById("pub-oab-status-geral");
  if (!areaStatus) return;
  limpar(areaStatus);
  if (mensagem) areaStatus.appendChild(notificacao(erro ? "error" : "success", mensagem));
}

async function _aplicarStatusPubOab(hashes, status) {
  try {
    await _enviarJson("/publicacoes-oab/status", { hashes, status });
    _statusGeralPubOab(`${hashes.length} publicação(ões) marcada(s) como "${_ROTULO_STATUS_PUB_OAB[status]}".`);
    _publicacoesOabSelecionadas.clear();
    carregarPublicacoesOab();
  } catch (erro) {
    _statusGeralPubOab(erro.message, true);
  }
}

let _pubOabContadorLinha = 0;

function linhaPublicacaoOab(p) {
  const d = p.dados || {};
  const linhas = [];
  const tr = el("tr", {});
  const idTexto = `pub-oab-texto-${++_pubOabContadorLinha}`;
  const identificacao = d.numeroprocessocommascara || p.numero_processo || p.nome_pesquisado || "publicação";

  const checkbox = el("input", { type: "checkbox", "aria-label": `Selecionar publicação: ${identificacao}` });
  checkbox.checked = _publicacoesOabSelecionadas.has(p.hash);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) _publicacoesOabSelecionadas.add(p.hash);
    else _publicacoesOabSelecionadas.delete(p.hash);
    _atualizarBotoesLotePubOab();
  });
  tr.appendChild(el("td", { "data-label": "Selecionar" }, [checkbox]));

  tr.appendChild(el("td", { "data-label": "Divulgado em" }, [
    el("div", { texto: formatarDataSimples(d.data_disponibilizacao) }),
    el("div", { class: "campo-ajuda", texto: `Capturado em ${formatarData(p.criado_em)}` }),
  ]));
  tr.appendChild(el("td", { "data-label": "Tipo", texto: d.tipoComunicacao || d.tipoDocumento || "-" }));

  const celProcesso = el("td", { "data-label": "Processo" });
  if (p.numero_processo) {
    celProcesso.appendChild(el("div", { texto: d.numeroprocessocommascara || p.numero_processo }));
  } else {
    celProcesso.appendChild(el("div", { texto: "Processo não encontrado" }));
    const linkBusca = el("a", { href: "#", texto: "Iniciar busca de processo" });
    linkBusca.addEventListener("click", (ev) => {
      ev.preventDefault();
      _irParaConsultaProcesso(d.numeroprocessocommascara);
    });
    celProcesso.appendChild(linkBusca);
  }
  if (d.texto) {
    const trTexto = el("tr", {});
    trTexto.hidden = true;
    trTexto.appendChild(el("td", { colspan: "9" }, [el("div", { id: idTexto, class: "pub-oab-texto-expandido", texto: d.texto })]));
    const botaoExpandir = el("button", {
      class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "Ler mais",
      "aria-expanded": "false", "aria-controls": idTexto,
    });
    botaoExpandir.addEventListener("click", () => {
      trTexto.hidden = !trTexto.hidden;
      botaoExpandir.textContent = trTexto.hidden ? "Ler mais" : "Ler menos";
      botaoExpandir.setAttribute("aria-expanded", trTexto.hidden ? "false" : "true");
    });
    celProcesso.appendChild(botaoExpandir);
    linhas.push(tr, trTexto);
  } else {
    linhas.push(tr);
  }
  tr.appendChild(celProcesso);

  tr.appendChild(el("td", { "data-label": "Diário" }, [
    el("div", { texto: d.siglaTribunal || "-" }),
    el("div", { class: "campo-ajuda", texto: d.nomeOrgao || "" }),
  ]));
  const nomesPartes = (d.destinatarios || []).map((dest) => dest.nome).filter(Boolean);
  const celPartes = el("td", { "data-label": "Partes", texto: nomesPartes.length ? nomesPartes.join(", ") : "-" });
  if (nomesPartes.length) celPartes.title = nomesPartes.join(", ");
  tr.appendChild(celPartes);
  tr.appendChild(el("td", { "data-label": "Nome pesquisado", texto: p.nome_pesquisado || "-" }));
  tr.appendChild(el("td", { "data-label": "Status" }, [_badgeStatusPubOab(p.status)]));

  const celAcoes = el("td", { "data-label": "Ações" });
  const acoesLinha = el("div", { class: "pub-oab-acoes-linha" });

  if (d.link) {
    acoesLinha.appendChild(
      el("a", { class: "cds--btn cds--btn--primary cds--btn--sm", href: d.link, target: "_blank", rel: "noopener", texto: "Acessar publicação" })
    );
  }

  if (p.status !== "tratada" && p.numero_processo) {
    const botaoMais = el("button", {
      class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "+",
      title: "Cadastrar como caso", "aria-label": "Cadastrar como caso",
    });
    botaoMais.addEventListener("click", async () => {
      const sugestao = p.nome_pesquisado || "";
      const nome = (window.prompt("Nome do cliente para este caso:", sugestao) || "").trim();
      if (!nome) return;
      botaoMais.disabled = true;
      try {
        await _enviarJson(`/publicacoes-oab/${p.hash}/criar-caso`, { nome_cliente: nome });
        _statusGeralPubOab("Caso cadastrado a partir da publicação.");
        carregarPublicacoesOab();
      } catch (erro) {
        _statusGeralPubOab(erro.message, true);
        botaoMais.disabled = false;
      }
    });
    acoesLinha.appendChild(botaoMais);
  }

  if (p.status !== "tratada") {
    const botaoCheck = el("button", {
      class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "✓",
      title: "Marcar tratada", "aria-label": "Marcar tratada",
    });
    botaoCheck.addEventListener("click", () => _aplicarStatusPubOab([p.hash], "tratada"));
    acoesLinha.appendChild(botaoCheck);
  }

  const menuWrap = el("div", { class: "pub-oab-menu" });
  const botaoMenu = el("button", {
    class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "⋮",
    "aria-label": "Mais ações", "aria-haspopup": "true", "aria-expanded": "false",
  });
  const listaMenu = el("div", { class: "pub-oab-menu-lista" });
  listaMenu.hidden = true;
  if (p.status !== "arquivada") {
    const opcaoArquivar = el("button", { type: "button", texto: "Arquivar" });
    opcaoArquivar.addEventListener("click", () => { listaMenu.hidden = true; botaoMenu.setAttribute("aria-expanded", "false"); _aplicarStatusPubOab([p.hash], "arquivada"); });
    listaMenu.appendChild(opcaoArquivar);
  }
  if (p.status !== "nao_tratada") {
    const opcaoNaoTratada = el("button", { type: "button", texto: "Marcar não tratada" });
    opcaoNaoTratada.addEventListener("click", () => { listaMenu.hidden = true; botaoMenu.setAttribute("aria-expanded", "false"); _aplicarStatusPubOab([p.hash], "nao_tratada"); });
    listaMenu.appendChild(opcaoNaoTratada);
  }
  botaoMenu.addEventListener("click", () => {
    listaMenu.hidden = !listaMenu.hidden;
    botaoMenu.setAttribute("aria-expanded", listaMenu.hidden ? "false" : "true");
  });
  menuWrap.appendChild(botaoMenu);
  menuWrap.appendChild(listaMenu);
  acoesLinha.appendChild(menuWrap);

  celAcoes.appendChild(acoesLinha);
  tr.appendChild(celAcoes);

  return linhas;
}

async function carregarPublicacoesOab() {
  const container = document.getElementById("lista-publicacoes-oab");
  if (!exigirCliente(container)) return;
  limpar(container);
  container.appendChild(el("p", { class: "app-espera" }, ["Carregando…"]));
  const filtroStatus = document.getElementById("pub-oab-filtro-status").value;
  try {
    const url = filtroStatus ? `/publicacoes-oab?status=${encodeURIComponent(filtroStatus)}` : "/publicacoes-oab";
    const { publicacoes, total } = await _buscarJson(url);
    limpar(container);
    container.appendChild(el("div", { id: "pub-oab-status-geral" }));
    if (!(publicacoes || []).length) {
      container.appendChild(notificacao(
        "info", "Nenhuma publicação capturada ainda",
        "Crie um monitoramento por OAB na aba Publicações (DJEN) - a captura roda a cada 24h."
      ));
      return;
    }
    _publicacoesOabSelecionadas.clear();
    _atualizarBotoesLotePubOab();

    const checkboxTodos = el("input", { type: "checkbox", "aria-label": "Selecionar todas as publicações" });
    checkboxTodos.addEventListener("change", () => {
      for (const p of publicacoes) {
        if (checkboxTodos.checked) _publicacoesOabSelecionadas.add(p.hash);
        else _publicacoesOabSelecionadas.delete(p.hash);
      }
      carregarPublicacoesOab();
    });

    const thead = el("thead", {}, [
      el("tr", {}, [
        el("th", {}, [checkboxTodos]),
        el("th", { texto: "Divulgado em" }),
        el("th", { texto: "Tipo" }),
        el("th", { texto: "Processo" }),
        el("th", { texto: "Diário" }),
        el("th", { texto: "Partes" }),
        el("th", { texto: "Nome pesquisado" }),
        el("th", { texto: "Status" }),
        el("th", { texto: "Ações" }),
      ]),
    ]);
    const tbody = el("tbody", {});
    for (const p of publicacoes) {
      for (const linha of linhaPublicacaoOab(p)) tbody.appendChild(linha);
    }
    const resumo = total > publicacoes.length
      ? `Mostrando as ${publicacoes.length} mais recentes de ${total} publicação(ões) — use o filtro de status para refinar.`
      : `Mostrando ${publicacoes.length} publicação(ões)`;
    container.appendChild(el("p", { class: "campo-ajuda", texto: resumo }));
    container.appendChild(el("div", { class: "pub-oab-tabela-wrap" }, [el("table", { class: "pub-oab-tabela" }, [thead, tbody])]));
  } catch (erro) {
    limpar(container);
    mostrarErro(container, erro.message);
  }
}

document.getElementById("pub-oab-filtro-status").addEventListener("change", carregarPublicacoesOab);
document.getElementById("pub-oab-atualizar").addEventListener("click", carregarPublicacoesOab);
document.getElementById("pub-oab-marcar-tratada").addEventListener("click", () => {
  _aplicarStatusPubOab(Array.from(_publicacoesOabSelecionadas), "tratada");
});
document.getElementById("pub-oab-arquivar").addEventListener("click", () => {
  _aplicarStatusPubOab(Array.from(_publicacoesOabSelecionadas), "arquivada");
});

document.getElementById("form-pub-oab-manual").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const status = document.getElementById("pub-oab-manual-status");
  const botao = document.getElementById("pub-oab-manual-botao");
  const corpo = {
    numero_oab: document.getElementById("pub-oab-manual-numero").value.trim(),
    uf_oab: document.getElementById("pub-oab-manual-uf").value.trim(),
    nome: document.getElementById("pub-oab-manual-nome").value.trim(),
    data_inicio: document.getElementById("pub-oab-manual-data-inicio").value,
    data_fim: document.getElementById("pub-oab-manual-data-fim").value,
  };
  botao.disabled = true;
  status.textContent = "Consultando o DJEN…";
  try {
    const resultado = await _enviarJson("/publicacoes-oab/capturar-manual", corpo);
    status.textContent = `Encontradas ${resultado.encontradas}, novas ${resultado.novas}.`;
    carregarPublicacoesOab();
  } catch (erro) {
    status.textContent = erro.message;
  } finally {
    botao.disabled = false;
  }
});
