// Painel web do cnj-processual. Fala o protocolo MCP (Streamable HTTP) direto do navegador,
// usando o token que a própria pessoa cola no topo da página. Sem bibliotecas externas:
// a CSP do servidor só libera scripts de /static.
"use strict";

const URL_MCP = "/mcp";
const CHAVE_TOKEN = "cnj_token";
const CHAVE_HISTORICO = "cnj_historico";
const CHAVE_FAVORITOS = "cnj_favoritos";
const CHAVE_FAVORITOS_CASOS = "cnj_favoritos_casos";
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
    try {
      return JSON.parse(item.text);
    } catch {
      throw new ErroMCP(200, item.text);
    }
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

function mostrarSucesso(container, mensagem) {
  limpar(container);
  container.appendChild(notificacao("success", mensagem));
}

function mostrarAviso(container, mensagem) {
  limpar(container);
  container.appendChild(notificacao("warning", "Atenção", mensagem));
}

function mostrarToast(tipo, titulo, mensagem, duracao = 5000) {
  const container = document.getElementById("toast-global");
  if (!container) { if (tipo === "error") window.alert(mensagem || titulo); return; }
  const ntf = notificacao(tipo, titulo, mensagem || "");
  ntf.style.cssText += ";pointer-events:all;box-shadow:0 2px 6px rgba(0,0,0,.2)";
  const fechar = document.createElement("button");
  fechar.setAttribute("aria-label", "Fechar");
  fechar.setAttribute("type", "button");
  fechar.className = "cds--inline-notification__close-button";
  fechar.innerHTML = "✕";
  fechar.style.cssText = "border:none;background:transparent;cursor:pointer;padding:0.5rem;font-size:1rem;line-height:1;opacity:.7";
  fechar.addEventListener("click", () => ntf.remove());
  ntf.querySelector(".cds--inline-notification__details").after(fechar);
  container.appendChild(ntf);
  setTimeout(() => { if (ntf.parentNode) ntf.remove(); }, duracao);
}

function mostrarEspera(container, botao, titulo) {
  botao.disabled = true;
  limpar(container);
  const inicio = Date.now();
  // O cronômetro fica num span aria-hidden para não re-anunciar a cada segundo em leitores de tela
  const cronometro = el("span", { "aria-hidden": "true" });
  const texto = el("p", { class: "app-espera" }, [
    el("span", { class: "espera-spinner", "aria-hidden": "true" }),
    `${titulo}…`,
    cronometro,
  ]);
  container.appendChild(texto);
  const atualizar = () => {
    const seg = Math.round((Date.now() - inicio) / 1000);
    cronometro.textContent = ` ${seg}s`;
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
  const abaProcesso = abas.find((a) => a.painel.id === "aba-processo");
  if (abaProcesso) selecionarAba(abaProcesso);
});

document.getElementById("esquecer-token").addEventListener("click", () => {
  localStorage.removeItem(CHAVE_TOKEN);
  campoToken.value = "";
  checkboxLembrar.checked = false;
  conectarComToken(null);
});

function exigirCliente(container) {
  if (cliente) return true;
  mostrarErro(container, "Informe o seu token na aba Acesso e clique em Conectar antes de consultar.");
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

function ehCasoFavorito(casoId) {
  return _lerLista(CHAVE_FAVORITOS_CASOS).includes(casoId);
}

function alternarCasoFavorito(casoId) {
  const lista = _lerLista(CHAVE_FAVORITOS_CASOS);
  const index = lista.indexOf(casoId);
  if (index === -1) lista.unshift(casoId);
  else lista.splice(index, 1);
  _salvarLista(CHAVE_FAVORITOS_CASOS, lista);
  return index === -1; // true = acabou de favoritar
}

function _usarItemRapido(item) {
  if (item.tipo === "processo") {
    selecionarAba(abas.find((a) => a.painel.id === "aba-processo"));
    document.getElementById("tribunal").value = item.args.tribunal || "";
    document.getElementById("numero-processo").value = item.args.numero_processo || "";
    formProcesso.requestSubmit();
  } else {
    selecionarAba(abas.find((a) => a.painel.id === "aba-publicacoes"));
    document.getElementById("pub-numero-processo").value = item.args.numero_processo || "";
    document.getElementById("pub-sigla-tribunal").value = item.args.sigla_tribunal || "";
    document.getElementById("pub-numero-oab").value = item.args.numero_oab || "";
    document.getElementById("pub-uf-oab").value = item.args.uf_oab || "";
    formPublicacoes.requestSubmit();
  }
}

async function renderizarCasosFavoritos() {
  const listaCasosFavoritos = document.getElementById("lista-casos-favoritos");
  if (!listaCasosFavoritos) return;
  const idsFavoritos = _lerLista(CHAVE_FAVORITOS_CASOS);
  if (idsFavoritos.length && !_cacheCasos.length && cliente) {
    try {
      const resposta = await _buscarJson("/casos");
      _cacheCasos = resposta.casos || [];
    } catch {
      // segue com o cache vazio - a lista mostra "Nenhum caso favorito ainda" se não achar nada
    }
  }
  limpar(listaCasosFavoritos);
  const casosFavoritos = idsFavoritos.map((id) => _cacheCasos.find((c) => c.id === id)).filter(Boolean);
  if (!casosFavoritos.length) {
    listaCasosFavoritos.appendChild(el("li", { class: "lista-rapida-vazio", texto: "Nenhum caso favorito ainda." }));
    return;
  }
  for (const caso of casosFavoritos) {
    listaCasosFavoritos.appendChild(
      el("li", { class: "lista-rapida-item cds--tile" }, [
        el("span", { texto: caso.titulo || "(sem título)" }),
        el("div", {}, [
          el("button", {
            class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "Abrir",
            onclick: () => {
              selecionarAba(abas.find((a) => a.painel.id === "aba-casos"));
              abrirCaso(caso.id);
            },
          }),
          el("button", {
            class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "Remover",
            onclick: () => { alternarCasoFavorito(caso.id); renderizarCasosFavoritos(); },
          }),
        ]),
      ])
    );
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
  { botao: document.getElementById("aba-acesso-botao"), painel: document.getElementById("aba-acesso") },
  { botao: document.getElementById("aba-processo-botao"), painel: document.getElementById("aba-processo") },
  { botao: document.getElementById("aba-publicacoes-botao"), painel: document.getElementById("aba-publicacoes") },
  { botao: document.getElementById("aba-historico-botao"), painel: document.getElementById("aba-historico") },
  { botao: document.getElementById("aba-monitoramentos-botao"), painel: document.getElementById("aba-monitoramentos") },
  { botao: document.getElementById("aba-jurimetria-botao"), painel: document.getElementById("aba-jurimetria") },
  { botao: document.getElementById("aba-contatos-botao"), painel: document.getElementById("aba-contatos") },
  { botao: document.getElementById("aba-casos-botao"), painel: document.getElementById("aba-casos") },
  { botao: document.getElementById("aba-publicacoes-oab-botao"), painel: document.getElementById("aba-publicacoes-oab") },
];

// Token salvo já conecta sozinho (ver carregarTokenSalvo) - pula a aba Acesso e vai direto pro uso.
if (cliente) {
  const abaProcessoInicial = abas.find((a) => a.painel.id === "aba-processo");
  if (abaProcessoInicial) selecionarAba(abaProcessoInicial);
}

function selecionarAba(alvo) {
  for (const aba of abas) {
    const ativa = aba === alvo;
    aba.botao.setAttribute("aria-selected", String(ativa));
    aba.botao.tabIndex = ativa ? 0 : -1;
    aba.painel.hidden = !ativa;
  }
  // Expande o grupo do item ativo caso esteja colapsado
  const submenu = alvo.botao.closest(".cds--side-nav__item")?.querySelector(".cds--side-nav__submenu");
  if (submenu) submenu.setAttribute("aria-expanded", "true");
  alvo.botao.focus({ preventScroll: true });
  if (alvo.painel.id === "aba-historico") { renderizarListaRapida(); renderizarCasosFavoritos(); }
  if (alvo.painel.id === "aba-monitoramentos") carregarMonitoramentos();
  if (alvo.painel.id === "aba-contatos") { voltarParaContatos(); carregarContatos(); }
  if (alvo.painel.id === "aba-casos") carregarCasosPagina();
  if (alvo.painel.id === "aba-publicacoes-oab") carregarPublicacoesOab();
}

for (const aba of abas) aba.botao.addEventListener("click", () => selecionarAba(aba));

// Roving tabindex: apenas o tab ativo é acessível via Tab; os outros com tabIndex=-1
for (const aba of abas) aba.botao.tabIndex = aba.botao.getAttribute("aria-selected") === "true" ? 0 : -1;

// Navegação por setas na tablist vertical (WAI-ARIA 1.1 §3.3.5)
for (const aba of abas) {
  aba.botao.addEventListener("keydown", (ev) => {
    const idx = abas.indexOf(aba);
    let alvo = null;
    if (ev.key === "ArrowDown") alvo = abas[(idx + 1) % abas.length];
    else if (ev.key === "ArrowUp") alvo = abas[(idx - 1 + abas.length) % abas.length];
    else if (ev.key === "Home") alvo = abas[0];
    else if (ev.key === "End") alvo = abas[abas.length - 1];
    if (alvo) { ev.preventDefault(); selecionarAba(alvo); }
  });
}

// Accordion da Side Nav — toggle de grupo ao clicar no título
document.querySelectorAll(".cds--side-nav__submenu").forEach((btn) => {
  btn.addEventListener("click", () => {
    btn.setAttribute("aria-expanded", String(btn.getAttribute("aria-expanded") !== "true"));
  });
});

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

  const filtros = el("div", { class: "cds--content-switcher cds--content-switcher--light", role: "tablist", "aria-label": "Filtrar por tipo de movimentação" });
  const opcoes = [["todos", "Todos"], ["decisao", "Decisões"], ["peticao", "Petições"], ["tramitacao", "Tramitação"]];
  for (const [valor, rotulo] of opcoes) {
    const botao = el("button", {
      class: valor === "todos" ? "cds--content-switcher-btn cds--content-switcher--selected" : "cds--content-switcher-btn",
      type: "button",
      role: "tab",
      "aria-selected": valor === "todos" ? "true" : "false",
      texto: rotulo,
    });
    botao.addEventListener("click", () => {
      for (const outro of filtros.querySelectorAll("button")) {
        outro.classList.remove("cds--content-switcher--selected");
        outro.setAttribute("aria-selected", "false");
      }
      botao.classList.add("cds--content-switcher--selected");
      botao.setAttribute("aria-selected", "true");
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
      mostrarErro(statusEl, dados.mensagem);
    } else {
      mostrarSucesso(statusEl, "Você será avisado por e-mail quando sair publicação nova.");
    }
  } catch (erro) {
    mostrarErro(statusEl, erro.message);
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

const _cacheFeriados = new Map(); // `${tribunal}|${municipio}|${ano}` -> Map(iso -> descricao)

async function _buscarFeriadosAno(municipio, ano, tribunal = "tjsp") {
  const chave = `${tribunal}|${municipio}|${ano}`;
  if (_cacheFeriados.has(chave)) return _cacheFeriados.get(chave);
  const dados = await cliente.chamarTool("buscar_feriados_forenses", { municipio, ano, tribunal });
  if (dados.erro) throw new Error(dados.mensagem);
  const mapa = new Map((dados.feriados || []).map((f) => [f.data, f.descricao || "Feriado forense"]));
  _cacheFeriados.set(chave, mapa);
  return mapa;
}

async function _uniaoFeriados(municipio, anos, tribunal = "tjsp") {
  const mapas = await Promise.all(anos.map((ano) => _buscarFeriadosAno(municipio, ano, tribunal)));
  const uniao = new Map();
  for (const mapa of mapas) for (const [data, descricao] of mapa) uniao.set(data, descricao);
  return uniao;
}

// Calcula o demonstrativo completo buscando os feriados necessários; se o vencimento cair num ano
// ainda não buscado (prazo longo), busca também esse ano e recalcula.
async function calcularPrazoComFeriados(dataBaseISO, dias, tipo, municipio, tribunal = "tjsp") {
  if (!cliente) throw new Error("Informe o seu token e conecte antes de calcular o prazo.");
  const anoBase = Number(dataBaseISO.slice(0, 4));
  let anos = [anoBase, anoBase + 1];
  let feriados = await _uniaoFeriados(municipio, anos, tribunal);
  let resultado = gerarDemonstrativoPrazo(dataBaseISO, dias, tipo, feriados);
  const anoVencimento = Number(resultado.vencimento.slice(0, 4));
  if (anoVencimento > anoBase + 1) {
    anos = [...anos, anoVencimento];
    feriados = await _uniaoFeriados(municipio, anos, tribunal);
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
    mostrarToast("warning", "Pop-up bloqueado", "Permita pop-ups para este site e tente novamente.");
    return;
  }
  const doc = janela.document;
  const tipoRotulo = (TIPOS_CONTAGEM_PRAZO.find((t) => t.valor === tipo) || {}).rotulo || tipo;

  const estilo = doc.createElement("style");
  estilo.textContent = `
    body { font-family: Arial, Helvetica, sans-serif; color: #161616; margin: 2rem; }
    h1 { font-size: 1.25rem; margin: 0 0 0.25rem; }
    p.base { margin: 0 0 1rem; color: #525252; font-size: 0.8125rem; }
    .legenda { display: flex; flex-wrap: wrap; gap: 0.25rem 1.1rem; margin: 0 0 1rem; font-size: 0.8125rem; }
    .legenda-item { display: inline-flex; align-items: center; gap: 0.35rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
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
    .aviso { margin-top: 1rem; font-size: 0.75rem; color: #525252; }
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
  const tribunal = (item.siglaTribunal || "").toLowerCase() || "tjsp";
  const painel = el("div", { class: "prazo-painel", hidden: "" });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataBase)) {
    painel.appendChild(notificacao("warning", "Atenção", "Publicação sem data de disponibilização - não é possível calcular o prazo."));
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

  const fonteFeriados = tribunal === "tjsp" ? "feriados forenses do TJSP (fonte oficial)" : `feriados nacionais + estaduais calculados para ${tribunal.toUpperCase()}`;
  painel.appendChild(
    el("p", { class: "campo-ajuda", texto: `Base: disponibilizado em ${formatarDataSimples(dataBase)}. A contagem exclui sábados, domingos e ${fonteFeriados}.` })
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
      mostrarAviso(resultadoEl, "Informe um número de dias válido.");
      return;
    }
    const municipio = campoMunicipio.value.trim() || "São Paulo";
    localStorage.setItem(CHAVE_PRAZO_MUNICIPIO, municipio);
    const textoOriginal = botaoCalcular.textContent;
    botaoCalcular.disabled = true;
    botaoCalcular.textContent = "Calculando…";
    try {
      const tipo = campoTipo.value;
      const { dia1, vencimento, linhas } = await calcularPrazoComFeriados(dataBase, dias, tipo, municipio, tribunal);
      resultadoEl.appendChild(
        notificacao(
          "success",
          `Vencimento: ${formatarDataSimples(vencimento)}`,
          `Início da contagem (dia 1): ${formatarDataSimples(dia1)} · ${dias} dia(s) úteis em ${municipio} (${tribunal.toUpperCase()})`
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
      mostrarErro(resultadoEl, erro.message);
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
      hashPublicacao: item.hash || null,
      dadosPublicacao: item,
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
      mostrarErro(statusEl, dados.mensagem);
      return;
    }
    if (dados.link_download) {
      window.open(dados.link_download, "_blank", "noopener,noreferrer");
      mostrarSucesso(statusEl, `Link aberto. Válido por ${dados.validade_link || "15 minutos"}.`);
    } else {
      mostrarAviso(statusEl, dados.aviso || "Não foi possível gerar o link.");
    }
  } catch (erro) {
    mostrarErro(statusEl, erro.message);
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
    if (!(await confirmarAcao("Remover monitoramento? O escritório deixará de receber alertas por e-mail para este processo. Esta ação não pode ser desfeita.", { titulo: "Remover monitoramento", textoConfirmar: "Remover" }))) return;
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

async function _enviarJson(url, corpo, metodo = "POST") {
  if (!cliente) throw new ErroMCP(401, "Conecte-se primeiro.");
  const resposta = await fetch(url, {
    method: metodo,
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

// --- Modais Carbon -----------------------------------------------------------------------

function abrirModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add("is-visible");
  const primeiro = modal.querySelector("input, select, textarea, button:not(.cds--modal-close)");
  if (primeiro) primeiro.focus();
}

function fecharModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove("is-visible");
}

document.addEventListener("click", (ev) => {
  const alvo = ev.target.closest("[data-fechar-modal]");
  if (alvo) fecharModal(alvo.dataset.fecharModal);
});

document.querySelectorAll(".cds--modal").forEach((modal) => {
  modal.addEventListener("click", (ev) => { if (ev.target === modal) fecharModal(modal.id); });
  modal.addEventListener("keydown", (ev) => { if (ev.key === "Escape") fecharModal(modal.id); });
});

// Substitui window.confirm() por um modal Carbon: devolve uma Promise<boolean> (true = confirmou).
function confirmarAcao(mensagem, opcoes = {}) {
  const { titulo = "Confirmar ação", textoConfirmar = "Confirmar" } = opcoes;
  return new Promise((resolve) => {
    const modal = document.getElementById("modal-confirmar");
    const botaoOk = document.getElementById("modal-confirmar-ok");
    const botaoCancelar = document.getElementById("modal-confirmar-cancelar");
    const botaoFechar = document.getElementById("modal-confirmar-fechar");
    let resolvido = false;

    function limparListeners() {
      botaoOk.removeEventListener("click", aoConfirmar);
      botaoCancelar.removeEventListener("click", aoCancelar);
      botaoFechar.removeEventListener("click", aoCancelar);
      modal.removeEventListener("keydown", aoTeclado);
      modal.removeEventListener("click", aoClicarFundo);
    }
    function concluir(valor) {
      if (resolvido) return;
      resolvido = true;
      limparListeners();
      fecharModal("modal-confirmar");
      resolve(valor);
    }
    const aoConfirmar = () => concluir(true);
    const aoCancelar = () => concluir(false);
    const aoTeclado = (ev) => { if (ev.key === "Escape") concluir(false); };
    const aoClicarFundo = (ev) => { if (ev.target === modal) concluir(false); };

    document.getElementById("modal-confirmar-titulo").textContent = titulo;
    const corpo = document.getElementById("modal-confirmar-corpo");
    limpar(corpo);
    corpo.appendChild(el("p", { texto: mensagem }));
    botaoOk.textContent = textoConfirmar;

    botaoOk.addEventListener("click", aoConfirmar);
    botaoCancelar.addEventListener("click", aoCancelar);
    botaoFechar.addEventListener("click", aoCancelar);
    modal.addEventListener("keydown", aoTeclado);
    modal.addEventListener("click", aoClicarFundo);

    abrirModal("modal-confirmar");
  });
}

// ComboButton das linhas de Publicações por OAB: fecha o menu aberto ao clicar fora ou Esc.
function _fecharTodosComboMenusOab() {
  document.querySelectorAll(".pub-oab-combo-menu:not([hidden])").forEach((menu) => {
    menu.hidden = true;
    menu.classList.remove("cds--menu--open", "cds--menu--shown");
    const trigger = menu.closest(".pub-oab-combo")?.querySelector(".cds--menu-button__trigger");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  });
}
document.addEventListener("click", (ev) => {
  if (!ev.target.closest(".pub-oab-combo")) _fecharTodosComboMenusOab();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") _fecharTodosComboMenusOab();
});

// --- Clientes e casos (Fase 1 da gestão de escritório) ------------------------------------
//
// /clientes e /casos são endpoints HTTP simples (não tools MCP, mesmo padrão das árvores do
// CJPG acima): CRUD de apoio ao painel, não faz sentido expor isso a um agente de IA.

let _cacheClientes = [];
let _cacheCasos = [];
let _filtroCasos = "";

function _iconePessoa() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  const caminho = document.createElementNS(ns, "path");
  caminho.setAttribute("d", "M16 17c3.9 0 7-3.1 7-7s-3.1-7-7-7-7 3.1-7 7 3.1 7 7 7zm0 3c-5.3 0-16 2.7-16 8v3h32v-3c0-5.3-10.7-8-16-8z");
  svg.appendChild(caminho);
  return svg;
}

function linhaContato(c) {
  const tr = el("tr", {});
  const checkbox = el("input", { type: "checkbox", "aria-label": `Selecionar ${c.nome}` });
  tr.appendChild(el("td", { "data-label": "Selecionar" }, [checkbox]));
  tr.appendChild(el("td", { "data-label": "Tipo" }, [_iconePessoa()]));

  const botaoNome = el("button", { class: "contato-nome-link", type: "button", texto: c.nome });
  botaoNome.addEventListener("click", () => abrirContato(c.id));
  tr.appendChild(el("td", { "data-label": "Nome" }, [botaoNome]));

  tr.appendChild(el("td", { "data-label": "Telefone" }, [
    c.telefone ? el("span", { texto: c.telefone }) : el("span", { class: "contato-sem-dado", texto: "Nenhum telefone" }),
  ]));
  tr.appendChild(el("td", { "data-label": "E-mail" }, [
    c.email ? el("span", { texto: c.email }) : el("span", { class: "contato-sem-dado", texto: "Nenhum email" }),
  ]));
  tr.appendChild(el("td", { "data-label": "Etiquetas" }));

  const botaoExcluir = el("button", {
    class: "cds--btn cds--btn--danger--tertiary cds--btn--sm", type: "button", texto: "Excluir",
  });
  botaoExcluir.addEventListener("click", () => excluirContato(c.id, c.nome, botaoExcluir));
  tr.appendChild(el("td", { "data-label": "Ações" }, [botaoExcluir]));
  return tr;
}

async function excluirContato(clienteId, nome, botao) {
  if (!(await confirmarAcao(`Excluir o cliente "${nome}"? Essa ação não pode ser desfeita.`))) return;
  botao.disabled = true;
  try {
    await _enviarJson(`/clientes/${clienteId}`, {}, "DELETE");
    _cacheClientes = _cacheClientes.filter((c) => c.id !== clienteId);
    renderizarListaContatos();
  } catch (erro) {
    mostrarToast("error", "Erro", erro.message);
    botao.disabled = false;
  }
}

function tabelaContatos(contatos) {
  const thead = el("thead", {}, [
    el("tr", {}, [
      el("th", {}),
      el("th", { texto: "Tipo" }),
      el("th", { texto: "Nome" }),
      el("th", { texto: "Telefone" }),
      el("th", { texto: "E-mail" }),
      el("th", { texto: "Etiquetas" }),
      el("th", { texto: "Ações" }),
    ]),
  ]);
  const tbody = el("tbody", {});
  for (const c of contatos) tbody.appendChild(linhaContato(c));
  return el("div", { class: "tabela-responsiva-wrap" }, [el("table", { class: "tabela-responsiva contatos-tabela" }, [thead, tbody])]);
}

let _contatosFiltroLetra = "TODOS";
let _contatosFiltroBusca = "";

function _contatosFiltrados() {
  return _cacheClientes.filter((c) => {
    if (_contatosFiltroLetra !== "TODOS") {
      const inicial = (c.nome || "").trim().charAt(0).toUpperCase();
      if (inicial !== _contatosFiltroLetra) return false;
    }
    if (_contatosFiltroBusca) {
      const alvo = `${c.nome || ""} ${c.telefone || ""} ${c.email || ""}`.toLowerCase();
      if (!alvo.includes(_contatosFiltroBusca.toLowerCase())) return false;
    }
    return true;
  });
}

function renderizarListaContatos() {
  const listaContatosEl = document.getElementById("lista-contatos");
  limpar(listaContatosEl);
  if (!_cacheClientes.length) {
    listaContatosEl.appendChild(notificacao("info", "Nenhum cliente cadastrado ainda"));
    return;
  }
  const filtrados = _contatosFiltrados();
  if (!filtrados.length) {
    listaContatosEl.appendChild(notificacao("info", "Nenhum cliente encontrado com esse filtro"));
    return;
  }
  listaContatosEl.appendChild(el("p", { class: "campo-ajuda", texto: `Mostrando ${filtrados.length} de ${_cacheClientes.length} cliente(s)` }));
  listaContatosEl.appendChild(tabelaContatos(filtrados));
}

function _construirBarraAZ() {
  const container = document.getElementById("contatos-az");
  if (container.childElementCount) return; // já construída
  const letras = ["TODOS", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")];
  for (const letra of letras) {
    const botao = el("button", { type: "button", texto: letra, "aria-pressed": String(letra === _contatosFiltroLetra) });
    botao.addEventListener("click", () => {
      _contatosFiltroLetra = letra;
      for (const filho of container.children) filho.setAttribute("aria-pressed", String(filho.textContent === letra));
      renderizarListaContatos();
    });
    container.appendChild(botao);
  }
}

async function abrirContato(clienteId) {
  document.getElementById("contatos-vista-lista").hidden = true;
  document.getElementById("contatos-vista-detalhe").hidden = false;
  document.getElementById("contato-detalhe-nome").textContent = "Carregando…";
  _selecionarSubabaContato("cadastro");
  const resultadoContatoCadastro = document.getElementById("resultado-contato-cadastro");
  limpar(resultadoContatoCadastro);
  try {
    const cliente_registro = await _buscarJson(`/clientes/${clienteId}`);
    document.getElementById("contato-detalhe-nome").textContent = cliente_registro.nome || "(sem nome)";
    document.getElementById("contato-nome").value = cliente_registro.nome || "";
    document.getElementById("contato-cpf-cnpj").value = cliente_registro.cpf_cnpj || "";
    document.getElementById("contato-telefone").value = cliente_registro.telefone || "";
    document.getElementById("contato-email").value = cliente_registro.email || "";
    document.getElementById("contato-observacoes").value = cliente_registro.observacoes || "";
    formContatoCadastro.dataset.clienteId = clienteId;
    await _renderizarProcessosVinculados(clienteId);
  } catch (erro) {
    document.getElementById("contato-detalhe-nome").textContent = "Erro ao carregar cliente";
    mostrarErro(resultadoContatoCadastro, erro.message);
  }
}

function voltarParaContatos() {
  document.getElementById("contatos-vista-detalhe").hidden = true;
  document.getElementById("contatos-vista-lista").hidden = false;
  renderizarListaContatos();
}

function _selecionarSubabaContato(nome) {
  const ativarCadastro = nome === "cadastro";
  document.getElementById("contato-subaba-cadastro-botao").setAttribute("aria-selected", String(ativarCadastro));
  document.getElementById("contato-subaba-processos-botao").setAttribute("aria-selected", String(!ativarCadastro));
  document.getElementById("contato-subaba-cadastro").hidden = !ativarCadastro;
  document.getElementById("contato-subaba-processos").hidden = ativarCadastro;
}

function _renderizarCasosVinculadosNoContainer(container, clienteId) {
  limpar(container);
  const vinculados = _cacheCasos.filter(
    (caso) => caso.cliente_id === clienteId || (caso.clientes_adicionais || []).includes(clienteId)
  );
  if (!vinculados.length) {
    container.appendChild(notificacao("info", "Nenhum processo vinculado a este cliente ainda"));
    return;
  }
  container.appendChild(tabelaCasos(vinculados, () => _renderizarCasosVinculadosNoContainer(container, clienteId)));
}

async function _renderizarProcessosVinculados(clienteId) {
  const container = document.getElementById("contato-processos-vinculados");
  limpar(container);
  container.appendChild(el("p", { class: "app-espera" }, ["Carregando…"]));
  try {
    const { casos } = await _buscarJson("/casos");
    _cacheCasos = casos || [];
    _renderizarCasosVinculadosNoContainer(container, clienteId);
  } catch (erro) {
    limpar(container);
    mostrarErro(container, erro.message);
  }
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

function linhaCaso(caso, aoExcluir) {
  const nomeCliente = (id) => (_cacheClientes.find((c) => c.id === id) || {}).nome || id;
  const nomesClientes = [caso.cliente_id, ...(caso.clientes_adicionais || [])].map(nomeCliente);
  const tr = el("tr", {});

  const favoritado = ehCasoFavorito(caso.id);
  const botaoFavorito = el("button", {
    class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button",
    texto: favoritado ? "★" : "☆", "aria-label": favoritado ? "Remover dos favoritos" : "Adicionar aos favoritos",
  });
  botaoFavorito.addEventListener("click", () => {
    const ficouFavorito = alternarCasoFavorito(caso.id);
    botaoFavorito.textContent = ficouFavorito ? "★" : "☆";
    botaoFavorito.setAttribute("aria-label", ficouFavorito ? "Remover dos favoritos" : "Adicionar aos favoritos");
    renderizarCasosFavoritos();
  });
  tr.appendChild(el("td", { "data-label": "Favorito" }, [botaoFavorito]));

  const celTitulo = el("td", { "data-label": "Título" });
  const linhaTitulo = el("div", { class: "caso-titulo-linha" }, [
    el("span", { texto: caso.titulo || "(sem título)" }),
  ]);
  if (caso.monitorado) {
    linhaTitulo.appendChild(el("span", { class: "cds--tag cds--tag--green cds--tag--sm", texto: "Monitorado" }));
  }
  if (caso.desfecho && _ROTULO_DESFECHO_CASO[caso.desfecho]) {
    linhaTitulo.appendChild(el("span", { class: "cds--tag cds--tag--purple cds--tag--sm", texto: _ROTULO_DESFECHO_CASO[caso.desfecho] }));
  }
  celTitulo.appendChild(linhaTitulo);

  const processos = caso.processos || [];
  const subtitulo = el("div", { class: "campo-ajuda" }, [
    `${caso.status === "ativo" ? "Processo ativo" : caso.status}${processos.length ? " · " : ""}`,
  ]);
  processos.forEach((numero, indice) => {
    if (indice > 0) subtitulo.appendChild(document.createTextNode(", "));
    const linkProcesso = el("a", { href: "#", texto: numero });
    linkProcesso.addEventListener("click", (ev) => {
      ev.preventDefault();
      _irParaConsultaProcesso(numero);
    });
    subtitulo.appendChild(linkProcesso);
  });
  celTitulo.appendChild(subtitulo);

  const botaoTimeline = el("button", {
    class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "Ver linha do tempo",
    "aria-expanded": "false",
  });
  const trTimeline = el("tr", {});
  trTimeline.hidden = true;
  const celTimeline = el("td", { colspan: "6" }, [el("div", { class: "linha-tempo-area" })]);
  trTimeline.appendChild(celTimeline);
  botaoTimeline.addEventListener("click", async () => {
    const abrindo = trTimeline.hidden;
    trTimeline.hidden = !abrindo;
    botaoTimeline.setAttribute("aria-expanded", trTimeline.hidden ? "false" : "true");
    botaoTimeline.textContent = trTimeline.hidden ? "Ver linha do tempo" : "Ocultar linha do tempo";
    const areaTimeline = celTimeline.firstChild;
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
  celTitulo.appendChild(botaoTimeline);
  tr.appendChild(celTitulo);

  const celCliente = el("td", { "data-label": "Cliente/Pasta" }, [el("div", { texto: nomesClientes.join(", ") })]);
  if (caso.drive_pasta_id) {
    const linkDrive = el("a", {
      href: `https://drive.google.com/drive/folders/${caso.drive_pasta_id}`, target: "_blank", rel: "noopener",
      texto: "Abrir pasta",
    });
    celCliente.appendChild(el("div", {}, [linkDrive]));
  }
  tr.appendChild(celCliente);

  const containerAcao = el("div", { style: "display:flex; flex-wrap:wrap; gap:4px" });
  const pedacosAcao = (caso.acao || "").split(" - ").map((pedaco) => pedaco.trim()).filter(Boolean);
  if (pedacosAcao.length === 0) {
    containerAcao.appendChild(el("span", { class: "cds--tag cds--tag--blue cds--tag--sm", texto: "-" }));
  } else {
    pedacosAcao.forEach((pedaco, indice) => {
      containerAcao.appendChild(el("span", {
        class: indice === 0 ? "cds--tag cds--tag--blue cds--tag--sm" : "cds--tag cds--tag--teal cds--tag--sm",
        texto: pedaco,
      }));
    });
  }
  const celAcaoForo = el("td", { "data-label": "Ação/Foro" }, [containerAcao]);
  if (caso.foro) celAcaoForo.appendChild(el("span", { class: "cds--tag cds--tag--gray cds--tag--sm", texto: caso.foro }));
  tr.appendChild(celAcaoForo);

  tr.appendChild(el("td", { "data-label": "Últ. mov.", texto: formatarDataSimples(caso.ultima_movimentacao) }));

  const botaoAbrirCaso = el("button", {
    class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "Abrir",
  });
  botaoAbrirCaso.addEventListener("click", () => abrirCaso(caso.id));
  const botaoExcluirCaso = el("button", {
    class: "cds--btn cds--btn--danger--tertiary cds--btn--sm", type: "button", texto: "Excluir",
  });
  botaoExcluirCaso.addEventListener("click", () => excluirCaso(caso.id, caso.titulo, botaoExcluirCaso, aoExcluir));
  tr.appendChild(el("td", { "data-label": "Ações" }, [botaoAbrirCaso, botaoExcluirCaso]));

  return [tr, trTimeline];
}

async function excluirCaso(casoId, titulo, botao, aoExcluir) {
  if (!(await confirmarAcao(`Excluir o caso "${titulo || "(sem título)"}"? Essa ação não pode ser desfeita.`))) return;
  botao.disabled = true;
  try {
    await _enviarJson(`/casos/${casoId}`, {}, "DELETE");
    _cacheCasos = _cacheCasos.filter((c) => c.id !== casoId);
    if (aoExcluir) aoExcluir();
  } catch (erro) {
    mostrarToast("error", "Erro", erro.message);
    botao.disabled = false;
  }
}

function tabelaCasos(casos, aoExcluir) {
  const ordenados = [...casos].sort((a, b) => (b.ultima_movimentacao || "").localeCompare(a.ultima_movimentacao || ""));
  const thead = el("thead", {}, [
    el("tr", {}, [
      el("th", { texto: "Favorito" }),
      el("th", { texto: "Título" }),
      el("th", { texto: "Cliente/Pasta" }),
      el("th", { texto: "Ação/Foro" }),
      el("th", { texto: "Últ. mov." }),
      el("th", { texto: "Ações" }),
    ]),
  ]);
  const tbody = el("tbody", {});
  for (const caso of ordenados) {
    for (const linha of linhaCaso(caso, aoExcluir)) tbody.appendChild(linha);
  }
  return el("div", { class: "tabela-responsiva-wrap" }, [el("table", { class: "tabela-responsiva tabela-casos" }, [thead, tbody])]);
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
    carregarCasosPagina();
  }, { hashPublicacao: d.hash || null, dadosPublicacao: d });
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

async function carregarContatos() {
  const listaContatosEl = document.getElementById("lista-contatos");
  if (!exigirCliente(listaContatosEl)) return;
  _construirBarraAZ();
  limpar(listaContatosEl);
  listaContatosEl.appendChild(el("p", { class: "app-espera" }, ["Carregando…"]));
  try {
    const { clientes } = await _buscarJson("/clientes");
    _cacheClientes = clientes || [];
    renderizarListaContatos();
  } catch (erro) {
    limpar(listaContatosEl);
    mostrarErro(listaContatosEl, erro.message);
  }
}

async function carregarCasosPagina() {
  const listaCasosEl = document.getElementById("lista-casos");
  if (!exigirCliente(listaCasosEl)) return;
  limpar(listaCasosEl);
  carregarPendentes();
  try {
    const [{ clientes }, { casos }] = await Promise.all([_buscarJson("/clientes"), _buscarJson("/casos")]);
    _cacheClientes = clientes || [];
    _cacheCasos = casos || [];
    _renderizarTabelaCasosPagina();
  } catch (erro) {
    mostrarErro(listaCasosEl, erro.message);
  }
}

function _renderizarTabelaCasosPagina() {
  const listaCasosEl = document.getElementById("lista-casos");
  limpar(listaCasosEl);
  const nomeCliente = (id) => (_cacheClientes.find((c) => c.id === id) || {}).nome || "";
  const termo = _filtroCasos.toLowerCase().trim();
  const filtrados = termo
    ? _cacheCasos.filter((c) => {
        const textos = [
          c.titulo, c.acao, c.foro, c.responsavel,
          nomeCliente(c.cliente_id),
          ...(c.clientes_adicionais || []).map(nomeCliente),
          ...(c.processos || []),
        ].map((t) => (t || "").toLowerCase());
        return textos.some((t) => t.includes(termo));
      })
    : _cacheCasos;
  if (!filtrados.length) {
    listaCasosEl.appendChild(notificacao("info", termo ? "Nenhum caso corresponde ao filtro." : "Nenhum caso cadastrado ainda"));
  } else {
    listaCasosEl.appendChild(tabelaCasos(filtrados, _renderizarTabelaCasosPagina));
  }
  renderizarCasosFavoritos();
}

const formCliente = document.getElementById("form-cliente");
const resultadoCliente = document.getElementById("resultado-cliente");

formCliente.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!exigirCliente(resultadoCliente)) return;
  const botao = document.querySelector("button[form='form-cliente'][type='submit']");
  const dados = Object.fromEntries(new FormData(formCliente).entries());
  const pararEspera = mostrarEspera(resultadoCliente, botao, "Cadastrando cliente");
  try {
    await _enviarJson("/clientes", dados);
    fecharModal("modal-novo-contato");
    formCliente.reset();
    limpar(resultadoCliente);
    carregarContatos();
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
  const clienteId = document.getElementById("caso-cliente").value;
  if (!clienteId) {
    mostrarErro(resultadoCaso, "Selecione um cliente.");
    document.getElementById("caso-cliente-busca").focus();
    return;
  }
  const botao = document.querySelector("button[form='form-caso'][type='submit']");
  const numeros = document.getElementById("caso-processos").value.split(",").map((s) => s.trim()).filter(Boolean);
  const corpo = {
    cliente_id: clienteId,
    titulo: document.getElementById("caso-titulo").value.trim(),
    responsavel: document.getElementById("caso-responsavel").value.trim(),
    acao: document.getElementById("caso-acao").value.trim(),
    foro: document.getElementById("caso-foro").value.trim(),
    numeros_processo: numeros,
  };
  const pararEspera = mostrarEspera(resultadoCaso, botao, "Cadastrando caso");
  try {
    const novoCaso = await _enviarJson("/casos", corpo);
    formCaso.reset();
    document.getElementById("caso-cliente-busca").value = "";
    document.getElementById("caso-cliente").value = "";
    _cacheCasos = [..._cacheCasos, novoCaso];
    _renderizarTabelaCasosPagina();
    limpar(resultadoCaso);
    const divSucesso = el("div", {});
    divSucesso.appendChild(notificacao("success", `Caso "${novoCaso.titulo || "sem título"}" cadastrado.`));
    const btnAbrirCaso = el("button", {
      class: "cds--btn cds--btn--primary cds--btn--sm",
      type: "button",
      style: "margin-top: 0.75rem; display: block;",
      texto: "Abrir caso criado",
    });
    btnAbrirCaso.addEventListener("click", () => {
      fecharModal("modal-novo-caso");
      selecionarAba(abas.find((a) => a.painel.id === "aba-casos"));
      abrirCaso(novoCaso.id);
    });
    divSucesso.appendChild(btnAbrirCaso);
    resultadoCaso.appendChild(divSucesso);
  } catch (erro) {
    mostrarErro(resultadoCaso, erro.message);
  } finally {
    pararEspera();
  }
});

document.getElementById("btn-novo-contato").addEventListener("click", () => abrirModal("modal-novo-contato"));
document.getElementById("modal-novo-contato-fechar").addEventListener("click", () => fecharModal("modal-novo-contato"));
document.getElementById("btn-novo-caso").addEventListener("click", async () => {
  if (!_cacheClientes.length) {
    try { const { clientes } = await _buscarJson("/clientes"); _cacheClientes = clientes || []; } catch { /* segue */ }
  }
  abrirModal("modal-novo-caso");
});
document.getElementById("modal-novo-caso-fechar").addEventListener("click", () => fecharModal("modal-novo-caso"));
document.getElementById("modal-cadastrar-caso-publicacao-fechar").addEventListener("click", () => fecharModal("modal-cadastrar-caso-publicacao"));

// Filtro de texto ao vivo na lista de casos
document.getElementById("casos-busca").addEventListener("input", function () {
  _filtroCasos = this.value;
  _renderizarTabelaCasosPagina();
});

// Typeahead: campo de busca de cliente no form-caso
(function () {
  const busca = document.getElementById("caso-cliente-busca");
  const hidden = document.getElementById("caso-cliente");
  const lista = document.getElementById("caso-cliente-sugestoes");

  function mostrarSugestoes(termo) {
    limpar(lista);
    const filtrados = _cacheClientes.filter((c) => c.nome.toLowerCase().includes(termo.toLowerCase()));
    if (!filtrados.length) { lista.hidden = true; return; }
    filtrados.slice(0, 10).forEach((c) => {
      const btn = el("button", { type: "button", texto: c.nome });
      btn.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        busca.value = c.nome;
        hidden.value = c.id;
        lista.hidden = true;
      });
      lista.appendChild(btn);
    });
    lista.hidden = false;
  }

  busca.addEventListener("input", () => {
    hidden.value = "";
    mostrarSugestoes(busca.value);
  });
  busca.addEventListener("focus", () => { if (busca.value) mostrarSugestoes(busca.value); });
  busca.addEventListener("blur", () => { setTimeout(() => { lista.hidden = true; }, 150); });
  busca.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { lista.hidden = true; }
    if (ev.key === "ArrowDown") {
      const primeiro = lista.querySelector("button");
      if (primeiro) { ev.preventDefault(); primeiro.focus(); }
    }
  });
  lista.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") { const next = document.activeElement.nextElementSibling; if (next) next.focus(); }
    if (ev.key === "ArrowUp") {
      const prev = document.activeElement.previousElementSibling;
      if (prev) prev.focus(); else busca.focus();
    }
  });
})();

document.getElementById("contato-voltar").addEventListener("click", voltarParaContatos);
document.getElementById("contato-subaba-cadastro-botao").addEventListener("click", () => _selecionarSubabaContato("cadastro"));
document.getElementById("contato-subaba-processos-botao").addEventListener("click", () => _selecionarSubabaContato("processos"));
document.getElementById("contatos-busca").addEventListener("input", (evento) => {
  _contatosFiltroBusca = evento.target.value;
  if (!_contatosFiltroBusca && _contatosFiltroLetra !== "TODOS") {
    _contatosFiltroLetra = "TODOS";
    const container = document.getElementById("contatos-az");
    for (const filho of container.children) filho.setAttribute("aria-pressed", String(filho.textContent === "TODOS"));
  }
  renderizarListaContatos();
});

document.getElementById("casos-busca").addEventListener("input", (evento) => {
  _filtroCasos = evento.target.value;
  _renderizarTabelaCasosPagina();
});

const formContatoCadastro = document.getElementById("form-contato-cadastro");
const resultadoContatoCadastro = document.getElementById("resultado-contato-cadastro");

formContatoCadastro.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const clienteId = formContatoCadastro.dataset.clienteId;
  if (!clienteId) return;
  const botao = formContatoCadastro.querySelector("button[type=submit]");
  const corpo = {
    nome: document.getElementById("contato-nome").value.trim(),
    cpf_cnpj: document.getElementById("contato-cpf-cnpj").value.trim(),
    telefone: document.getElementById("contato-telefone").value.trim(),
    email: document.getElementById("contato-email").value.trim(),
    observacoes: document.getElementById("contato-observacoes").value.trim(),
  };
  const pararEspera = mostrarEspera(resultadoContatoCadastro, botao, "Salvando");
  try {
    const atualizado = await _enviarJson(`/clientes/${clienteId}`, corpo, "PATCH");
    limpar(resultadoContatoCadastro);
    resultadoContatoCadastro.appendChild(notificacao("success", "Cliente atualizado"));
    document.getElementById("contato-detalhe-nome").textContent = atualizado.nome;
    const indice = _cacheClientes.findIndex((c) => c.id === clienteId);
    if (indice !== -1) _cacheClientes[indice] = atualizado;
  } catch (erro) {
    mostrarErro(resultadoContatoCadastro, erro.message);
  } finally {
    pararEspera();
  }
});

document.getElementById("contato-excluir").addEventListener("click", async () => {
  const clienteId = formContatoCadastro.dataset.clienteId;
  if (!clienteId) return;
  const nome = document.getElementById("contato-nome").value.trim() || "este cliente";
  if (!(await confirmarAcao(`Excluir o cliente "${nome}"? Essa ação não pode ser desfeita.`))) return;
  const botao = document.getElementById("contato-excluir");
  botao.disabled = true;
  try {
    await _enviarJson(`/clientes/${clienteId}`, {}, "DELETE");
    _cacheClientes = _cacheClientes.filter((c) => c.id !== clienteId);
    voltarParaContatos();
  } catch (erro) {
    mostrarErro(resultadoContatoCadastro, erro.message);
    botao.disabled = false;
  }
});

// Botão "Cadastrar como caso" no resultado da consulta de processo (DataJud): abre um mini
// formulário inline, sem precisar trocar de aba. Cria o cliente na hora se for novo (Fase 1).
function anexarBotaoCadastrarCaso(acoes, numeroProcesso, aoSalvar, opcoes = {}) {
  const { rotulo, tituloModal, nomeSugerido, tituloSugerido, partes, tribunal, hashPublicacao, dadosPublicacao, classeBotao } = opcoes;
  const botao = el("button", {
    class: classeBotao || "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: rotulo || "Cadastrar como caso",
  });
  acoes.appendChild(botao);

  botao.addEventListener("click", async () => {
    if (!_cacheClientes.length) {
      try {
        const { clientes } = await _buscarJson("/clientes");
        _cacheClientes = clientes || [];
      } catch {
        // segue mesmo sem conseguir pré-carregar: o select só vai ficar com "Novo cliente"
      }
    }

    const usaCheckboxesPartes = Boolean(partes && partes.length);

    const selectCliente = el("select", { class: "cds--select-input" }, [
      el("option", { value: "" }, ["+ Novo cliente"]),
      ..._cacheClientes.map((c) => el("option", { value: c.id }, [c.nome])),
    ]);
    const campoNomeNovo = el("input", {
      class: "cds--text-input",
      placeholder: usaCheckboxesPartes ? "+ outro cliente (opcional)" : "Nome do novo cliente",
      value: usaCheckboxesPartes ? "" : (nomeSugerido || ""),
    });
    const campoTitulo = el("input", { class: "cds--text-input", placeholder: "Título do caso (opcional)", value: tituloSugerido || "" });
    const campoAcao = el("input", { class: "cds--text-input", placeholder: "Ação (opcional)" });
    const campoForo = el("input", { class: "cds--text-input", placeholder: "Foro (opcional)" });
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
        limpar(statusDataJud);
        statusDataJud.appendChild(notificacao("info", "Consultando DataJud…", "Pode levar até 2min, aguarde."));
        try {
          const dados = await cliente.chamarTool("consultar_processo_datajud", { tribunal, numero_processo: numeroProcesso });
          if (dados.erro) throw new ErroMCP(200, dados.mensagem || "Falha ao consultar o DataJud.");
          const proc = (dados.processos || [])[0];
          if (!proc) throw new ErroMCP(200, dados.mensagem || "Processo não encontrado no DataJud.");
          if (proc.classe) {
            const partes = [proc.classe, ...(proc.assuntos || [])].filter(Boolean);
            campoAcao.value = partes.join(" - ");
          }
          if (proc.orgaoJulgador) campoForo.value = proc.orgaoJulgador;
          mostrarSucesso(statusDataJud, "Ação/foro preenchidos.");
          botaoDataJud.textContent = "Atualizar classe/órgão do DataJud";
        } catch (erro) {
          mostrarErro(statusDataJud, erro.message || "Falha ao consultar o DataJud (sem detalhes do servidor).");
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
          acao: campoAcao.value.trim() || null,
          foro: campoForo.value.trim() || null,
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
        const casoCriado = await _enviarJson("/casos", corpo);
        let publicacaoVinculada = false;
        if (hashPublicacao) {
          try {
            await _enviarJson(`/casos/${casoCriado.id}/publicacoes`, {
              hash: hashPublicacao,
              numero_processo: numeroProcesso || null,
              dados: dadosPublicacao || null,
            });
            publicacaoVinculada = true;
          } catch (erroVinculo) {
            mostrarToast("warning", "Caso criado", `Caso cadastrado, mas não foi possível vincular a publicação: ${erroVinculo.message}`);
          }
        }
        fecharModal("modal-cadastrar-caso-publicacao");
        mostrarToast("success", "Caso cadastrado", publicacaoVinculada ? "Caso criado e publicação vinculada." : "Caso criado.");
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
      el("div", { class: "cds--form-item" }, [campoAcao]),
      el("div", { class: "cds--form-item" }, [campoForo]),
      botaoDataJud,
      statusDataJud,
      botaoSalvar,
      statusMini,
    ]);
    const corpoModal = document.getElementById("modal-cadastrar-caso-publicacao-corpo");
    limpar(corpoModal);
    document.getElementById("modal-cadastrar-caso-publicacao-titulo").textContent = tituloModal || rotulo || "Cadastrar como caso";
    corpoModal.appendChild(miniForm);
    abrirModal("modal-cadastrar-caso-publicacao");
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
  const campTribunal = document.getElementById("tribunal");
  if (campTribunal && !campTribunal.value) {
    const sigla = _siglaTribunal(numeroProcesso || "");
    if (sigla) campTribunal.value = sigla;
  }
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
    el("div", { class: "campo-ajuda", texto: d.tipoComunicacao || d.tipoDocumento || "-" }),
  ]));

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
    trTexto.appendChild(el("td", { colspan: "8" }, [el("div", { id: idTexto, class: "pub-oab-texto-expandido", texto: d.texto })]));
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
      el("a", {
        class: "cds--btn cds--btn--primary cds--btn--sm", href: d.link, target: "_blank", rel: "noopener",
        texto: "Abrir", title: "Acessar publicação", "aria-label": "Acessar publicação",
      })
    );
  }

  // ComboButton Carbon: ação primária "Adc. Caso" + menu com "Marcar como Tratada" e "Arquivar".
  const comboContainer = el("div", { class: "cds--combo-button__container cds--combo-button__container--sm pub-oab-combo" });
  const primaryWrap = el("div", { class: "cds--combo-button__primary-action" });
  const podeAdcCaso = p.status !== "tratada" && Boolean(p.numero_processo);
  if (podeAdcCaso) {
    anexarBotaoCadastrarCaso(primaryWrap, p.numero_processo, () => {
      _statusGeralPubOab("Caso cadastrado a partir da publicação.");
      carregarPublicacoesOab();
    }, {
      rotulo: "Adc. Caso",
      tituloModal: "Cadastrar cliente e caso",
      nomeSugerido: p.nome_pesquisado || "",
      tituloSugerido: d.nomeClasse || d.tipoComunicacao || "",
      hashPublicacao: p.hash || null,
      dadosPublicacao: d,
      tribunal: (d.siglaTribunal || "").toLowerCase() || null,
      classeBotao: "cds--btn cds--btn--primary cds--btn--sm",
    });
  } else {
    primaryWrap.appendChild(el("button", {
      class: "cds--btn cds--btn--primary cds--btn--sm", type: "button", texto: "Adc. Caso", disabled: "disabled",
      title: p.status === "tratada" ? "Já está tratada" : "Sem número de processo identificado",
    }));
  }
  comboContainer.appendChild(primaryWrap);

  const iconeChevron = _elSvg(document, "svg", { width: "16", height: "16", viewBox: "0 0 16 16", "aria-hidden": "true" }, [
    _elSvg(document, "path", { d: "M8 11 3 6l.7-.7L8 9.6l4.3-4.3.7.7z", fill: "currentColor" }),
  ]);
  const botaoTrigger = el("button", {
    class: "cds--btn cds--btn--primary cds--btn--sm cds--combo-button__trigger cds--menu-button__trigger",
    type: "button", "aria-haspopup": "true", "aria-expanded": "false", "aria-label": "Mais ações",
  }, [iconeChevron]);
  comboContainer.appendChild(botaoTrigger);

  const menu = el("ul", { class: "cds--menu pub-oab-combo-menu", role: "menu" });
  menu.hidden = true;

  // Vincular a caso existente: abre mini-form inline logo abaixo da linha.
  const itemVincular = el("li", { class: "cds--menu-item", role: "menuitem" }, [
    el("div", { class: "cds--menu-item__label", texto: "Vincular a caso existente" }),
  ]);
  let _trVincularForm = null;
  itemVincular.addEventListener("click", () => {
    _fecharTodosComboMenusOab();
    if (_trVincularForm) { _trVincularForm.remove(); _trVincularForm = null; return; }
    const status = el("p", { class: "campo-ajuda", style: "margin:0.25rem 0 0" });
    const selectCasoVincular = el("select", { class: "cds--select-input" });
    selectCasoVincular.appendChild(el("option", { value: "", texto: "— selecione o caso —" }));
    (_cacheCasos || []).forEach((c) => {
      selectCasoVincular.appendChild(el("option", { value: String(c.id), texto: c.titulo || "(sem título)" }));
    });
    const btnConfirmar = el("button", { class: "cds--btn cds--btn--primary cds--btn--sm", type: "button", texto: "Vincular" });
    const btnCancelar = el("button", { class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "Cancelar" });
    const miniForm = el("div", { class: "mini-form-caso" }, [
      el("div", { class: "cds--form-item" }, [el("label", { class: "cds--label", texto: "Vincular ao caso" }), selectCasoVincular]),
      el("div", { style: "display:flex;gap:0.5rem;flex-wrap:wrap" }, [btnConfirmar, btnCancelar]),
      status,
    ]);
    btnCancelar.addEventListener("click", () => { if (_trVincularForm) { _trVincularForm.remove(); _trVincularForm = null; } });
    btnConfirmar.addEventListener("click", async () => {
      const casoId = selectCasoVincular.value;
      if (!casoId) { status.textContent = "Selecione um caso."; return; }
      btnConfirmar.disabled = true;
      try {
        await _enviarJson(`/casos/${casoId}/publicacoes`, {
          hash: p.hash,
          numero_processo: p.numero_processo || null,
          dados: p.dados || null,
        });
        if (_trVincularForm) { _trVincularForm.remove(); _trVincularForm = null; }
        mostrarToast("success", "Vinculada", "Publicação vinculada ao caso.");
        carregarPublicacoesOab();
      } catch (err) {
        status.textContent = err.message;
        btnConfirmar.disabled = false;
      }
    });
    _trVincularForm = el("tr", {});
    _trVincularForm.appendChild(el("td", { colspan: "8" }, [miniForm]));
    tr.after(_trVincularForm);
  });
  menu.appendChild(itemVincular);

  if (p.status !== "tratada") {
    const itemTratada = el("li", { class: "cds--menu-item", role: "menuitem" }, [
      el("div", { class: "cds--menu-item__label", texto: "Marcar como Tratada" }),
    ]);
    itemTratada.addEventListener("click", () => { _fecharTodosComboMenusOab(); _aplicarStatusPubOab([p.hash], "tratada"); });
    menu.appendChild(itemTratada);
  }
  if (p.status !== "arquivada") {
    const itemArquivar = el("li", { class: "cds--menu-item", role: "menuitem" }, [
      el("div", { class: "cds--menu-item__label", texto: "Arquivar" }),
    ]);
    itemArquivar.addEventListener("click", () => { _fecharTodosComboMenusOab(); _aplicarStatusPubOab([p.hash], "arquivada"); });
    menu.appendChild(itemArquivar);
  }
  botaoTrigger.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const abrindo = menu.hidden;
    _fecharTodosComboMenusOab();
    if (abrindo) {
      menu.hidden = false;
      menu.classList.add("cds--menu--open", "cds--menu--shown");
      botaoTrigger.setAttribute("aria-expanded", "true");
    }
  });
  comboContainer.appendChild(menu);
  acoesLinha.appendChild(comboContainer);

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
    _atualizarBotoesLotePubOab();

    const checkboxTodos = el("input", { type: "checkbox", "aria-label": "Selecionar todas as publicações" });
    checkboxTodos.checked = publicacoes.length > 0 && publicacoes.every((p) => _publicacoesOabSelecionadas.has(p.hash));
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
    container.appendChild(el("div", { class: "tabela-responsiva-wrap" }, [el("table", { class: "tabela-responsiva pub-oab-tabela" }, [thead, tbody])]));
  } catch (erro) {
    limpar(container);
    mostrarErro(container, erro.message);
  }
}

document.getElementById("pub-oab-filtro-status").addEventListener("change", () => {
  _publicacoesOabSelecionadas.clear();
  carregarPublicacoesOab();
});
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

// ─── DataJud: busca ação/foro a partir de número de processo ─────────────────

async function buscarAcaoForoDataJud(numerosCampo, campAcao, campForo, statusEl, botao) {
  if (!cliente) { mostrarErro(statusEl, "Cliente MCP não disponível."); return; }
  const numeros = numerosCampo.value.split(",").map((s) => s.trim()).filter(Boolean);
  if (!numeros.length) { mostrarAviso(statusEl, "Informe ao menos um número de processo."); return; }
  const numero = numeros[0];
  const tribunal = _siglaTribunal(numero);
  if (!tribunal) { mostrarAviso(statusEl, "Não foi possível determinar o tribunal pelo número informado."); return; }
  botao.disabled = true;
  limpar(statusEl);
  statusEl.appendChild(notificacao("info", "Consultando DataJud…"));
  try {
    const dados = await cliente.chamarTool("consultar_processo_datajud", { numero_processo: numero, tribunal });
    if (dados.erro) { mostrarErro(statusEl, dados.mensagem || "Erro no DataJud."); return; }
    const proc = (dados.processos || [])[0];
    if (!proc) { mostrarAviso(statusEl, dados.mensagem || "Processo não encontrado."); return; }
    if (proc.classe && !campAcao.value) {
      const partes = [proc.classe, ...(proc.assuntos || [])].filter(Boolean);
      campAcao.value = partes.join(" - ");
    }
    if (proc.orgaoJulgador && !campForo.value) campForo.value = proc.orgaoJulgador;
    proc.classe ? mostrarSucesso(statusEl, "Preenchido.") : mostrarAviso(statusEl, "Sem dados de classe/órgão.");
  } catch (err) {
    mostrarErro(statusEl, err.message || "Erro ao consultar DataJud.");
  } finally {
    botao.disabled = false;
  }
}

document.getElementById("btn-datajud-modal").addEventListener("click", () =>
  buscarAcaoForoDataJud(
    document.getElementById("caso-processos"),
    document.getElementById("caso-acao"),
    document.getElementById("caso-foro"),
    document.getElementById("status-datajud-modal"),
    document.getElementById("btn-datajud-modal"),
  )
);

document.getElementById("btn-datajud-detalhe").addEventListener("click", () =>
  buscarAcaoForoDataJud(
    document.getElementById("editar-caso-processos"),
    document.getElementById("editar-caso-acao"),
    document.getElementById("editar-caso-foro"),
    document.getElementById("status-datajud-detalhe"),
    document.getElementById("btn-datajud-detalhe"),
  )
);

// ─── Vista de detalhe do caso ────────────────────────────────────────────────

let _casoDetalheAtual = null;

function voltarParaCasos() {
  document.getElementById("caso-vista-detalhe").hidden = true;
  document.getElementById("caso-vista-lista").hidden = false;
  _casoDetalheAtual = null;
}

function _selecionarSubabaCaso(nome) {
  for (const n of ["cadastro", "partes", "atividades", "publicacoes", "movimentacoes", "vinculos"]) {
    document.getElementById(`caso-subaba-${n}`).hidden = n !== nome;
    const btn = document.getElementById(`caso-subaba-${n}-botao`);
    btn.classList.toggle("sub-aba-ativa", n === nome);
    btn.setAttribute("aria-selected", n === nome ? "true" : "false");
  }
}

async function abrirCaso(casoId) {
  document.getElementById("caso-vista-lista").hidden = true;
  document.getElementById("caso-vista-detalhe").hidden = false;
  _selecionarSubabaCaso("cadastro");
  document.getElementById("caso-detalhe-titulo").textContent = "Carregando…";
  limpar(document.getElementById("lista-atividades"));
  limpar(document.getElementById("resultado-caso-editar"));
  limpar(document.getElementById("resultado-caso-partes"));
  try {
    const caso = await _buscarJson(`/casos/${casoId}`);
    _casoDetalheAtual = caso;
    document.getElementById("caso-detalhe-titulo").textContent = caso.titulo || "(sem título)";
    document.getElementById("editar-caso-titulo").value = caso.titulo || "";
    document.getElementById("editar-caso-responsavel").value = caso.responsavel || "";
    document.getElementById("editar-caso-acao").value = caso.acao || "";
    document.getElementById("editar-caso-foro").value = caso.foro || "";
    document.getElementById("editar-caso-desfecho").value = caso.desfecho || "";
    document.getElementById("editar-caso-processos").value = (caso.processos || []).join(", ");
    document.getElementById("editar-caso-autor").value = caso.autor || "";
    document.getElementById("editar-caso-reu").value = caso.reu || "";
    document.getElementById("editar-caso-advogados").value = caso.advogados || "";
    document.getElementById("form-caso-editar").dataset.casoId = casoId;
    document.getElementById("form-caso-partes").dataset.casoId = casoId;
    await _carregarAtividades(casoId);
  } catch (erro) {
    document.getElementById("caso-detalhe-titulo").textContent = "Erro ao carregar";
    mostrarErro(document.getElementById("resultado-caso-editar"), erro.message);
  }
}

async function _carregarAtividades(casoId) {
  const lista = document.getElementById("lista-atividades");
  limpar(lista);
  try {
    const { atividades } = await _buscarJson(`/casos/${casoId}/atividades`);
    _renderizarAtividades(casoId, atividades || []);
  } catch (erro) {
    mostrarErro(lista, erro.message);
  }
}

const _ROTULO_TIPO_ATIVIDADE = { tarefa: "Tarefa", prazo: "Prazo", audiencia: "Audiência", reuniao: "Reunião", outro: "Outro" };

function _renderizarAtividades(casoId, atividades) {
  const lista = document.getElementById("lista-atividades");
  limpar(lista);
  if (!atividades.length) {
    lista.appendChild(notificacao("info", "Nenhuma atividade cadastrada"));
    return;
  }
  for (const atv of atividades) {
    const item = el("div", { class: "atividade-item" });
    const check = el("input", { type: "checkbox", class: "atividade-check", "aria-label": "Concluída" });
    check.checked = atv.status === "concluida";
    check.addEventListener("change", async () => {
      const novoStatus = check.checked ? "concluida" : "pendente";
      try {
        const atualizada = await _enviarJson(`/casos/${casoId}/atividades/${atv.id}`, { status: novoStatus }, "PATCH");
        titulo.className = `atividade-titulo${atualizada.status === "concluida" ? " concluida" : ""}`;
        atv.status = atualizada.status;
      } catch (erro) {
        check.checked = !check.checked;
        mostrarToast("error", "Erro", erro.message);
      }
    });
    item.appendChild(check);

    const corpo = el("div", { class: "atividade-corpo" });
    const titulo = el("p", { class: `atividade-titulo${atv.status === "concluida" ? " concluida" : ""}`, texto: atv.titulo });
    corpo.appendChild(titulo);
    const partesMeta = [_ROTULO_TIPO_ATIVIDADE[atv.tipo] || atv.tipo];
    if (atv.data) partesMeta.push(atv.data);
    if (atv.hora) partesMeta.push(atv.hora);
    corpo.appendChild(el("p", { class: "atividade-meta", texto: partesMeta.join(" · ") }));
    if (atv.observacoes) corpo.appendChild(el("p", { class: "atividade-meta", texto: atv.observacoes }));
    item.appendChild(corpo);

    const acoes = el("div", { class: "atividade-acoes" });
    const btnEditar = el("button", { class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "Editar" });
    btnEditar.addEventListener("click", () => _abrirModalAtividade(casoId, atv));
    const btnExcluir = el("button", { class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "✕" });
    btnExcluir.setAttribute("aria-label", "Excluir atividade");
    btnExcluir.addEventListener("click", async () => {
      if (!(await confirmarAcao(`Excluir "${atv.titulo}"?`))) return;
      try {
        await _enviarJson(`/casos/${casoId}/atividades/${atv.id}`, {}, "DELETE");
        await _carregarAtividades(casoId);
      } catch (err) { mostrarToast("error", "Erro", err.message); }
    });
    acoes.appendChild(btnEditar);
    acoes.appendChild(btnExcluir);
    item.appendChild(acoes);

    lista.appendChild(item);
  }
}

function _abrirModalAtividade(casoId, atividade = null) {
  document.getElementById("atividade-id").value = atividade ? atividade.id : "";
  document.getElementById("atividade-tipo").value = atividade ? atividade.tipo : "tarefa";
  document.getElementById("atividade-titulo").value = atividade ? atividade.titulo : "";
  if (window._fpAtividadeData) {
    window._fpAtividadeData.setDate(atividade ? (atividade.data || "") : "", false);
  } else {
    document.getElementById("atividade-data").value = atividade ? (atividade.data || "") : "";
  }
  document.getElementById("atividade-hora").value = atividade ? (atividade.hora || "") : "";
  document.getElementById("atividade-observacoes").value = atividade ? (atividade.observacoes || "") : "";
  document.getElementById("modal-atividade-titulo").textContent = atividade ? "Editar atividade" : "Nova atividade";
  document.getElementById("form-atividade").dataset.casoId = casoId;
  limpar(document.getElementById("resultado-atividade"));
  abrirModal("modal-atividade");
}

// Chave = J (segmento, 1 dígito) + TT (código do tribunal, 2 dígitos), posições 13-15 do CNJ sem máscara.
const _tribunalMap = {
  // Tribunais superiores
  "100": "stf",  "300": "stj",  "700": "stm",
  // Justiça Federal — TRF
  "401": "trf1", "402": "trf2", "403": "trf3", "404": "trf4", "405": "trf5", "406": "trf6",
  // Justiça do Trabalho — TRT
  "501": "trt1",  "502": "trt2",  "503": "trt3",  "504": "trt4",  "505": "trt5",
  "506": "trt6",  "507": "trt7",  "508": "trt8",  "509": "trt9",  "510": "trt10",
  "511": "trt11", "512": "trt12", "513": "trt13", "514": "trt14", "515": "trt15",
  "516": "trt16", "517": "trt17", "518": "trt18", "519": "trt19", "520": "trt20",
  "521": "trt21", "522": "trt22", "523": "trt23", "524": "trt24",
  // Justiça Eleitoral — TRE
  "601": "treac", "602": "treal", "603": "treap", "604": "tream", "605": "treba",
  "606": "trece", "607": "tredf", "608": "trees", "609": "trego", "610": "trema",
  "611": "tremt", "612": "trems", "613": "tremg", "614": "trepa", "615": "trepb",
  "616": "trepr", "617": "trepe", "618": "trepi", "619": "trerj", "620": "trern",
  "621": "trers", "622": "trero", "623": "trerr", "624": "tresc", "625": "trese",
  "626": "tresp", "627": "treto",
  // Justiça Estadual — TJ (TT = ordem alfabética dos estados)
  "801": "tjac",  "802": "tjal",  "803": "tjap",  "804": "tjam",  "805": "tjba",
  "806": "tjce",  "807": "tjdft", "808": "tjes",  "809": "tjgo",  "810": "tjma",
  "811": "tjmt",  "812": "tjms",  "813": "tjmg",  "814": "tjpa",  "815": "tjpb",
  "816": "tjpr",  "817": "tjpe",  "818": "tjpi",  "819": "tjrj",  "820": "tjrn",
  "821": "tjrs",  "822": "tjro",  "823": "tjrr",  "824": "tjsc",  "825": "tjse",
  "826": "tjsp",  "827": "tjto",
  // Justiça Militar Estadual
  "913": "tjmmg", "921": "tjmrs", "926": "tjmsp",
};
function _siglaTribunal(num) {
  const digitos = num.replace(/\D/g, "");
  if (digitos.length === 20) {
    const cod = digitos.substring(13, 16); // J (1 dígito) + TT (2 dígitos)
    return _tribunalMap[cod] || null;
  }
  return null;
}

async function _carregarPublicacoesCaso(casoId) {
  const lista = document.getElementById("lista-publicacoes-caso");
  limpar(lista);
  try {
    const resp = await _buscarJson(`/casos/${casoId}/publicacoes`);
    const pubs = resp.publicacoes || [];
    if (!pubs.length) {
      lista.textContent = "Nenhuma publicação vinculada a este caso.";
      return;
    }
    const ul = document.createElement("ul");
    ul.style.cssText = "list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:0.75rem";
    for (const pub of pubs) {
      const dados = pub.dados || {};
      const li = document.createElement("li");
      li.style.cssText = "border:1px solid var(--cds-border-subtle,#e0e0e0);border-radius:4px;padding:0.75rem 1rem";
      const data = (pub.criado_em || "").substring(0, 10);
      const numero = pub.numero_processo || "";
      const texto = dados.texto || dados.teor || dados.conteudo || "";
      li.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:1rem">
        <div>
          <strong style="font-size:0.875rem">${_escaparHtml(numero || pub.nome_pesquisado || "Publicação")}</strong>
          <span style="font-size:0.75rem;color:var(--cds-text-secondary,#525252);margin-left:0.5rem">${data}</span>
        </div>
        <button class="cds--btn cds--btn--ghost cds--btn--sm" type="button" data-hash="${_escaparHtml(pub.hash)}" data-caso="${_escaparHtml(casoId)}">Desvincular</button>
      </div>
      ${texto ? `<p style="margin:0.5rem 0 0;font-size:0.8125rem;color:var(--cds-text-secondary,#525252);white-space:pre-wrap">${_escaparHtml(texto.substring(0, 300))}${texto.length > 300 ? "…" : ""}</p>` : ""}`;
      li.querySelector("button").addEventListener("click", async (e) => {
        const h = e.currentTarget.dataset.hash;
        const cid = e.currentTarget.dataset.caso;
        if (!(await confirmarAcao("Desvincular esta publicação do caso?"))) return;
        try {
          await _enviarJson(`/casos/${cid}/publicacoes/${h}`, {}, "DELETE");
          await _carregarPublicacoesCaso(cid);
        } catch (err) { mostrarToast("error", "Erro", err.message); }
      });
      ul.appendChild(li);
    }
    lista.appendChild(ul);
  } catch (erro) {
    lista.textContent = `Erro: ${erro.message}`;
  }
}

async function _buscarMovimentacoes(casoId) {
  const statusEl = document.getElementById("movimentacoes-status");
  const lista = document.getElementById("lista-movimentacoes");
  limpar(lista);
  limpar(statusEl);
  const resp = await _buscarJson(`/casos/${casoId}`);
  const numeros = resp.processos || [];
  if (!numeros.length) {
    mostrarAviso(statusEl, "Nenhum número de processo vinculado a este caso.");
    return;
  }
  statusEl.appendChild(notificacao("info", `Consultando ${numeros.length} processo(s) no DataJud…`));
  const botao = document.getElementById("btn-buscar-movimentacoes");
  botao.disabled = true;
  let todasMovs = [];
  let erros = [];
  for (const num of numeros) {
    const tribunal = _siglaTribunal(num);
    if (!tribunal) { erros.push(`${num}: não foi possível determinar o tribunal`); continue; }
    try {
      const dados = await cliente.chamarTool("consultar_processo_datajud", { numero_processo: num, tribunal });
      if (dados.erro || !dados.encontrado) { erros.push(`${num}: ${dados.mensagem || "não encontrado"}`); continue; }
      for (const proc of (dados.processos || [])) {
        for (const m of (proc.movimentos || [])) {
          todasMovs.push({ numero: num, grau: proc.grau_descricao || proc.grau, ...m });
        }
      }
    } catch (e) {
      erros.push(`${num}: ${e.message}`);
    }
  }
  botao.disabled = false;
  if (!todasMovs.length && !erros.length) {
    mostrarAviso(statusEl, "Nenhuma movimentação encontrada.");
    return;
  }
  if (erros.length) mostrarAviso(statusEl, erros.join(" | "));
  else limpar(statusEl);
  // Mesmo componente de linha do tempo da aba "Processo (DataJud)" (agrupa tramitação,
  // categoriza decisões/petições e tem filtros) - ver linhaDoTempoMovimentos().
  lista.appendChild(linhaDoTempoMovimentos(todasMovs));
}

function _escaparHtml(str) {
  return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

const _ROTULO_DESFECHO_CASO = {
  procedente: "Procedente",
  procedente_parcial: "Parc. procedente",
  improcedente: "Improcedente",
  acordo: "Acordo",
  extinto: "Extinto s/ mérito",
  provido: "Provido",
  desprovido: "Desprovido",
};

// ─── Vínculos entre casos ────────────────────────────────────────────────────

const _ROTULO_TIPO_VINCULO = {
  recurso: "Recurso",
  apenso: "Apenso",
  execucao: "Execução de sentença",
  cautelar: "Cautelar / Tutela",
  relacionado: "Relacionado",
};

async function _carregarVinculos(casoId) {
  const lista = document.getElementById("lista-vinculos");
  limpar(lista);
  try {
    const { vinculos } = await _buscarJson(`/casos/${casoId}/vinculos`);
    _renderizarVinculos(casoId, vinculos || []);
  } catch (erro) {
    mostrarErro(lista, erro.message);
  }
  await _popularSelectCasos(casoId);
}

async function _popularSelectCasos(casoAtualId) {
  const sel = document.getElementById("vinculos-caso-select");
  // Preserva a opção em branco e repõe o resto
  while (sel.options.length > 1) sel.remove(1);
  try {
    const { casos } = await _buscarJson("/casos");
    for (const c of (casos || [])) {
      if (c.id === casoAtualId) continue;
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = (c.titulo || "(sem título)") + (c.acao ? ` — ${c.acao}` : "");
      sel.appendChild(opt);
    }
  } catch (_) { /* silencioso — select fica com só a opção em branco */ }
}

function _renderizarVinculos(casoId, vinculos) {
  const lista = document.getElementById("lista-vinculos");
  limpar(lista);
  if (!vinculos.length) {
    lista.appendChild(notificacao("info", "Nenhum caso vinculado"));
    return;
  }
  const thead = el("thead", {}, [
    el("tr", {}, [
      el("th", {}, [document.createTextNode("Caso")]),
      el("th", {}, [document.createTextNode("Cliente")]),
      el("th", {}, [document.createTextNode("Ação / Tipo")]),
      el("th", {}, [document.createTextNode("Vínculo")]),
      el("th", {}, [document.createTextNode("")]),
    ]),
  ]);
  const tbody = el("tbody", {});
  for (const v of vinculos) {
    const titulo = v.titulo || "(sem título)";
    const btnRemover = el("button", {
      class: "cds--btn cds--btn--ghost cds--btn--sm",
      type: "button",
      "aria-label": `Remover vínculo com ${titulo}`,
    }, [document.createTextNode("Remover")]);
    btnRemover.addEventListener("click", async () => {
      btnRemover.disabled = true;
      try {
        await _enviarJson(`/casos/${casoId}/vinculos/${v.caso_id}`, {}, "DELETE");
        mostrarToast("success", "Vínculo removido", `"${titulo}" desvinculado.`);
        await _carregarVinculos(casoId);
      } catch (erro) {
        mostrarToast("error", "Erro", erro.message);
        btnRemover.disabled = false;
      }
    });
    const linkCaso = el("a", { href: "#", class: "cds--link" }, [document.createTextNode(titulo)]);
    linkCaso.addEventListener("click", (e) => { e.preventDefault(); abrirCaso(v.caso_id); });
    tbody.appendChild(el("tr", {}, [
      el("td", {}, [linkCaso]),
      el("td", {}, [document.createTextNode(v.cliente_nome || "—")]),
      el("td", {}, [document.createTextNode(v.acao || "—")]),
      el("td", {}, [document.createTextNode(_ROTULO_TIPO_VINCULO[v.tipo] || v.tipo)]),
      el("td", {}, [btnRemover]),
    ]));
  }
  lista.appendChild(
    el("div", { class: "tabela-responsiva-wrap" }, [
      el("table", { class: "tabela-responsiva tabela-vinculos" }, [thead, tbody]),
    ]),
  );
}

document.getElementById("form-vinculos-adicionar").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const casoId = document.getElementById("form-caso-editar").dataset.casoId;
  if (!casoId) return;
  const resultado = document.getElementById("vinculos-resultado");
  limpar(resultado);
  const outroId = document.getElementById("vinculos-caso-select").value;
  const tipo = document.getElementById("vinculos-tipo-select").value;
  if (!outroId) {
    resultado.appendChild(notificacao("error", "Selecione um caso."));
    return;
  }
  const botao = evento.target.querySelector("button[type=submit]");
  botao.disabled = true;
  try {
    await _enviarJson(`/casos/${casoId}/vinculos`, { caso_vinculado_id: outroId, tipo });
    limpar(resultado);
    document.getElementById("vinculos-caso-select").value = "";
    document.getElementById("vinculos-tipo-select").value = "relacionado";
    document.getElementById("vinculos-adicionar-painel").open = false;
    mostrarToast("success", "Vínculo criado", "Caso vinculado com sucesso.");
    await _carregarVinculos(casoId);
  } catch (erro) {
    resultado.appendChild(notificacao("error", erro.message));
  } finally {
    botao.disabled = false;
  }
});

document.getElementById("caso-voltar").addEventListener("click", voltarParaCasos);
document.getElementById("caso-subaba-cadastro-botao").addEventListener("click", () => _selecionarSubabaCaso("cadastro"));
document.getElementById("caso-subaba-partes-botao").addEventListener("click", () => _selecionarSubabaCaso("partes"));
document.getElementById("caso-subaba-atividades-botao").addEventListener("click", () => _selecionarSubabaCaso("atividades"));
document.getElementById("caso-subaba-publicacoes-botao").addEventListener("click", () => {
  _selecionarSubabaCaso("publicacoes");
  const casoId = document.getElementById("form-caso-editar").dataset.casoId;
  if (casoId) _carregarPublicacoesCaso(casoId);
});
document.getElementById("caso-subaba-movimentacoes-botao").addEventListener("click", () => {
  _selecionarSubabaCaso("movimentacoes");
});
document.getElementById("caso-subaba-vinculos-botao").addEventListener("click", () => {
  _selecionarSubabaCaso("vinculos");
  const casoId = document.getElementById("form-caso-editar").dataset.casoId;
  if (casoId) _carregarVinculos(casoId);
});
document.getElementById("btn-buscar-movimentacoes").addEventListener("click", () => {
  const casoId = document.getElementById("form-caso-editar").dataset.casoId;
  if (casoId) _buscarMovimentacoes(casoId);
});

document.getElementById("btn-nova-atividade").addEventListener("click", () => {
  const casoId = document.getElementById("form-caso-editar").dataset.casoId;
  if (casoId) _abrirModalAtividade(casoId);
});
document.getElementById("modal-atividade-fechar").addEventListener("click", () => fecharModal("modal-atividade"));

document.getElementById("form-caso-editar").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const casoId = evento.target.dataset.casoId;
  if (!casoId) return;
  const botao = evento.target.querySelector("button[type=submit]");
  const resultado = document.getElementById("resultado-caso-editar");
  const numeros = document.getElementById("editar-caso-processos").value.split(",").map((s) => s.trim()).filter(Boolean);
  const corpo = {
    titulo: document.getElementById("editar-caso-titulo").value.trim(),
    responsavel: document.getElementById("editar-caso-responsavel").value.trim(),
    acao: document.getElementById("editar-caso-acao").value.trim(),
    foro: document.getElementById("editar-caso-foro").value.trim(),
    desfecho: document.getElementById("editar-caso-desfecho").value || null,
    numeros_processo: numeros,
  };
  const pararEspera = mostrarEspera(resultado, botao, "Salvando");
  try {
    const atualizado = await _enviarJson(`/casos/${casoId}`, corpo, "PATCH");
    limpar(resultado);
    resultado.appendChild(notificacao("success", "Caso atualizado"));
    document.getElementById("caso-detalhe-titulo").textContent = atualizado.titulo || "(sem título)";
    const indice = _cacheCasos.findIndex((c) => c.id === casoId);
    if (indice !== -1) _cacheCasos[indice] = { ..._cacheCasos[indice], ...atualizado };
  } catch (erro) {
    mostrarErro(resultado, erro.message);
  } finally {
    pararEspera();
  }
});

document.getElementById("btn-buscar-partes").addEventListener("click", () => {
  const casoId = document.getElementById("form-caso-partes").dataset.casoId;
  if (casoId) _buscarPartesDJEN(casoId);
});

async function _buscarPartesDJEN(casoId) {
  const statusEl = document.getElementById("status-partes-djen");
  const botao = document.getElementById("btn-buscar-partes");
  limpar(statusEl);
  statusEl.appendChild(notificacao("info", "Buscando…"));
  botao.disabled = true;

  try {
    // 1. Tenta extrair das publicações já vinculadas ao caso
    let destinatarios = [];
    let advogados = [];
    const respPubs = await _buscarJson(`/casos/${casoId}/publicacoes`);
    for (const pub of (respPubs.publicacoes || [])) {
      const d = pub.dados || {};
      destinatarios.push(...(d.destinatarios || []));
      advogados.push(...(d.destinatarioadvogados || []));
    }

    // 2. Se não achou nada nas publicações vinculadas, consulta DJEN diretamente
    if (!destinatarios.length && !advogados.length) {
      const respCaso = await _buscarJson(`/casos/${casoId}`);
      const numeros = respCaso.processos || [];
      for (const num of numeros) {
        try {
          const r = await cliente.chamarTool("consultar_publicacoes_djen", { numero_processo: num });
          if (r.erro) continue;
          for (const item of (r.itens || [])) {
            destinatarios.push(...(item.destinatarios || []));
            advogados.push(...(item.destinatarioadvogados || []));
          }
        } catch (_) { /* ignora falha por processo */ }
      }
    }

    if (!destinatarios.length && !advogados.length) {
      mostrarAviso(statusEl, "Nenhuma parte encontrada no DJEN para este caso.");
      return;
    }

    // Deduplica por nome
    const _nomes = (arr) => [...new Set(arr.map((x) => (x.nome || "").trim()).filter(Boolean))];

    const ativos  = _nomes(destinatarios.filter((d) => /AT(IVO)?$/i.test(d.polo || "")));
    const passivos = _nomes(destinatarios.filter((d) => /PA(SSIVO)?$/i.test(d.polo || "")));
    // Polo desconhecido: junta em ativos se não tiver nenhum dos lados ainda
    if (!ativos.length && !passivos.length) {
      ativos.push(..._nomes(destinatarios));
    }
    const advsNomes = _nomes(advogados);

    const campoAutor = document.getElementById("editar-caso-autor");
    const campoReu   = document.getElementById("editar-caso-reu");
    const campoAdvs  = document.getElementById("editar-caso-advogados");

    if (ativos.length  && !campoAutor.value) campoAutor.value = ativos.join(", ");
    if (passivos.length && !campoReu.value)  campoReu.value   = passivos.join(", ");
    if (advsNomes.length && !campoAdvs.value) campoAdvs.value = advsNomes.join(", ");

    mostrarSucesso(statusEl, "Preenchido. Revise e salve.");
  } catch (err) {
    mostrarErro(statusEl, err.message || "Erro ao buscar partes.");
  } finally {
    botao.disabled = false;
  }
}

document.getElementById("form-caso-partes").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const casoId = evento.target.dataset.casoId;
  if (!casoId) return;
  const botao = evento.target.querySelector("button[type=submit]");
  const resultado = document.getElementById("resultado-caso-partes");
  const corpo = {
    autor: document.getElementById("editar-caso-autor").value.trim(),
    reu: document.getElementById("editar-caso-reu").value.trim(),
    advogados: document.getElementById("editar-caso-advogados").value.trim(),
  };
  const pararEspera = mostrarEspera(resultado, botao, "Salvando");
  try {
    await _enviarJson(`/casos/${casoId}`, corpo, "PATCH");
    limpar(resultado);
    resultado.appendChild(notificacao("success", "Partes atualizadas"));
  } catch (erro) {
    mostrarErro(resultado, erro.message);
  } finally {
    pararEspera();
  }
});

document.getElementById("btn-excluir-caso").addEventListener("click", async () => {
  const casoId = document.getElementById("form-caso-editar").dataset.casoId;
  if (!casoId) return;
  const titulo = document.getElementById("editar-caso-titulo").value || "(sem título)";
  if (!(await confirmarAcao(`Excluir o caso "${titulo}"? Essa ação não pode ser desfeita.`))) return;
  const botao = document.getElementById("btn-excluir-caso");
  botao.disabled = true;
  try {
    await _enviarJson(`/casos/${casoId}`, {}, "DELETE");
    _cacheCasos = _cacheCasos.filter((c) => c.id !== casoId);
    voltarParaCasos();
    _renderizarTabelaCasosPagina();
  } catch (erro) {
    mostrarErro(document.getElementById("resultado-caso-editar"), erro.message);
    botao.disabled = false;
  }
});

document.getElementById("form-atividade").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const casoId = evento.target.dataset.casoId;
  if (!casoId) return;
  const aid = document.getElementById("atividade-id").value;
  const botao = document.querySelector("button[form='form-atividade'][type='submit']");
  const resultado = document.getElementById("resultado-atividade");
  const corpo = {
    tipo: document.getElementById("atividade-tipo").value,
    titulo: document.getElementById("atividade-titulo").value.trim(),
    data: document.getElementById("atividade-data").value || null,
    hora: document.getElementById("atividade-hora").value || null,
    observacoes: document.getElementById("atividade-observacoes").value.trim() || null,
  };
  if (!corpo.titulo) { mostrarErro(resultado, "Informe o título."); return; }
  const pararEspera = mostrarEspera(resultado, botao, "Salvando");
  try {
    if (aid) {
      await _enviarJson(`/casos/${casoId}/atividades/${aid}`, corpo, "PATCH");
    } else {
      await _enviarJson(`/casos/${casoId}/atividades`, corpo);
    }
    fecharModal("modal-atividade");
    await _carregarAtividades(casoId);
  } catch (erro) {
    mostrarErro(resultado, erro.message);
  } finally {
    pararEspera();
  }
});

// Date Picker - range (Carbon + flatpickr): dois campos ligados a um único calendário.
// Os IDs originais são mantidos, então o resto do app continua lendo `.value` normalmente.
// `allowInput: true` é obrigatório: sem ele o flatpickr marca os inputs como `readonly`,
// e um input readonly é excluído da validação HTML5 (`required`) e recusa digitação.
function _inicializarDatePickerRange(idInicio, idFim, opcoes) {
  const elInicio = document.getElementById(idInicio);
  const elFim = document.getElementById(idFim);
  if (!elInicio || !elFim || typeof window.flatpickr !== "function") return;
  window.flatpickr(elInicio, Object.assign({
    altInput: false,
    allowInput: true,
    locale: window.flatpickr.l10ns && window.flatpickr.l10ns.pt,
    plugins: [new window.rangePlugin({ input: elFim })],
  }, opcoes));
}

// dateFormat define exatamente o texto entregue em `.value` (o formato que o backend espera).
_inicializarDatePickerRange("pub-data-inicio", "pub-data-fim", { dateFormat: "Y-m-d" });
_inicializarDatePickerRange("jur-data-inicio", "jur-data-fim", { dateFormat: "d/m/Y" });
_inicializarDatePickerRange("pub-oab-manual-data-inicio", "pub-oab-manual-data-fim", { dateFormat: "Y-m-d" });

// Date picker simples para atividade-data (sem range plugin).
(function () {
  const el = document.getElementById("atividade-data");
  if (!el || typeof window.flatpickr !== "function") return;
  const fp = window.flatpickr(el, {
    altInput: false,
    allowInput: true,
    locale: window.flatpickr.l10ns && window.flatpickr.l10ns.pt,
    dateFormat: "Y-m-d",
  });
  // Expõe a instância para que _abrirModalAtividade possa pré-popular via setDate().
  window._fpAtividadeData = fp;
})();
