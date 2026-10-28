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
const formulariosProtegidos = new Map();
let decisaoEdicaoPendente = false;

function valoresFormulario(form) {
  return JSON.stringify([...form.querySelectorAll("input, select, textarea")].map((campo) =>
    [campo.id, campo.type, campo.type === "checkbox" || campo.type === "radio" ? campo.checked : campo.value]));
}

function formularioAlterado(form) {
  const estado = formulariosProtegidos.get(form);
  return Boolean(estado && estado.base !== valoresFormulario(form));
}

function atualizarIndicadorEdicao(form) {
  const estado = formulariosProtegidos.get(form);
  if (estado) estado.indicador.hidden = !formularioAlterado(form);
}

function marcarFormularioSalvo(form, aposReset = false) {
  const estado = formulariosProtegidos.get(form);
  if (!estado) return;
  estado.base = !aposReset && estado.enviado ? estado.enviado : valoresFormulario(form);
  if (form.id === "form-contato-cadastro") {
    estado.contato = !aposReset && estado.contatoEnviado ? estado.contatoEnviado : _lerCadastroCompleto("contato", gruposContato);
  }
  atualizarIndicadorEdicao(form);
}

function registrarSalvamento(form, salvar) {
  const indicador = el("p", { class: "campo-ajuda edicao-pendente", role: "status", texto: "Alterações não salvas" });
  indicador.hidden = true;
  form.prepend(indicador);
  const estado = { base: valoresFormulario(form), indicador, salvando: null, enviado: null };
  formulariosProtegidos.set(form, estado);
  form.addEventListener("input", () => atualizarIndicadorEdicao(form));
  form.addEventListener("change", () => atualizarIndicadorEdicao(form));
  new MutationObserver(() => atualizarIndicadorEdicao(form)).observe(form, { childList: true, subtree: true });
  form.addEventListener("submit", (evento) => {
    evento.preventDefault();
    if (estado.salvando) return;
    estado.enviado = valoresFormulario(form);
    if (form.id === "form-contato-cadastro") estado.contatoEnviado = _lerCadastroCompleto("contato", gruposContato);
    estado.salvando = (async () => {
      await Promise.resolve(); // Registra a operação antes de executar o handler.
      try { await salvar(evento); }
      finally { estado.enviado = null; estado.contatoEnviado = null; estado.salvando = null; atualizarIndicadorEdicao(form); }
    })();
  });
}

function formulariosPendentes(raiz = document) {
  return [...formulariosProtegidos.keys()].filter((form) => raiz.contains(form) &&
    !form.closest(".fluxo-pagina:not(.is-visible), .app-modal:not(.is-visible)") && formularioAlterado(form));
}

function revelarFormulario(form) {
  if (form.id === "form-caso-editar") _selecionarSubabaCaso("cadastro");
  if (form.id === "form-contato-cadastro") _selecionarSubabaContato("cadastro");
  // Um campo inválido pode estar numa seção interna do cadastro.
  const invalido = form.querySelector(":invalid");
  const painel = invalido?.closest(".cadastro-painel");
  if (painel) _selecionarAbaCadastro("contato", painel.id.split("-").pop());
}

async function permitirSaidaEdicao(raiz = document) {
  const pendentes = formulariosPendentes(raiz);
  if (!pendentes.length) return true;
  if (decisaoEdicaoPendente) return false;
  decisaoEdicaoPendente = true;
  try {
    const escolha = await escolherSaidaEdicao();
    if (escolha === "continuar") return false;
    if (escolha === "salvar") {
      for (const form of pendentes) {
        revelarFormulario(form);
        if (!form.reportValidity()) return false;
        const estado = formulariosProtegidos.get(form);
        if (!estado.salvando) form.requestSubmit();
        await estado.salvando;
        if (formularioAlterado(form)) return false; // Falha: mantém o formulário e o erro visíveis.
      }
    } else {
      for (const form of pendentes) {
        const estado = formulariosProtegidos.get(form);
        if (estado.salvando) { await estado.salvando; if (formularioAlterado(form)) return false; }
        const valores = JSON.parse(estado.base);
        if (estado.contato) {
          _preencherCadastroCompleto("contato", gruposContato, estado.contato, definirTipoPessoaContato, definirPerfilContato);
        }
        const porId = new Map(valores.filter(([id]) => id).map((valor) => [valor[0], valor]));
        [...form.querySelectorAll("input, select, textarea")].forEach((campo, i) => {
          const valor = campo.id ? porId.get(campo.id) : estado.contato ? null : valores[i];
          if (!valor) return;
          if (campo.type === "checkbox" || campo.type === "radio") campo.checked = valor[2];
          else campo.value = valor[2];
        });
        marcarFormularioSalvo(form, true);
        atualizarIndicadorEdicao(form);
      }
    }
    return true;
  } finally { decisaoEdicaoPendente = false; }
}



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

  async _enviar(...args) {
    return this._enviarSemProgresso(...args);
  }

  async _enviarSemProgresso(corpo, { comResposta = true, podeReiniciar = true } = {}) {
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

  async chamarTool(nome, argumentos, feedback = {}) {
    const externas = new Set(['consultar_processo_datajud', 'consultar_publicacoes_djen', 'buscar_feriados_forenses', 'baixar_certidao_djen', 'perfil_decisorio_magistrado', 'consultar_jurimetria_cjpg']);
    return window.cnjUI.operacao(() => this._chamarToolSemFeedback(nome, argumentos), {
      tipo: externas.has(nome) ? 'externo' : 'interno', rotulo: externas.has(nome) ? 'Consultando fonte externa' : 'Processando solicitação', ...feedback,
    });
  }

  async _chamarToolSemFeedback(nome, argumentos) {
    if (!this.sessionId) await this._iniciar();
    const resultado = await this._enviar({
      jsonrpc: "2.0",
      id: this.proximoId++,
      method: "tools/call",
      params: { name: nome, arguments: argumentos },
    });
    if (resultado?.isError) throw new ErroMCP(200, resultado.content?.[0]?.text || "Não foi possível concluir a solicitação.");
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
  const recuperar = {
    "lista-contatos": carregarContatos,
    "lista-casos": carregarCasosPagina,
    "lista-lancamentos": carregarLancamentos,
    "lista-pagamentos": carregarPagamentos,
    "lista-publicacoes-oab": carregarPublicacoesOab,
    "resultado-monitoramentos": carregarMonitoramentos,
  }[container.id];
  if (recuperar) container.appendChild(el("button", { type: "button", class: "cds--btn cds--btn--tertiary cds--btn--sm", texto: "Tentar novamente", onclick: recuperar }));
}

function mostrarSucesso(container, mensagem) {
  limpar(container);
  container.appendChild(notificacao("success", mensagem));
}

function mostrarAviso(container, mensagem) {
  limpar(container);
  container.appendChild(notificacao("warning", "Atenção", mensagem));
}

// Movimento próprio: estado final imediato com teclado ou preferência reduzida.
const _motionReduzido = matchMedia("(prefers-reduced-motion: reduce)");
const _motionAtivos = new Set();
let _motionTeclado = false;
function _concluirMotion() { for (const animacao of [..._motionAtivos]) animacao.finish(); }
document.addEventListener("keydown", () => {
  _motionTeclado = true;
  document.documentElement.classList.add("app-motion-teclado");
  _concluirMotion();
}, true);
document.addEventListener("pointerdown", () => {
  _motionTeclado = false;
  document.documentElement.classList.remove("app-motion-teclado");
}, true);
_motionReduzido.addEventListener("change", () => { if (_motionReduzido.matches) _concluirMotion(); });
function _animarOpacidade(alvo, inicio, fim, token, curva) {
  if (_motionReduzido.matches || _motionTeclado || !alvo.animate) return null;
  const estilo = getComputedStyle(document.documentElement);
  const animacao = alvo.animate([{ opacity: inicio }, { opacity: fim }], {
    duration: parseFloat(estilo.getPropertyValue(token)), easing: estilo.getPropertyValue(curva).trim(),
  });
  _motionAtivos.add(animacao);
  const concluir = () => _motionAtivos.delete(animacao);
  animacao.addEventListener("finish", concluir, { once: true });
  animacao.addEventListener("cancel", concluir, { once: true });
  return animacao;
}
function _animarTooltip(alvo, evento) {
  if (evento?.type !== "mouseenter" || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  _animarOpacidade(alvo, 0, 1, "--cds-duration-fast-01", "--cds-ease-entrance");
}

function mostrarToast(tipo, titulo, mensagem, duracao = 5000) {
  const container = document.getElementById("toast-global");
  if (!container) { console.error(mensagem || titulo); return; }
  const ntf = notificacao(tipo, titulo, mensagem || "");
  ntf.style.cssText += ";pointer-events:all;box-shadow:0 2px 6px rgba(0,0,0,.2)";
  const fechar = document.createElement("button");
  fechar.setAttribute("aria-label", "Fechar");
  fechar.setAttribute("type", "button");
  fechar.className = "cds--inline-notification__close-button";
  fechar.innerHTML = "✕";
  fechar.style.cssText = "border:none;background:transparent;cursor:pointer;padding:0.5rem;font-size:1rem;line-height:1;opacity:.7";
  let temporizador;
  const remover = () => {
    clearTimeout(temporizador);
    for (const animacao of ntf.getAnimations()) animacao.cancel();
    ntf.remove();
  };
  fechar.addEventListener("click", remover);
  ntf.querySelector(".cds--inline-notification__details").after(fechar);
  const animavel = tipo !== "error" && container.childElementCount === 0;
  // Rajadas interrompem também a entrada do aviso anterior.
  if (container.childElementCount) for (const aviso of container.children) for (const animacao of aviso.getAnimations()) animacao.finish();
  container.appendChild(ntf);
  if (animavel) _animarOpacidade(ntf, 0, 1, "--cds-duration-moderate-01", "--cds-ease-entrance");
  if (duracao > 0) temporizador = setTimeout(() => {
    if (!ntf.isConnected) return;
    const saida = animavel && container.childElementCount === 1
      ? _animarOpacidade(ntf, 1, 0, "--cds-duration-fast-02", "--cds-ease-exit") : null;
    if (!saida) remover();
    else { saida.addEventListener("finish", remover, { once: true }); saida.addEventListener("cancel", remover, { once: true }); }
  }, duracao);
}

function mostrarEspera(container, botao, titulo) {
  botao.disabled = true;
  limpar(container);
  const inicio = Date.now();
  // O cronômetro fica num span aria-hidden para não re-anunciar a cada segundo em leitores de tela
  const cronometro = el("span", { "aria-hidden": "true" });
  const texto = el("p", { class: "app-espera" }, [
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

function _ddmmaaaaParaIso(valor) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((valor || "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

// Máscara live de CPF (11 dígitos) ou CNPJ (14 dígitos) - decide o formato pela quantidade de
// dígitos já digitados, então o mesmo campo serve pra pessoa física e jurídica.
function _aplicarMascaraCpfCnpj(input) {
  input.addEventListener("input", () => {
    const digitos = input.value.replace(/\D/g, "").slice(0, 14);
    if (digitos.length <= 11) {
      input.value = digitos
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    } else {
      input.value = digitos
        .replace(/(\d{2})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1/$2")
        .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
    }
  });
}

// Máscara live de CEP: NNNNN-NNN.
function _aplicarMascaraCep(input) {
  input.addEventListener("input", () => {
    const digitos = input.value.replace(/\D/g, "").slice(0, 8);
    input.value = digitos.replace(/(\d{5})(\d)/, "$1-$2");
  });
}

// Máscara live de número de processo no padrão CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO (20 dígitos).
function _aplicarMascaraProcessoCNJ(input) {
  input.addEventListener("input", () => {
    const digitos = input.value.replace(/\D/g, "").slice(0, 20);
    input.value = digitos
      .replace(/(\d{7})(\d)/, "$1-$2")
      .replace(/(\d{7}-\d{2})(\d)/, "$1.$2")
      .replace(/(\d{7}-\d{2}\.\d{4})(\d)/, "$1.$2")
      .replace(/(\d{7}-\d{2}\.\d{4}\.\d)(\d)/, "$1.$2")
      .replace(/(\d{7}-\d{2}\.\d{4}\.\d\.\d{2})(\d)/, "$1.$2");
  });
}

// Acha o cliente cadastrado cujo CPF/CNPJ bate com os dígitos informados (ignora a máscara).
function _resolverClientePorCpf(digitos) {
  if (!digitos) return null;
  return _cache.clientes.find((c) => (c.cpf_cnpj || "").replace(/\D/g, "") === digitos) || null;
}

// Aplica as máscaras de CPF/CNPJ e número de processo (CNJ) nos campos que já existem na
// página desde o carregamento - os campos criados dinamicamente (ex.: Pagamentos) recebem a
// máscara direto no próprio trecho que os monta.
for (const id of ["contato-cpf-cnpj"]) {
  const campo = document.getElementById(id);
  if (campo) _aplicarMascaraCpfCnpj(campo);
}
for (const id of ["numero-processo", "pub-numero-processo", "vinculos-numero-processo"]) {
  const campo = document.getElementById(id);
  if (campo) _aplicarMascaraProcessoCNJ(campo);
}

function formatarDataSimples(valor) {
  if (!valor) return "não informado";
  const bruto = String(valor).replace(/^(\d{4})(\d{2})(\d{2})(?:\d{6})?$/, "$1-$2-$3");
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
  document.getElementById("aba-acesso-botao").setAttribute("aria-label", `Acesso: ${texto}`);
}

function conectarComToken(valor) {
  cliente = valor ? new ClienteMCP(valor) : null;
  window.dispatchEvent(new Event("cnj-acesso-alterado"));
  definirStatus(valor ? "Token definido" : "Sem token", valor ? "blue" : "gray");
}

async function validarToken(valor, lembrar, navegar = true) {
  const form = document.getElementById("form-token");
  const botao = form.querySelector("button[type=submit]");
  const resultado = document.getElementById("resultado-token");
  const tentativa = ++geracaoConexao;
  cliente = null;
  window.dispatchEvent(new Event("cnj-acesso-alterado"));
  botao.disabled = true;
  form.setAttribute("aria-busy", "true");
  definirStatus("Verificando…", "gray");
  limpar(resultado);
  try {
    const candidato = new ClienteMCP(valor);
    await window.cnjUI.operacao(() => candidato._iniciar(), { tipo: "interno", rotulo: "Verificando acesso", regiao: form }); // Autentica no servidor, sem consultar APIs judiciais.
    if (tentativa !== geracaoConexao) return;
    cliente = candidato;
    window.dispatchEvent(new Event("cnj-acesso-alterado"));
    try {
      if (lembrar) localStorage.setItem(CHAVE_TOKEN, valor);
      else localStorage.removeItem(CHAVE_TOKEN);
    } catch {
      mostrarAviso(resultado, "Conectado nesta sessão. Não foi possível lembrar o token neste navegador.");
    }
    definirStatus("Conectado", "green");
    if (!resultado.childNodes.length) mostrarSucesso(resultado, "Acesso verificado. Você já pode consultar.");
    if (navegar) await selecionarAba(abas.find((a) => a.painel.id === "aba-processo"));
  } catch (erro) {
    if (tentativa !== geracaoConexao) return;
    cliente = null;
    definirStatus("Não conectado", "red");
    try { localStorage.removeItem(CHAVE_TOKEN); } catch { /* armazenamento indisponível */ }
    mostrarErro(resultado, erro.message);
    await selecionarAba(abas.find((a) => a.painel.id === "aba-acesso"));
    campoToken.focus();
  } finally {
    if (tentativa === geracaoConexao) {
      botao.disabled = false;
      form.removeAttribute("aria-busy");
    }
  }
}
let geracaoConexao = 0;

document.getElementById("form-token").addEventListener("submit", (evento) => {
  evento.preventDefault();
  const valor = campoToken.value.trim();
  if (valor) validarToken(valor, checkboxLembrar.checked);
});

document.getElementById("esquecer-token").addEventListener("click", async () => {
  if (!(await permitirSaidaEdicao())) return;
  ++geracaoConexao;
  try { localStorage.removeItem(CHAVE_TOKEN); } catch { /* armazenamento indisponível */ }
  campoToken.value = "";
  checkboxLembrar.checked = false;
  conectarComToken(null);
  document.querySelector("#form-token button[type=submit]").disabled = false;
  document.getElementById("form-token").removeAttribute("aria-busy");
  limpar(document.getElementById("resultado-token"));
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
    return true;
  } catch {
    mostrarToast("warning", "Não foi possível guardar neste navegador",
      "O histórico ou favorito não foi alterado. Libere o armazenamento do navegador e tente novamente.", 0);
    return false;
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
  if (!_salvarLista(CHAVE_FAVORITOS, lista)) return index !== -1;
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
  if (!_salvarLista(CHAVE_FAVORITOS_CASOS, lista)) return index !== -1;
  return index === -1; // true = acabou de favoritar
}

async function _usarItemRapido(item) {
  if (item.tipo === "processo") {
    if (!(await selecionarAba(abas.find((a) => a.painel.id === "aba-processo")))) return;
    document.getElementById("tribunal").value = item.args.tribunal || "";
    document.getElementById("numero-processo").value = item.args.numero_processo || "";
    formProcesso.requestSubmit();
  } else {
    if (!(await selecionarAba(abas.find((a) => a.painel.id === "aba-publicacoes")))) return;
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
  if (idsFavoritos.length && !_cache.casos.length && cliente) {
    try {
      const resposta = await _buscarJson("/casos");
      _cache.casos = resposta.casos || [];
    } catch {
      // segue com o cache vazio - a lista mostra "Nenhum processo favorito ainda" se não achar nada
    }
  }
  limpar(listaCasosFavoritos);
  const casosFavoritos = idsFavoritos.map((id) => _cache.casos.find((c) => c.id === id)).filter(Boolean);
  if (!casosFavoritos.length) {
    listaCasosFavoritos.appendChild(el("li", { class: "lista-rapida-vazio", texto: "Nenhum processo favorito ainda." }));
    return;
  }
  for (const caso of casosFavoritos) {
    listaCasosFavoritos.appendChild(
      el("li", { class: "lista-rapida-item cds--tile" }, [
        el("span", { texto: caso.titulo ? formatarNomeExibicao(caso.titulo) : "(sem título)" }),
        el("div", {}, [
          el("button", {
            class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "Abrir",
            onclick: async () => {
              if (!(await selecionarAba(abas.find((a) => a.painel.id === "aba-casos")))) return;
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
        el("span", { texto: `${(fav.tribunal || "?").toUpperCase()} · ${formatarNumeroCNJ(fav.numero)}` }),
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
  { botao: document.getElementById("aba-atividades-botao"), painel: document.getElementById("aba-atividades") },
  { botao: document.getElementById("aba-publicacoes-oab-botao"), painel: document.getElementById("aba-publicacoes-oab") },
  { botao: document.getElementById("aba-integracoes-botao"), painel: document.getElementById("aba-integracoes") },
  { botao: document.getElementById("aba-financeiro-botao"), painel: document.getElementById("aba-financeiro") },
  { botao: document.getElementById("aba-pagamentos-botao"), painel: document.getElementById("aba-pagamentos") },
];

async function selecionarAba(alvo, { registrarHistorico = true } = {}) {
  if (!alvo) return false;
  const atual = abas.find((aba) => !aba.painel.hidden);
  if (atual && !(await permitirSaidaEdicao(atual.painel))) return false;
  if (registrarHistorico && window.location.hash !== `#${alvo.painel.id}`) {
    window.history.pushState(null, "", `#${alvo.painel.id}`);
  }
  for (const aba of abas) {
    const ativa = aba === alvo;
    aba.botao.setAttribute("aria-selected", String(ativa));
    aba.botao.tabIndex = ativa ? 0 : -1;
    aba.painel.hidden = !ativa;
  }
  // Expande o grupo do item ativo caso esteja colapsado
  const submenu = alvo.botao.closest(".cds--side-nav__item")?.querySelector(".cds--side-nav__submenu");
  if (submenu) submenu.setAttribute("aria-expanded", "true");
  if (_mqMobile.matches) {
    _sideNavFechar();
    alvo.painel.tabIndex = -1;
    alvo.painel.focus();
  } else alvo.botao.focus();
  if (alvo.painel.id === "aba-historico") { renderizarListaRapida(); renderizarCasosFavoritos(); }
  if (alvo.painel.id === "aba-monitoramentos") carregarMonitoramentos("pagina");
  if (alvo.painel.id === "aba-contatos") { voltarParaContatos(); carregarContatos("pagina"); }
  if (alvo.painel.id === "aba-casos") carregarCasosPagina("pagina");
  if (alvo.painel.id === "aba-atividades") carregarAtividadesAbertas("pagina");
  if (alvo.painel.id === "aba-publicacoes-oab") carregarPublicacoesOab("pagina");
  if (alvo.painel.id === "aba-integracoes") carregarStatusIntegracoes("pagina");
  if (alvo.painel.id === "aba-financeiro") carregarLancamentos("pagina");
  if (alvo.painel.id === "aba-pagamentos") carregarPagamentos("pagina");
  return true;
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
    }, [el("span", { class: "cds--content-switcher__label", texto: rotulo })]);
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
  card.appendChild(el("p", { texto: `Número: ${formatarNumeroCNJ(proc.numeroProcesso) || "não informado"}` }));
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

let _sequenciaPainelPrazo = 0;

function painelCalculoPrazo(item) {
  const dataBase = (item.data_disponibilizacao || "").slice(0, 10);
  const tribunal = (item.siglaTribunal || "").toLowerCase() || "tjsp";
  const painel = el("div", { class: "prazo-painel", hidden: "" });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataBase)) {
    painel.appendChild(notificacao("warning", "Atenção", "Publicação sem data de disponibilização - não é possível calcular o prazo."));
    return painel;
  }

  const prefixo = `prazo-${++_sequenciaPainelPrazo}`;
  let municipioInicial = "São Paulo";
  let avisoPreferencia = "";
  try {
    municipioInicial = localStorage.getItem(CHAVE_PRAZO_MUNICIPIO) || municipioInicial;
  } catch {
    avisoPreferencia = "Não foi possível ler a preferência de município neste navegador. São Paulo foi preenchido como padrão; confira o município antes de calcular.";
  }
  const preferenciaEl = el("p", { id: `${prefixo}-preferencia`, class: "campo-ajuda prazo-preferencia-status", role: "status", texto: avisoPreferencia });
  preferenciaEl.hidden = !avisoPreferencia;
  const campoDias = el("input", { id: `${prefixo}-dias`, class: "cds--text-input", type: "number", min: "1", value: "15" });
  const campoTipo = el(
    "select",
    { id: `${prefixo}-tipo`, class: "cds--select-input" },
    TIPOS_CONTAGEM_PRAZO.map((t) => el("option", { value: t.valor, texto: t.rotulo }))
  );
  const campoMunicipio = el("input", {
    id: `${prefixo}-municipio`,
    class: "cds--text-input",
    type: "text",
    value: municipioInicial,
    "aria-describedby": preferenciaEl.id,
  });
  const botaoCalcular = el("button", { class: "cds--btn cds--btn--primary cds--btn--sm", type: "button", texto: "Calcular" });
  const resultadoEl = el("div", { class: "prazo-resultado" });

  const fonteFeriados = tribunal === "tjsp" ? "feriados forenses do TJSP (fonte oficial)" : `feriados nacionais + estaduais calculados para ${tribunal.toUpperCase()}`;
  painel.appendChild(
    el("p", { class: "campo-ajuda", texto: `Base: disponibilizado em ${formatarDataSimples(dataBase)}. A contagem exclui sábados, domingos e ${fonteFeriados}.` })
  );
  painel.appendChild(
    el("div", { class: "prazo-painel-grade" }, [
      el("div", { class: "cds--form-item" }, [el("label", { class: "cds--label", for: campoDias.id, texto: "Dias" }), campoDias]),
      el("div", { class: "cds--form-item" }, [el("label", { class: "cds--label", for: campoTipo.id, texto: "Contagem a partir de" }), campoTipo]),
      el("div", { class: "cds--form-item" }, [el("label", { class: "cds--label", for: campoMunicipio.id, texto: "Município/comarca" }), campoMunicipio]),
    ])
  );
  painel.appendChild(preferenciaEl);
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
    try {
      localStorage.setItem(CHAVE_PRAZO_MUNICIPIO, municipio);
      preferenciaEl.textContent = "";
      preferenciaEl.hidden = true;
    } catch {
      preferenciaEl.textContent = "Não foi possível lembrar o município neste navegador. O cálculo continuará com o município informado.";
      preferenciaEl.hidden = false;
    }
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
      rotulo: "Cadastrar cliente e processo",
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
          ? `Publicações do processo ${formatarNumeroCNJ(args.numero_processo)}`
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
  const inicio = _ddmmaaaaParaIso(document.getElementById("pub-data-inicio").value);
  if (inicio) args.data_disponibilizacao_inicio = inicio;
  const fim = _ddmmaaaaParaIso(document.getElementById("pub-data-fim").value);
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
  if (criterio.numero_processo) return `Processo ${formatarNumeroCNJ(criterio.numero_processo)}`;
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

async function carregarMonitoramentos(tipoFeedback = "interno") {
  const feedback = { tipo: tipoFeedback === "pagina" ? "pagina" : "interno", regiao: document.getElementById("resultado-monitoramentos") };
  if (!exigirCliente(resultadoMonitoramentos)) return;
  limpar(resultadoMonitoramentos);
  try {
    const dados = await cliente.chamarTool("listar_monitoramentos", {}, feedback);
    limpar(resultadoMonitoramentos);
    if (dados.erro) {
      resultadoMonitoramentos.appendChild(notificacao("error", "Não foi possível carregar", dados.mensagem));
      return;
    }
    resultadoMonitoramentos.appendChild(el("p", { class: "campo-ajuda", texto: `Lista carregada em ${new Date().toLocaleString("pt-BR")}. Atualizar esta lista não dispara uma verificação no DJEN.` }));
    const lista = dados.monitoramentos || [];
    if (!lista.length) {
      resultadoMonitoramentos.appendChild(notificacao("info", "Nenhum monitoramento ativo", "Use a ação de monitoramento em Consultar processo ou Consultar publicações para criar um."));
      return;
    }
    for (const m of lista) resultadoMonitoramentos.appendChild(cartaoMonitoramento(m));
  } catch (erro) {
    limpar(resultadoMonitoramentos);
    mostrarErro(resultadoMonitoramentos, erro.message);
  }
}

async function carregarStatusIntegracoes(tipo = "interno") {
  return window.cnjUI.operacao(() => carregarStatusIntegracoesSemProgresso(), {
    tipo: tipo === "pagina" ? "pagina" : "interno", rotulo: "Verificando integrações", regiao: document.getElementById("integracoes-resultado"),
  });
}

async function carregarStatusIntegracoesSemProgresso() {
  const seloGoogle = document.getElementById("integracao-google-status");
  const seloAsaas = document.getElementById("integracao-asaas-status");
  const resultado = document.getElementById("integracoes-resultado");
  limpar(resultado);
  if (!cliente) {
    for (const selo of [seloGoogle, seloAsaas]) selo.textContent = "Acesso necessário";
    mostrarAviso(resultado, "Conecte-se na aba Acesso para verificar a configuração dos serviços.");
    return { ok: false, mensagem: "Conecte-se para verificar as integrações." };
  }
  for (const selo of [seloGoogle, seloAsaas]) {
    if (!selo) continue;
    selo.textContent = "Verificando…";
    selo.className = "cds--tag cds--tag--sm";
  }
  try {
    const resposta = await fetch("/integracoes/status", { headers: { Authorization: `Bearer ${cliente.token}` } });
    if (!resposta.ok) throw new ErroMCP(resposta.status, resposta.status === 401
      ? "Acesso expirado. Conecte-se novamente na aba Acesso."
      : `Falha ao verificar os serviços (HTTP ${resposta.status}). Tente novamente.`);
    const dados = await resposta.json();
    if (typeof dados.google !== "boolean" || typeof dados.asaas !== "boolean") throw new Error("Resposta de configuração inválida. Tente novamente.");
    for (const [selo, conectado] of [[seloGoogle, dados.google], [seloAsaas, dados.asaas], [document.getElementById("integracao-zapsign-status"), dados.zapsign === true]]) {
      if (!selo) continue;
      if (conectado) {
        selo.textContent = "Configurado";
        selo.className = "cds--tag cds--tag--green cds--tag--sm";
      } else {
        selo.textContent = "Não configurado";
        selo.className = "cds--tag cds--tag--gray cds--tag--sm";
      }
    }
  } catch (erro) {
    mostrarErro(resultado, erro instanceof SyntaxError
      ? "O servidor retornou uma resposta inválida. Tente novamente."
      : erro instanceof TypeError ? "Não foi possível conectar. Confira sua conexão e tente novamente."
      : erro.message || "Não foi possível verificar. Confira sua conexão e tente novamente.");
    for (const selo of [seloGoogle, seloAsaas]) {
      if (!selo) continue;
      selo.textContent = erro.status === 401 ? "Acesso necessário" : "Falha na verificação";
      selo.className = "cds--tag cds--tag--gray cds--tag--sm";
    }
    return { ok: false, mensagem: resultado.textContent };
  }
}

document.getElementById("integracoes-atualizar").addEventListener("click", carregarStatusIntegracoes);

// --- Jurimetria: seletores de árvore (Vara/Classe/Assunto) e autocomplete (Magistrado) --------
//
// As árvores (Vara/Classe/Assunto) e a lista de Magistrados vêm de endpoints HTTP simples
// (não tools MCP - são só suporte de UI, ver server.py). Usam o mesmo token Bearer do /mcp.

async function _buscarJson(url, feedback = {}) {
  return window.cnjUI.operacao(() => _buscarJsonSemProgresso(url), {
    tipo: window.cnjUI.tipoRequisicao(url), rotulo: "Consultando informações", ...feedback,
  });
}

async function _buscarJsonSemProgresso(url) {
  if (!cliente) throw new ErroMCP(401, "Conecte-se primeiro.");
  const resposta = await fetch(url, { headers: { Authorization: `Bearer ${cliente.token}` } });
  if (!resposta.ok) {
    const dados = await resposta.json().catch(() => ({}));
    throw new ErroMCP(resposta.status, dados.mensagem || `Falha ao consultar ${url} (HTTP ${resposta.status}).`);
  }
  return resposta.json();
}

async function _enviarJson(url, corpo, metodo = "POST", cabecalhos = {}) {
  return window.cnjUI.operacao(() => _enviarJsonSemProgresso(url, corpo, metodo, cabecalhos), {
    tipo: window.cnjUI.tipoRequisicao(url, metodo), rotulo: "Enviando informações",
  });
}

async function _enviarJsonSemProgresso(url, corpo, metodo = "POST", cabecalhos = {}) {
  if (!cliente) throw new ErroMCP(401, "Conecte-se primeiro.");
  const resposta = await fetch(url, {
    method: metodo,
    headers: { ...cabecalhos, Authorization: `Bearer ${cliente.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new ErroMCP(resposta.status, dados.mensagem || `Falha ao enviar para ${url} (HTTP ${resposta.status}).`);
  return dados;
}

function criarSeletorArvore(container, campo) {
  const selecionados = new Map(); // id -> {nome, busca}

  const busca = el("div", { class: "seletor-arvore-busca" }, [
    el("input", { class: "cds--text-input", type: "text", id: `jur-seletor-${campo}`, autocomplete: "off", placeholder: `Buscar ${campo}… (mín. 2 letras)` }),
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
  card.appendChild(el("h3", { texto: formatarNumeroCNJ(item.numero_processo) || "Número não identificado" }));
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

// --- Seções de formulário e confirmação na própria página ------------------
// Os identificadores antigos são mantidos para os chamadores de cada fluxo.
const secoesAbertas = [];

function abrirModal(id) {
  const secao = document.getElementById(id);
  if (!secao || secao.classList.contains("is-visible")) return;
  const origem = document.activeElement;
  const primeiroModal = secoesAbertas.length === 0;
  const anterior = secoesAbertas.at(-1)?.secao;
  if (secao.matches("cds-modal.app-modal")) secao.open = true;
  else if (anterior && !anterior.matches("cds-modal.app-modal")) anterior.after(secao);
  else document.getElementById("conteudo").prepend(secao);
  const fundo = secao.id === "modal-honorario" ? [...document.body.children]
    .filter((item) => !item.matches("cds-modal, script, style, link") && item.id !== "toast-global")
    .map((item) => ({ item, inert: item.inert })) : [];
  for (const { item } of fundo) item.inert = true;
  secoesAbertas.push({ secao, origem, fundo });
  secao.style.zIndex = String(9000 + secoesAbertas.length);
  if (anterior) anterior.inert = true;
  if (primeiroModal) document.body.classList.add("sem-rolagem");
  secao.classList.add("is-visible");
  secao.tabIndex = -1;
  for (const form of secao.querySelectorAll("form")) marcarFormularioSalvo(form, true);
  if (!secao.matches("cds-modal.app-modal")) secao.focus();
}

async function fecharModal(id) {
  if (id === "modal-clientes-lote" && _clientesLote?.enviando) return false;
  const secao = document.getElementById(id);
  if (!secao?.classList.contains("is-visible")) return true;
  if (formulariosPendentes(secao).length && !(await permitirSaidaEdicao(secao))) return false;
  const indice = secoesAbertas.findIndex((item) => item.secao === secao);
  const entrada = indice >= 0 ? secoesAbertas.splice(indice, 1)[0] : null;
  secao.classList.remove("is-visible");
  if (secao.matches("cds-modal.app-modal")) secao.open = false;
  for (const { item, inert } of entrada?.fundo || []) item.inert = inert;
  if (id === "modal-honorario") document.getElementById("honorario-vencimento")._flatpickr?.close();
  secao.style.zIndex = "";
  secao.inert = false;
  const anterior = secoesAbertas.at(-1)?.secao;
  if (anterior) anterior.inert = false;
  if (!secoesAbertas.length) document.body.classList.remove("sem-rolagem");
  if (entrada?.origem?.isConnected && entrada.origem.getClientRects().length) entrada.origem.focus();
  return true;
}

document.addEventListener("keydown", (ev) => {
  const secao = ev.target.closest(".fluxo-pagina.is-visible");
  if (secao && ev.key === "Escape" && !ev.defaultPrevented) {
    ev.preventDefault();
    fecharModal(secao.id);
  }
});

document.addEventListener("click", (ev) => {
  const alvo = ev.target.closest("[data-fechar-modal]");
  if (alvo) { fecharModal(alvo.dataset.fecharModal); return; }
  if (ev.target.classList.contains("fluxo-pagina") && ev.target.classList.contains("is-visible")) {
    fecharModal(ev.target.id);
  }
});

window.cnjUI.fecharModal = fecharModal;

function escolherSaidaEdicao() {
  return new Promise((resolve) => {
    const modal = document.getElementById("modal-edicao-pendente");
    function concluir(escolha) {
      modal.removeEventListener("click", aoClicar);
      modal.removeEventListener("keydown", aoTeclado);
      fecharModal(modal.id);
      resolve(escolha);
    }
    function aoClicar(ev) {
      const escolha = ev.target.closest("[data-escolha-edicao]")?.dataset.escolhaEdicao;
      if (escolha || ev.target === modal) concluir(escolha || "continuar");
    }
    function aoTeclado(ev) {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); concluir("continuar"); }
    }
    modal.addEventListener("click", aoClicar);
    modal.addEventListener("keydown", aoTeclado);
    abrirModal(modal.id);
    document.getElementById("edicao-continuar").focus();
  });
}

// Confirmação na própria página: devolve uma Promise<boolean> (true = confirmou).
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
    const aoTeclado = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); concluir(false); } };
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
function _fecharTodosComboMenusOab(restaurarFoco = false) {
  document.querySelectorAll(".pub-oab-combo-menu:not([hidden])").forEach((menu) => {
    const tinhaFoco = menu.contains(document.activeElement);
    if (menu.matches(":popover-open")) menu.hidePopover();
    menu.hidden = true;
    menu.classList.remove("cds--menu--open", "cds--menu--shown");
    const trigger = menu.closest(".pub-oab-combo")?.querySelector(".cds--menu-button__trigger");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "false");
      if (restaurarFoco && tinhaFoco) trigger.focus();
    }
  });
}
function _posicionarMenuPubOab(menu) {
  const trigger = menu.closest(".pub-oab-combo")?.querySelector(".cds--menu-button__trigger");
  if (!trigger) return;
  const ancora = trigger.getBoundingClientRect();
  const tamanho = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(ancora.right - tamanho.width, window.innerWidth - tamanho.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(window.innerHeight - tamanho.height - 8,
    ancora.bottom + tamanho.height <= window.innerHeight - 8 ? ancora.bottom : ancora.top - tamanho.height))}px`;
}
window.addEventListener("resize", () => _fecharTodosComboMenusOab(true));
document.addEventListener("scroll", (ev) => {
  if (!ev.target.closest?.(".pub-oab-combo-menu")) {
    document.querySelectorAll(".pub-oab-combo-menu:popover-open").forEach(_posicionarMenuPubOab);
  }
}, true);
document.addEventListener("click", (ev) => {
  if (!ev.target.closest(".pub-oab-combo")) _fecharTodosComboMenusOab();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !ev.defaultPrevented) {
    const destino = !_painelBusca.hidden ? _btnBuscaToggle : !_painelNotificacoes.hidden ? _btnNotificacoesToggle : null;

    _fecharTodosComboMenusOab(true);
    // Painéis do header (notificações e busca). As funções são declaradas no fim do arquivo
    // (function declarations são hoisted, então já existem quando este listener dispara).
    _fecharPainelNotificacoes();
    _fecharPainelBusca();
    destino?.focus();
  }
});

// --- Clientes e casos (Fase 1 da gestão de escritório) ------------------------------------
//
// /clientes e /casos são endpoints HTTP simples (não tools MCP, mesmo padrão das árvores do
// CJPG acima): CRUD de apoio ao painel, não faz sentido expor isso a um agente de IA.

const _cache = { clientes: [], casos: [] };
let _filtroCasos = "";
let _visualizacaoCasos = "tabela";

function linhaContato(c) {
  const tr = el("tr", {});
  const checkbox = el("input", { type: "checkbox", "aria-label": `Selecionar ${c.nome}`, "data-selecionar-cliente": c.id });
  checkbox.checked = _clientesSelecionados.has(c.id);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) _clientesSelecionados.add(c.id); else _clientesSelecionados.delete(c.id);
    _atualizarSelecaoClientes();
  });
  tr.appendChild(el("td", { "data-label": "Selecionar" }, [checkbox]));

  const botaoNome = el("button", { class: "contato-nome-link", type: "button", texto: formatarNomeExibicao(c.nome), "data-cliente-id": c.id });
  botaoNome.addEventListener("click", () => abrirContato(c.id));
  tr.appendChild(el("td", { "data-label": "Nome" }, [botaoNome]));
  tr.appendChild(el("td", { "data-label": "Tipo", texto: ({ fisica: "Pessoa física", juridica: "Pessoa jurídica" })[c.tipo_pessoa] || "Não informado" }));
  tr.appendChild(el("td", { "data-label": "Perfil", texto: c.perfil === "contato" ? "Contato" : c.perfil === "cliente" ? "Cliente" : "Não informado" }));

  tr.appendChild(el("td", { "data-label": "Telefone" }, [
    _canalContato(c.telefone, "telefone"),
  ]));
  tr.appendChild(el("td", { "data-label": "E-mail" }, [
    _canalContato(c.email, "email"),
  ]));
  const etiquetas = el("td", { "data-label": "Etiquetas" });
  for (const nome of c.etiquetas || []) etiquetas.appendChild(el("span", { class: "cliente-etiqueta", texto: nome }));
  if (!(c.etiquetas || []).length) etiquetas.textContent = "Sem etiquetas";
  tr.appendChild(etiquetas);

  const botaoExcluir = el("button", {
    class: "cds--btn cds--btn--danger--tertiary cds--btn--sm contato-excluir-lista", type: "button", texto: "Excluir",
  });
  botaoExcluir.addEventListener("click", () => excluirContato(c.id, c.nome, botaoExcluir));
  tr.appendChild(el("td", { "data-label": "Ações" }, [botaoExcluir]));
  return tr;
}

function _canalContato(valor, tipo) {
  const texto = String(valor || "").trim();
  if (!texto) return el("span", { class: "contato-sem-dado", texto: "Não informado" });
  let href;
  if (tipo === "email" && /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(texto)) href = `mailto:${encodeURIComponent(texto)}`;
  if (tipo === "telefone" && /^\+?[\d\s().-]+$/.test(texto) && texto.replace(/\D/g, "").length >= 8) {
    href = `tel:${texto.replace(/[^\d+]/g, "")}`;
  }
  return el(href ? "a" : "span", { ...(href ? { href } : {}), texto });
}

async function excluirContato(clienteId, nome, botao) {
  if (!(await confirmarAcao(`Excluir o cliente "${nome}"? Essa ação não pode ser desfeita.`))) return;
  botao.disabled = true;
  try {
    await _enviarJson(`/clientes/${clienteId}`, {}, "DELETE");
    _cache.clientes = _cache.clientes.filter((c) => c.id !== clienteId);
    renderizarListaContatos();
  } catch (erro) {
    mostrarToast("error", "Erro", erro.message);
    botao.disabled = false;
  }
}

function tabelaContatos(contatos) {
  const todos = el("input", { type: "checkbox", id: "clientes-selecionar-todos", "aria-label": "Selecionar todos os clientes exibidos" });
  const todosMobile = el("input", { type: "checkbox", id: "clientes-selecionar-todos-mobile" });
  const selecionarTodos = evento => {
    for (const c of contatos) { if (evento.target.checked) _clientesSelecionados.add(c.id); else _clientesSelecionados.delete(c.id); }
    for (const checkbox of document.querySelectorAll("[data-selecionar-cliente]")) checkbox.checked = _clientesSelecionados.has(checkbox.dataset.selecionarCliente);
    _atualizarSelecaoClientes();
  };
  todos.addEventListener("change", selecionarTodos);
  todosMobile.addEventListener("change", selecionarTodos);
  const thead = el("thead", {}, [
    el("tr", {}, [
      el("th", { scope: "col" }, [todos]),
      ...["Nome", "Tipo", "Perfil", "Telefone", "E-mail", "Etiquetas", "Ações"].map((texto) => el("th", { scope: "col", texto })),
    ]),
  ]);
  const tbody = el("tbody", {});
  for (const c of contatos) tbody.appendChild(linhaContato(c));
  return el("div", { class: "tabela-responsiva-wrap" }, [el("label", { class: "clientes-selecao-mobile" }, [todosMobile, "Selecionar todos os clientes exibidos"]), el("table", { class: "tabela-responsiva contatos-tabela" }, [thead, tbody])]);
}

let _contatosFiltroLetra = "TODOS";
let _contatosFiltroBusca = "";
let _contatoOrigemId = null;
const _clientesSelecionados = new Set();
let _clientesLote = null;

function _atualizarSelecaoClientes() {
  const visiveis = _contatosFiltrados();
  const ids = new Set(visiveis.map(c => c.id));
  for (const id of _clientesSelecionados) if (!ids.has(id)) _clientesSelecionados.delete(id);
  document.getElementById("clientes-lote-barra").hidden = !_clientesSelecionados.size;
  document.getElementById("clientes-lote-quantidade").textContent = `${_clientesSelecionados.size} cliente(s) selecionado(s)`;
  for (const todos of document.querySelectorAll("#clientes-selecionar-todos, #clientes-selecionar-todos-mobile")) {
    todos.checked = visiveis.length > 0 && _clientesSelecionados.size === visiveis.length;
    todos.indeterminate = _clientesSelecionados.size > 0 && _clientesSelecionados.size < visiveis.length;
  }
}

function _limparSelecaoClientes() {
  const havia = _clientesSelecionados.size > 0;
  _clientesSelecionados.clear();
  if (havia) document.getElementById("clientes-lote-aviso").textContent = "Seleção de clientes limpa.";
}

function abrirClientesLote(tipo) {
  if (!_clientesSelecionados.size) return;
  if (_clientesSelecionados.size > 200) { mostrarToast("error", "Seleção", "Selecione no máximo 200 clientes por operação."); return; }
  _clientesLote = { tipo, ids: [..._clientesSelecionados], pedido: null, previa: null, enviando: false };
  document.getElementById("clientes-lote-titulo").textContent = tipo === "perfil" ? "Atualizar perfil" : "Gerenciar etiquetas";
  document.getElementById("clientes-lote-contexto").textContent = `${_clientesLote.ids.length} cliente(s) selecionado(s). Limite de 200 por operação.`;
  document.getElementById("clientes-lote-config-etiquetas").hidden = tipo === "perfil";
  document.getElementById("clientes-lote-config-perfil").hidden = tipo !== "perfil";
  document.getElementById("clientes-lote-operacao").value = "aplicar_etiquetas";
  document.getElementById("clientes-lote-nova").value = "";
  document.getElementById("clientes-lote-nova-campo").hidden = false;
  const opcoes = document.getElementById("clientes-lote-etiquetas-opcoes");
  limpar(opcoes);
  const etiquetas = [...new Set(_cache.clientes.flatMap(c => c.etiquetas || []))].sort((a, b) => a.localeCompare(b));
  for (const nome of etiquetas) opcoes.appendChild(el("label", {}, [el("input", { type: "checkbox", value: nome }), nome]));
  if (!etiquetas.length) opcoes.appendChild(el("p", { class: "campo-ajuda", texto: "Nenhuma etiqueta aplicada ainda. Digite uma nova etiqueta abaixo." }));
  _configurarClientesLote();
  abrirModal("modal-clientes-lote");
}

function _configurarClientesLote() {
  _clientesLote.previa = null;
  document.getElementById("clientes-lote-configurar").hidden = false;
  document.getElementById("clientes-lote-revisao").hidden = true;
  document.getElementById("clientes-lote-voltar").hidden = true;
  document.getElementById("clientes-lote-confirmar").textContent = "Revisar alterações";
  document.getElementById("clientes-lote-confirmar").disabled = false;
  limpar(document.getElementById("clientes-lote-resultado"));
}

async function executarClientesLote() {
  if (!_clientesLote || _clientesLote.enviando) return;
  const estado = _clientesLote;
  const resultado = document.getElementById("clientes-lote-resultado");
  const modal = document.getElementById("modal-clientes-lote");
  const confirmar = Boolean(estado.previa);
  if (!confirmar) {
    const acao = estado.tipo === "perfil" ? "perfil" : document.getElementById("clientes-lote-operacao").value;
    const etiquetas = [...document.querySelectorAll("#clientes-lote-etiquetas-opcoes input:checked")].map(input => input.value);
    const nova = document.getElementById("clientes-lote-nova").value.trim();
    if (acao === "aplicar_etiquetas" && nova) etiquetas.push(nova);
    estado.pedido = { ids: estado.ids, acao, ...(acao === "perfil" ? { perfil: document.getElementById("clientes-lote-novo-perfil").value } : { etiquetas }) };
  }
  estado.enviando = true;
  limpar(resultado);
  const controles = [...modal.querySelectorAll("button, input, select, cds-modal-close-button")];
  const anteriores = controles.map(controle => controle.disabled);
  controles.forEach(controle => { controle.disabled = true; });
  try {
    const resposta = await _enviarJson("/clientes/acoes-em-massa", { ...estado.pedido, confirmar, ...(confirmar ? { esperado: estado.previa.esperado } : {}) });
    if (confirmar) {
      for (const mudanca of resposta.mudancas) {
        const cliente = _cache.clientes.find(c => c.id === mudanca.id);
        if (cliente) cliente[estado.pedido.acao === "perfil" ? "perfil" : "etiquetas"] = mudanca.depois;
      }
      _limparSelecaoClientes();
      estado.enviando = false;
      await fecharModal("modal-clientes-lote");
      renderizarListaContatos();
      document.getElementById("contatos-titulo").focus();
      mostrarToast("success", "Clientes atualizados", `${resposta.alterados} alterado(s); ${resposta.sem_alteracao} sem alteração.`);
    } else {
      estado.previa = resposta;
      const tabela = el("table", { class: "tabela-responsiva clientes-lote-preview" }, [el("thead", {}, [el("tr", {}, ["Cliente", "Atual", "Após confirmar"].map(texto => el("th", { scope: "col", texto })))])]);
      const corpo = el("tbody");
      const formatar = valor => Array.isArray(valor) ? valor.join(", ") || "Sem etiquetas" : valor === "cliente" ? "Cliente" : "Contato";
      for (const m of resposta.mudancas) corpo.appendChild(el("tr", {}, [el("td", { "data-label": "Cliente", texto: m.nome }), el("td", { "data-label": "Atual", texto: formatar(m.atual) }), el("td", { "data-label": "Após confirmar", texto: `${formatar(m.depois)}${m.alterado ? "" : " · Sem alteração"}` })]));
      tabela.appendChild(corpo);
      const container = document.getElementById("clientes-lote-mudancas");
      limpar(container); container.appendChild(el("div", { class: "tabela-responsiva-wrap" }, [tabela]));
      document.getElementById("clientes-lote-resumo").textContent = `${resposta.alterados} cliente(s) serão alterados; ${resposta.sem_alteracao} sem alteração.`;
      document.getElementById("clientes-lote-configurar").hidden = true;
      document.getElementById("clientes-lote-revisao").hidden = false;
      document.getElementById("clientes-lote-voltar").hidden = false;
      document.getElementById("clientes-lote-confirmar").textContent = "Confirmar alterações";
      document.getElementById("clientes-lote-resumo").focus();
    }
  } catch (erro) {
    mostrarErro(resultado, erro.message);
  } finally {
    estado.enviando = false;
    controles.forEach((controle, i) => { controle.disabled = anteriores[i]; });
    document.getElementById("clientes-lote-confirmar").disabled = Boolean(estado.previa && !estado.previa.alterados);
  }
}

function _normalizarConsultaContato(valor) {
  return String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function limparFiltrosContatos() {
  _limparSelecaoClientes();
  _contatosFiltroLetra = "TODOS";
  _contatosFiltroBusca = "";
  document.getElementById("contatos-busca").value = "";
  for (const botao of document.getElementById("contatos-az").children) botao.setAttribute("aria-pressed", String(botao.textContent === "TODOS"));
  renderizarListaContatos();
  document.getElementById("contatos-busca").focus();
}

function _contatosFiltrados() {
  const consulta = _normalizarConsultaContato(_contatosFiltroBusca);
  const digitos = consulta.replace(/\D/g, "");
  return _cache.clientes.filter((c) => {
    if (_contatosFiltroLetra !== "TODOS") {
      const inicial = _normalizarConsultaContato(c.nome).charAt(0).toUpperCase();
      if (inicial !== _contatosFiltroLetra) return false;
    }
    if (consulta) {
      const alvo = _normalizarConsultaContato(`${c.nome || ""} ${c.telefone || ""} ${c.email || ""}`);
      const telefoneCombina = digitos && /^[+\d\s().-]+$/.test(consulta) && String(c.telefone || "").replace(/\D/g, "").includes(digitos);
      if (!alvo.includes(consulta) && !telefoneCombina) return false;
    }
    return true;
  });
}

function renderizarListaContatos() {
  const listaContatosEl = document.getElementById("lista-contatos");
  limpar(listaContatosEl);
  _atualizarSelecaoClientes();
  const filtrados = _contatosFiltrados();
  const filtros = [
    ...(_contatosFiltroLetra !== "TODOS" ? [`Inicial: ${_contatosFiltroLetra}`] : []),
    ...(_contatosFiltroBusca.trim() ? [`Texto: “${_contatosFiltroBusca.trim()}”`] : []),
  ];
  document.getElementById("contatos-status").textContent = `Mostrando ${filtrados.length} de ${_cache.clientes.length} cliente(s). ${filtros.join("; ") || "Sem filtros ativos"}.`;
  document.getElementById("contatos-limpar-filtros").hidden = !filtros.length;
  if (!_cache.clientes.length) {
    listaContatosEl.appendChild(notificacao("info", "Nenhum cliente cadastrado ainda"));
    return;
  }
  if (!filtrados.length) {
    listaContatosEl.appendChild(notificacao("info", "Nenhum cliente corresponde aos filtros. Confira o texto ou use Limpar filtros para ver todos os clientes."));
    return;
  }
  listaContatosEl.appendChild(tabelaContatos(filtrados));
  _atualizarSelecaoClientes();
}

function _construirBarraAZ() {
  const container = document.getElementById("contatos-az");
  if (container.childElementCount) return; // já construída
  const letras = ["TODOS", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")];
  for (const letra of letras) {
    const botao = el("button", { type: "button", texto: letra, "aria-pressed": String(letra === _contatosFiltroLetra) });
    botao.addEventListener("click", () => {
      _limparSelecaoClientes();
      _contatosFiltroLetra = letra;
      for (const filho of container.children) filho.setAttribute("aria-pressed", String(filho.textContent === letra));
      renderizarListaContatos();
    });
    container.appendChild(botao);
  }
}

// Alterna a sub-aba "Cadastro"/tela de detalhe entre criar um cliente novo (sem id ainda,
// sem processos vinculados, sem botão de excluir) e editar um já existente.
function _definirModoCadastroContato(modo) {
  const ehNovo = modo === "novo";
  document.getElementById("contato-subaba-processos-botao").hidden = ehNovo;
  document.getElementById("contato-subaba-financeiro-botao").hidden = ehNovo;
  document.getElementById("contato-excluir").hidden = ehNovo;
  document.getElementById("contato-salvar-botao").textContent = ehNovo ? "Cadastrar cliente" : "Salvar alterações";
}

// Cadastro de cliente não usa modal: abre a mesma tela de detalhe, em branco, pronta para criar.
async function abrirNovoContato() {
  if (!(await permitirSaidaEdicao())) return;
  _contatoOrigemId = null;
  document.getElementById("contatos-vista-lista").hidden = true;
  document.getElementById("contatos-vista-detalhe").hidden = false;
  document.getElementById("contato-detalhe-nome").textContent = "Novo cliente";
  _selecionarSubabaContato("cadastro");
  _definirModoCadastroContato("novo");
  limpar(document.getElementById("resultado-contato-cadastro"));
  formContatoCadastro.reset();
  formContatoCadastro.dataset.clienteId = "";
  _selecionarAbaCadastro("contato", "pessoal");
  definirTipoPessoaContato("fisica");
  definirPerfilContato("cliente");
  gruposContato.telefones.definirValores([]);
  gruposContato.emails.definirValores([]);
  gruposContato.sites.definirValores([]);
  gruposContato.enderecos.definirValores([]);
  marcarFormularioSalvo(formContatoCadastro, true);
  document.getElementById("contato-nome").focus();
}

async function abrirContato(clienteId, tipoFeedback = "pagina") {
  const feedback = { tipo: tipoFeedback === "pagina" ? "pagina" : "interno", regiao: document.getElementById("contatos-vista-detalhe") };
  if (!(await permitirSaidaEdicao())) return;
  _contatoOrigemId = clienteId;
  document.getElementById("contatos-vista-lista").hidden = true;
  document.getElementById("contatos-vista-detalhe").hidden = false;
  document.getElementById("contato-detalhe-nome").textContent = "Carregando…";
  document.getElementById("contato-detalhe-nome").focus();
  _selecionarSubabaContato("cadastro");
  _definirModoCadastroContato("existente");
  const resultadoContatoCadastro = document.getElementById("resultado-contato-cadastro");
  limpar(resultadoContatoCadastro);
  try {
    const cliente_registro = await _buscarJson(`/clientes/${clienteId}`, feedback);
    document.getElementById("contato-detalhe-nome").textContent = cliente_registro.nome ? formatarNomeExibicao(cliente_registro.nome) : "(sem nome)";
    document.getElementById("contato-nome").value = cliente_registro.nome || "";
    document.getElementById("contato-cpf-cnpj").value = cliente_registro.cpf_cnpj || "";
    document.getElementById("contato-observacoes").value = cliente_registro.observacoes || "";
    _selecionarAbaCadastro("contato", "pessoal");
    _preencherCadastroCompleto(
      "contato", gruposContato, cliente_registro, definirTipoPessoaContato, definirPerfilContato,
    );
    formContatoCadastro.dataset.clienteId = clienteId;
    marcarFormularioSalvo(formContatoCadastro, true);
    await _renderizarProcessosVinculados(clienteId);
  } catch (erro) {
    document.getElementById("contato-detalhe-nome").textContent = "Erro ao carregar cliente";
    mostrarErro(resultadoContatoCadastro, erro.message);
  }
}

async function voltarParaContatos() {
  if (!(await permitirSaidaEdicao(document.getElementById("contatos-vista-detalhe")))) return;
  document.getElementById("contatos-vista-detalhe").hidden = true;
  document.getElementById("contatos-vista-lista").hidden = false;
  renderizarListaContatos();
  const origem = [...document.querySelectorAll(".contato-nome-link")].find((botao) => botao.dataset.clienteId === _contatoOrigemId);
  (origem || document.getElementById("contatos-titulo")).focus();
}

function _selecionarSubabaContato(nome) {
  for (const aba of ["cadastro", "processos", "financeiro"]) {
    const ativa = aba === nome;
    const botao = document.getElementById(`contato-subaba-${aba}-botao`);
    botao.setAttribute("aria-selected", String(ativa));
    botao.tabIndex = ativa ? 0 : -1;
    document.getElementById(`contato-subaba-${aba}`).hidden = !ativa;
  }
  if (nome === "financeiro") carregarFinanceiroContato("pagina");
}

let _financeiroContatoRequisicao = 0;

async function carregarFinanceiroContato(tipoFeedback = "interno") {
  const feedback = { tipo: tipoFeedback === "pagina" ? "pagina" : "interno", regiao: document.getElementById("contato-financeiro") };
  const container = document.getElementById("contato-financeiro");
  const clienteId = document.getElementById("form-contato-cadastro").dataset.clienteId;
  const requisicao = ++_financeiroContatoRequisicao;
  limpar(container);
  if (!clienteId) return;
  const atual = () => requisicao === _financeiroContatoRequisicao
    && document.getElementById("form-contato-cadastro").dataset.clienteId === clienteId;
  try {
    const [{ lancamentos }, { casos }] = await Promise.all([_buscarJson("/lancamentos", feedback), _buscarJson("/casos", feedback)]);
    if (!atual()) return;
    limpar(container);
    const itens = (lancamentos || []).filter((item) => item.cliente_id === clienteId);
    if (!itens.length) {
      container.appendChild(notificacao("info", "Nenhum lançamento financeiro para este cliente"));
      return;
    }
    const totais = { receitas: 0, despesas: 0, recebido: 0, pago: 0 };
    for (const item of itens) {
      const valor = Math.round(Number(item.valor) * 100);
      const despesa = item.direcao === "DESPESA";
      totais[despesa ? "despesas" : "receitas"] += valor;
      if (item.pago) totais[despesa ? "pago" : "recebido"] += valor;
    }
    const resumo = el("dl", { class: "contato-financeiro-resumo" });
    for (const [rotulo, valor] of [
      ["Receitas totais", totais.receitas], ["Despesas totais", totais.despesas],
      ["Recebido", totais.recebido], ["Pago", totais.pago],
      ["A receber", totais.receitas - totais.recebido], ["A pagar", totais.despesas - totais.pago],
      ["Saldo realizado", totais.recebido - totais.pago],
    ]) resumo.appendChild(el("div", {}, [el("dt", { texto: rotulo }), el("dd", { texto: formatarMoeda(valor / 100) })]));
    container.appendChild(resumo);
    const colunas = ["Vencimento", "Descrição", "Processo", "Tipo", "Situação", "Valor"];
    const cabecalho = el("thead", {}, [el("tr", {}, colunas.map((texto) => el("th", { scope: "col", texto })))]);
    const corpo = el("tbody");
    const processos = new Map((casos || []).map((caso) => [caso.id, caso.titulo || "Processo sem título"]));
    itens.sort((a, b) => (a.vencimento || "").localeCompare(b.vencimento || ""));
    for (const item of itens) {
      const despesa = item.direcao === "DESPESA";
      const situacao = item.pago ? (despesa ? "Pago" : "Recebido") : (despesa ? "A pagar" : "A receber");
      const valores = [formatarDataSimples(item.vencimento), item.descricao || "—",
        processos.get(item.caso_id) || "—", despesa ? "Despesa" : "Receita", situacao, formatarMoeda(item.valor)];
      corpo.appendChild(el("tr", {}, valores.map((texto, i) => el("td", { "data-label": colunas[i], texto }))));
    }
    container.appendChild(el("p", { class: "campo-ajuda", texto: `${itens.length} lançamento(s) deste cliente` }));
    container.appendChild(el("div", { class: "tabela-responsiva-wrap" }, [el("table", { class: "tabela-responsiva", "aria-label": "Lançamentos do cliente" }, [cabecalho, corpo])]));
  } catch (erro) {
    if (!atual()) return;
    limpar(container);
    mostrarErro(container, `Não foi possível carregar o financeiro. Use Atualizar financeiro para tentar novamente. ${erro.message}`);
  }
}

function _renderizarCasosVinculadosNoContainer(container, clienteId) {
  limpar(container);
  const vinculados = _cache.casos.filter(
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
  try {
    const { casos } = await _buscarJson("/casos");
    _cache.casos = casos || [];
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
  if (String(evento.tipo || "").startsWith("agenda_atividade_")) {
    const estados = { agenda_atividade_sincronizado: "sincronizado", agenda_atividade_divergente: "com divergência", agenda_atividade_cancelado: "cancelado" };
    return `Vínculo de agenda da atividade ${c.atividade_id}: ${estados[evento.tipo] || "atualizado"}`;
  }
  if (evento.tipo === "movimento_processual") {
    const ultimo = c.ultimo?.nome ? ` (último: ${c.ultimo.nome})` : "";
    return `${c.quantidade || 1} movimento(s) novo(s) no processo${ultimo}`;
  }
  return evento.tipo;
}

function linhaDoTempoCaso(eventos) {
  if (!eventos.length) {
    return notificacao("info", "Nenhuma movimentação registrada ainda", "Publicações deste processo aparecem aqui automaticamente quando ele está monitorado.");
  }
  const lista = el("ul", { class: "linha-tempo-caso" });
  for (const evento of eventos) {
    lista.appendChild(
      el("li", {}, [
        el("strong", { texto: formatarData(evento.criado_em) }),
        ` — ${_resumoEventoCaso(evento)}`,
        evento.numero_processo ? el("span", { class: "campo-ajuda", texto: ` (processo ${formatarNumeroCNJ(evento.numero_processo)})` }) : null,
      ])
    );
  }
  return lista;
}

function linhaCaso(caso, aoExcluir) {
  const nomeCliente = (id) => (_cache.clientes.find((c) => c.id === id) || {}).nome || id;
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
    el("span", { texto: caso.titulo ? formatarNomeExibicao(caso.titulo) : "(sem título)" }),
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
    const linkProcesso = el("a", { href: "#", texto: formatarNumeroCNJ(numero) });
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

  const celCliente = el("td", { "data-label": "Cliente/Pasta" }, [el("div", { texto: nomesClientes.map(formatarNomeExibicao).join(", ") })]);
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
    containerAcao.appendChild(el("span", { class: "campo-ajuda", texto: "Classe não informada" }));
  } else {
    pedacosAcao.forEach((pedaco, indice) => {
      containerAcao.appendChild(el("span", {
        class: indice === 0 ? "cds--tag cds--tag--blue cds--tag--sm" : "cds--tag cds--tag--teal cds--tag--sm",
        texto: formatarClasseProcesso(pedaco),
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
  if (!(await confirmarAcao(`Excluir o processo "${titulo || "(sem título)"}"? Essa ação não pode ser desfeita.`))) return;
  botao.disabled = true;
  try {
    await _enviarJson(`/casos/${casoId}`, {}, "DELETE");
    _cache.casos = _cache.casos.filter((c) => c.id !== casoId);
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

// Rótulos de classe/rito não são nomes próprios. Não altera os dados salvos.
function formatarClasseProcesso(valor) {
  const siglas = new Set(["CNJ", "STF", "STJ", "TST", "TRT", "TRF", "TJ", "OAB", "INSS", "FGTS", "ICMS", "IPI", "IPTU", "ISS", "IRPF", "IRPJ", "CPC", "CPP", "CLT", "CDC", "ECA", "CTN", "JEC", "JEFAZ"]);
  return String(valor || "").split(" - ").map(parte => {
    const texto = parte.trim().toLocaleLowerCase("pt-BR").replace(/\p{L}+/gu, palavra => siglas.has(palavra.toLocaleUpperCase("pt-BR")) ? palavra.toLocaleUpperCase("pt-BR") : palavra);
    return texto.replace(/^\p{L}/u, letra => letra.toLocaleUpperCase("pt-BR"));
  }).filter(Boolean).join(" · ");
}

function cartoesCasos(casos, aoExcluir) {
  const nomeCliente = id => (_cache.clientes.find(c => c.id === id) || {}).nome || id;
  const grade = el("div", { class: "cds--grid grade-casos" });
  const linha = el("div", { class: "cds--row grade-casos-linha" });
  grade.append(linha);
  for (const caso of [...casos].sort((a,b) => (b.ultima_movimentacao || "").localeCompare(a.ultima_movimentacao || ""))) {
    const titulo = caso.titulo?.trim() ? formatarNomeExibicao(caso.titulo) : "Processo sem título";
    const card = el("article", { class: "processo-card", "aria-label": titulo });
    const abrir = el("button", { type: "button", class: "processo-card-titulo", texto: titulo, title: titulo, "aria-label": `Abrir processo: ${titulo}` });
    abrir.addEventListener("click", () => abrirCaso(caso.id));
    const acoes = el("div", { class: "processo-card-acoes" });
    for (const [icone, rotulo, acao] of [["editar", "Editar", () => abrirCaso(caso.id)], ["excluir", "Excluir", botao => excluirCaso(caso.id, caso.titulo, botao, aoExcluir)]]) {
      const botao = el("cds-icon-button", { kind: "ghost", size: "sm", label: `${rotulo}: ${titulo}` });
      const criarSvg = item => _elSvg(document, item.elem, item.attrs || {}, (item.content || []).map(criarSvg));
      const svg = criarSvg(window.cnjProcessoIcones[icone]); svg.setAttribute("slot", "icon"); svg.setAttribute("aria-hidden", "true");
      botao.append(svg, el("span", { slot: "tooltip-content", texto: rotulo }));
      botao.addEventListener("click", () => acao(botao)); acoes.append(botao);
    }
    card.append(el("div", { class: "processo-card-cabecalho" }, [el("h3", {}, [abrir]), acoes]));
    const estados = el("div", { class: "processo-card-estados" });
    if (caso.monitorado) estados.append(el("span", { class: "cds--tag cds--tag--green cds--tag--sm", texto: "Monitorado" }));
    if (_ROTULO_DESFECHO_CASO[caso.desfecho]) estados.append(el("span", { class: "cds--tag cds--tag--purple cds--tag--sm", texto: _ROTULO_DESFECHO_CASO[caso.desfecho] }));
    card.append(estados);
    const nomes = [caso.cliente_id, ...(caso.clientes_adicionais || [])].map(nomeCliente).filter(Boolean).map(formatarNomeExibicao);
    const dados = el("dl", { class: "processo-card-dados" });
    for (const [rotulo, valor] of [["Cliente", nomes.join(", ") || "Sem cliente vinculado"], ["Classe / rito", formatarClasseProcesso(caso.acao) || "Classe não informada"], ["Órgão julgador", caso.foro || "Não informado"], ["Última movimentação", formatarDataSimples(caso.ultima_movimentacao)]]) {
      dados.append(el("div", {}, [el("dt", { texto: rotulo }), el("dd", { texto: valor, title: valor })]));
    }
    card.append(dados);
    if (!caso.titulo?.trim()) card.append(el("p", { class: "processo-card-identificador", texto: (caso.processos || []).map(formatarNumeroCNJ).join(" · ") || `Registro ${caso.numero || caso.id}`, title: caso.id }));
    linha.append(el("div", { class: "cds--col-sm-4 cds--col-md-4 cds--col-lg-4 processo-card-coluna" }, [card]));
  }
  return grade;
}

// --- Financeiro --------------------------------------------------------------------------------

function formatarMoeda(valor) {
  return (Number(valor) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function carregarLancamentos(tipoFeedback = "interno") {
  const feedback = { tipo: tipoFeedback === "pagina" ? "pagina" : "interno", regiao: document.getElementById("lista-lancamentos") };
  const container = document.getElementById("lista-lancamentos");
  limpar(container);
  try {
    const [{ lancamentos }] = await Promise.all([
      _buscarJson("/lancamentos", feedback),
      _cache.clientes.length ? Promise.resolve() : _buscarJson("/clientes", feedback).then((r) => { _cache.clientes = r.clientes || []; }),
      _cache.casos.length ? Promise.resolve() : _buscarJson("/casos", feedback).then((r) => { _cache.casos = r.casos || []; }),
    ]);
    _renderizarLancamentos(lancamentos || []);
  } catch (erro) {
    mostrarErro(container, erro.message);
  }
}

function _renderizarLancamentos(lancamentos) {
  const container = document.getElementById("lista-lancamentos");
  limpar(container);
  if (!lancamentos.length) {
    container.appendChild(notificacao("info", "Nenhum lançamento cadastrado"));
    return;
  }
  const nomeCliente = (id) => (_cache.clientes.find((c) => c.id === id) || {}).nome || id;
  const tituloCaso = (id) => (_cache.casos.find((c) => c.id === id) || {}).titulo || "(sem título)";

  const thead = el("thead", {}, [
    el("tr", {}, [
      el("th", { texto: "Vencimento" }),
      el("th", { texto: "Valor" }),
      el("th", { texto: "Descrição" }),
      el("th", { texto: "Cliente" }),
      el("th", { texto: "Processo" }),
      el("th", { texto: "Responsável" }),
      el("th", { texto: "Direção" }),
      el("th", { texto: "Ações" }),
    ]),
  ]);
  const tbody = el("tbody", {});
  for (const lanc of lancamentos) {
    const tr = el("tr", {}, [
      el("td", { "data-label": "Vencimento", texto: formatarDataSimples(lanc.vencimento) }),
      el("td", { "data-label": "Valor", texto: formatarMoeda(lanc.valor) }),
      el("td", { "data-label": "Descrição", texto: lanc.descricao + (lanc.recorrente ? " (mensal)" : "") }),
      el("td", { "data-label": "Cliente", texto: formatarNomeExibicao(nomeCliente(lanc.cliente_id)) }),
      el("td", { "data-label": "Processo", texto: formatarNomeExibicao(tituloCaso(lanc.caso_id)) }),
      el("td", { "data-label": "Responsável", texto: formatarNomeExibicao(lanc.responsavel) }),
    ]);

    const rotuloDirecao = lanc.direcao === "DESPESA" ? "A pagar" : "A receber";
    const rotuloPago = lanc.direcao === "DESPESA" ? "Pago" : "Recebido";
    const tagDirecao = el("span", {
      class: `cds--tag cds--tag--${lanc.direcao === "DESPESA" ? "red" : "green"} cds--tag--sm`, texto: rotuloDirecao,
    });
    const checkboxPago = el("input", { type: "checkbox" });
    checkboxPago.checked = lanc.pago;
    checkboxPago.addEventListener("change", () => _alternarLancamentoPago(lanc.id, checkboxPago));
    const celulaDirecao = el("td", { "data-label": "Direção" }, [
      tagDirecao,
      el("label", { class: "checkbox-lembrar", style: "margin-top:0.25rem" }, [checkboxPago, ` ${rotuloPago}`]),
    ]);
    tr.appendChild(celulaDirecao);

    const acoesLancamento = [];
    if (lanc.asaas_cobranca_id) {
      acoesLancamento.push(el("span", {
        class: "texto-auxiliar", texto: "Cobrança gerada", title: `Cobrança ${lanc.asaas_cobranca_id}`,
      }));
    } else if (!lanc.pago) {
      const botaoCobranca = el("button", { class: "cds--btn cds--btn--tertiary cds--btn--sm", type: "button", texto: "Gerar cobrança" });
      botaoCobranca.addEventListener("click", () => _gerarCobrancaLancamento(lanc.id, botaoCobranca));
      acoesLancamento.push(botaoCobranca);
    }
    const botaoExcluir = el("button", { class: "cds--btn cds--btn--danger--tertiary cds--btn--sm", type: "button", texto: "Excluir" });
    botaoExcluir.addEventListener("click", () => _excluirLancamento(lanc.id, lanc.descricao, botaoExcluir));
    tr.appendChild(el("td", { "data-label": "Ações" }, [...acoesLancamento, botaoExcluir]));
    tbody.appendChild(tr);
  }
  container.appendChild(el("div", { class: "tabela-responsiva-wrap" }, [el("table", { class: "tabela-responsiva tabela-lancamentos" }, [thead, tbody])]));
}

async function _alternarLancamentoPago(id, checkbox) {
  checkbox.disabled = true;
  try {
    await _enviarJson(`/lancamentos/${id}`, { pago: checkbox.checked }, "PATCH");
  } catch (erro) {
    checkbox.checked = !checkbox.checked;
    mostrarToast("error", "Erro", erro.message);
  } finally {
    checkbox.disabled = false;
  }
}

async function _gerarCobrancaLancamento(id, botao) {
  botao.disabled = true;
  try {
    await _enviarJson(`/lancamentos/${id}/cobranca`, {});
    mostrarToast("success", "Cobrança gerada", "Boleto emitido no Asaas.");
    await carregarLancamentos();
  } catch (erro) {
    mostrarToast("error", "Erro", erro.message);
    botao.disabled = false;
  }
}

async function _excluirLancamento(id, descricao, botao) {
  if (!(await confirmarAcao(`Excluir o lançamento "${descricao}"? Essa ação não pode ser desfeita.`))) return;
  botao.disabled = true;
  try {
    await _enviarJson(`/lancamentos/${id}`, {}, "DELETE");
    await carregarLancamentos();
  } catch (erro) {
    mostrarToast("error", "Erro", erro.message);
    botao.disabled = false;
  }
}

// --- Financeiro: Pagamentos (cobranças Asaas) -------------------------------------------------

const _ROTULOS_STATUS_PAGAMENTO = {
  PENDING: ["Pendente", "gray"], OVERDUE: ["Vencido", "red"],
  RECEIVED: ["Recebido", "green"], CONFIRMED: ["Confirmado", "green"],
  RECEIVED_IN_CASH: ["Recebido em dinheiro", "green"], REFUNDED: ["Estornado", "gray"],
  REFUND_REQUESTED: ["Estorno solicitado", "gray"], REFUND_IN_PROGRESS: ["Estorno em andamento", "gray"],
};
const _ROTULOS_TIPO_PAGAMENTO = { BOLETO: "Boleto", PIX: "Pix", UNDEFINED: "A definir" };

// Campo de cliente por CPF/CNPJ: mascara, resolve contra _cache.clientes e mantém um input
// hidden com o cliente_id (o que os formulários/filtros de fato enviam). `aoResolver` roda a
// cada digitação, já com o cliente encontrado (ou null).
function _ligarCampoClientePorCpf(idTexto, idHidden, idStatus, aoResolver) {
  const campoTexto = document.getElementById(idTexto);
  const campoHidden = document.getElementById(idHidden);
  const campoStatus = document.getElementById(idStatus);
  _aplicarMascaraCpfCnpj(campoTexto);
  campoTexto.addEventListener("input", () => {
    const digitos = campoTexto.value.replace(/\D/g, "");
    const encontrado = digitos.length >= 11 ? _resolverClientePorCpf(digitos) : null;
    campoHidden.value = encontrado ? encontrado.id : "";
    if (!digitos) campoStatus.textContent = "";
    else if (encontrado) campoStatus.textContent = `Cliente: ${encontrado.nome}`;
    else if (digitos.length >= 11) campoStatus.textContent = "Nenhum cliente cadastrado com esse CPF/CNPJ.";
    else campoStatus.textContent = "";
    aoResolver(encontrado);
  });
}

let _pagamentosOffset = 0;
let _pagamentosAcumuladas = [];
let _pagamentosTemMais = false;

async function carregarPagamentos(tipoFeedback = "interno") {
  _pagamentosOffset = 0;
  _pagamentosAcumuladas = [];
  await _buscarPaginaPagamentos(tipoFeedback);
}

async function _buscarPaginaPagamentos(tipoFeedback = "interno") {
  const feedback = { tipo: tipoFeedback === "pagina" ? "pagina" : "interno", regiao: document.getElementById("lista-pagamentos") };
  const container = document.getElementById("lista-pagamentos");
  const aviso = document.getElementById("pagamentos-aviso-integracao");
  const botaoMais = document.getElementById("pagamentos-carregar-mais");
  limpar(aviso);
  if (_pagamentosOffset === 0) limpar(container);
  try {
    if (!_cache.clientes.length) {
      const { clientes } = await _buscarJson("/clientes", feedback);
      _cache.clientes = clientes || [];
    }
    const params = new URLSearchParams();
    const status = document.getElementById("pagamentos-filtro-status").value;
    const clienteId = document.getElementById("pagamentos-filtro-cliente").value;
    if (status) params.set("status", status);
    if (clienteId) params.set("cliente_id", clienteId);
    if (_pagamentosOffset) params.set("offset", _pagamentosOffset);
    const url = "/pagamentos" + (params.toString() ? `?${params}` : "");
    const dados = await _buscarJson(url, { ...feedback, tipo: tipoFeedback === "pagina" ? "pagina" : "externo" });
    const cobrancas = dados.cobrancas || [];
    _pagamentosAcumuladas = _pagamentosAcumuladas.concat(cobrancas);
    _pagamentosTemMais = Boolean(dados.hasMore);
    _pagamentosOffset += cobrancas.length;
    limpar(container);
    _renderizarPagamentos(_pagamentosAcumuladas);
    botaoMais.hidden = !_pagamentosTemMais;
  } catch (erro) {
    botaoMais.hidden = true;
    if (erro.status === 404) {
      limpar(container);
      aviso.appendChild(notificacao("info", "Integração Asaas não configurada"));
    } else {
      mostrarErro(container, erro.message);
    }
  }
}

document.getElementById("pagamentos-carregar-mais").addEventListener("click", () => _buscarPaginaPagamentos());

_ligarBuscaCliente(
  "pagamentos-filtro-cliente-busca", "pagamentos-filtro-cliente", "pagamentos-filtro-cliente-resultados",
  "pagamentos-filtro-cliente-status", () => carregarPagamentos(),
);

function _renderizarPagamentos(cobrancas) {
  const container = document.getElementById("lista-pagamentos");
  limpar(container);
  if (!cobrancas.length) {
    container.appendChild(notificacao("info", "Nenhuma cobrança encontrada"));
    return;
  }
  const thead = el("thead", {}, [
    el("tr", {}, [
      el("th", { texto: "Cliente" }),
      el("th", { texto: "Valor" }),
      el("th", { texto: "Vencimento" }),
      el("th", { texto: "Tipo" }),
      el("th", { texto: "Status" }),
      el("th", { texto: "Ações" }),
    ]),
  ]);
  const tbody = el("tbody", {});
  for (const cobranca of cobrancas) {
    const [rotuloStatus, corStatus] = _ROTULOS_STATUS_PAGAMENTO[cobranca.status] || [cobranca.status, "gray"];
    const tag = el("span", { class: `cds--tag cds--tag--${corStatus} cds--tag--sm`, texto: rotuloStatus });
    const link = cobranca.bankSlipUrl || cobranca.invoiceUrl;
    const acoes = [];
    if (link) {
      acoes.push(el("a", {
        class: "cds--btn cds--btn--ghost cds--btn--sm", href: link, target: "_blank", rel: "noopener",
        texto: "Ver cobrança",
      }));
    }
    if (!["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH", "REFUNDED"].includes(cobranca.status)) {
      const botaoCancelar = el("button", {
        class: "cds--btn cds--btn--danger--tertiary cds--btn--sm", type: "button", texto: "Cancelar",
      });
      botaoCancelar.addEventListener("click", () => _cancelarCobranca(cobranca.id, botaoCancelar));
      acoes.push(botaoCancelar);
    }
    const tr = el("tr", {}, [
      el("td", { "data-label": "Cliente", texto: cobranca.cliente_nome || "(cliente sem cadastro local)" }),
      el("td", { "data-label": "Valor", texto: formatarMoeda(cobranca.value) }),
      el("td", { "data-label": "Vencimento", texto: formatarDataSimples(cobranca.dueDate) }),
      el("td", { "data-label": "Tipo", texto: _ROTULOS_TIPO_PAGAMENTO[cobranca.billingType] || cobranca.billingType }),
      el("td", { "data-label": "Status" }, [tag]),
      el("td", { "data-label": "Ações" }, acoes),
    ]);
    tbody.appendChild(tr);
  }
  container.appendChild(el("div", { class: "tabela-responsiva-wrap" }, [el("table", { class: "tabela-responsiva tabela-pagamentos" }, [thead, tbody])]));
}

async function _cancelarCobranca(id, botao) {
  if (!(await confirmarAcao("Cancelar esta cobrança no Asaas? Essa ação não pode ser desfeita.", { textoConfirmar: "Cancelar cobrança" }))) return;
  botao.disabled = true;
  try {
    await _enviarJson(`/pagamentos/${id}`, {}, "DELETE");
    await carregarPagamentos();
  } catch (erro) {
    mostrarToast("error", "Erro", erro.message);
    botao.disabled = false;
  }
}

// Soma meses a uma data ISO (AAAA-MM-DD), preso ao último dia do mês alvo quando o dia de
// origem não existir nele (ex.: 31/jan + 1 mês = 28 ou 29/fev, nunca "estoura" pra março) -
// mesma lógica que o Asaas usa pra gerar o vencimento das parcelas seguintes.
function _somarMeses(dataIso, meses) {
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  const mesesTotal = (mes - 1) + meses;
  const anoAlvo = ano + Math.floor(mesesTotal / 12);
  const mesAlvo = ((mesesTotal % 12) + 12) % 12;
  const ultimoDiaMesAlvo = new Date(anoAlvo, mesAlvo + 1, 0).getDate();
  const diaAlvo = Math.min(dia, ultimoDiaMesAlvo);
  return `${anoAlvo}-${String(mesAlvo + 1).padStart(2, "0")}-${String(diaAlvo).padStart(2, "0")}`;
}

// Divide o valor total (em centavos, pra não acumular erro de ponto flutuante) em N parcelas
// iguais, jogando a sobra do arredondamento na última - mesma regra que o Asaas aplica.
function _calcularValoresParcelas(totalCentavos, quantidade) {
  const porParcela = Math.floor(totalCentavos / quantidade);
  const valores = Array(quantidade).fill(porParcela);
  valores[quantidade - 1] += totalCentavos - porParcela * quantidade;
  return valores;
}

function _atualizarPreviewParcelas() {
  const preview = document.getElementById("cobranca-parcelas-preview");
  const parcelando = document.getElementById("cobranca-parcelar").checked;
  limpar(preview);
  if (!parcelando) { preview.hidden = true; return; }
  const total = parseFloat(document.getElementById("cobranca-valor").value);
  const quantidade = parseInt(document.getElementById("cobranca-parcelas").value, 10);
  const vencimento = document.getElementById("cobranca-vencimento").value.trim();
  if (!(total > 0) || !(quantidade >= 2) || !/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) {
    preview.hidden = true;
    return;
  }
  preview.hidden = false;
  const valoresCentavos = _calcularValoresParcelas(Math.round(total * 100), quantidade);
  const thead = el("thead", {}, [el("tr", {}, [
    el("th", { texto: "Parcela" }), el("th", { texto: "Vencimento" }), el("th", { texto: "Valor" }),
  ])]);
  const tbody = el("tbody", {});
  valoresCentavos.forEach((centavos, indice) => {
    tbody.appendChild(el("tr", {}, [
      el("td", { "data-label": "Parcela", texto: `${indice + 1}/${quantidade}` }),
      el("td", { "data-label": "Vencimento", texto: formatarDataSimples(_somarMeses(vencimento, indice)) }),
      el("td", { "data-label": "Valor", texto: formatarMoeda(centavos / 100) }),
    ]));
  });
  preview.appendChild(el("p", { class: "campo-ajuda", texto: "Prévia das parcelas (quem gera de fato é o Asaas, ao confirmar):" }));
  preview.appendChild(el("div", { class: "tabela-responsiva-wrap" }, [el("table", { class: "tabela-responsiva" }, [thead, tbody])]));
}

// `prefill`, se dado, vem do botão "Gerar cobrança" de um lançamento: { cliente_id, valor,
// vencimento (ISO), descricao }.
async function _abrirModalNovaCobranca(prefill) {
  if (!_cache.clientes.length) {
    try { const { clientes } = await _buscarJson("/clientes"); _cache.clientes = clientes || []; } catch { /* segue */ }
  }
  document.getElementById("form-nova-cobranca").reset();
  limpar(document.getElementById("resultado-nova-cobranca"));
  document.getElementById("cobranca-cliente").value = "";
  document.getElementById("cobranca-cliente-status").textContent = "Digite o CPF/CNPJ de um cliente já cadastrado.";
  document.getElementById("cobranca-parcelas-campo").hidden = true;
  document.getElementById("cobranca-valor-rotulo").textContent = "Valor";
  limpar(document.getElementById("cobranca-parcelas-preview"));
  document.getElementById("cobranca-parcelas-preview").hidden = true;

  if (prefill) {
    const clienteDoLancamento = _cache.clientes.find((c) => c.id === prefill.cliente_id);
    const campoCpf = document.getElementById("cobranca-cliente-cpf");
    campoCpf.value = (clienteDoLancamento && clienteDoLancamento.cpf_cnpj) || "";
    campoCpf.dispatchEvent(new Event("input"));
    if (prefill.valor != null) document.getElementById("cobranca-valor").value = prefill.valor;
    if (prefill.vencimento) document.getElementById("cobranca-vencimento").value = prefill.vencimento;
    if (prefill.descricao) document.getElementById("cobranca-descricao").value = prefill.descricao;
  } else {
    document.getElementById("cobranca-cliente-cpf").value = "";
  }
  abrirModal("modal-nova-cobranca");
}

_ligarCampoClientePorCpf("cobranca-cliente-cpf", "cobranca-cliente", "cobranca-cliente-status", () => {});

document.getElementById("btn-nova-cobranca").addEventListener("click", () => _abrirModalNovaCobranca());
document.getElementById("modal-nova-cobranca-fechar").addEventListener("click", () => fecharModal("modal-nova-cobranca"));
document.getElementById("pagamentos-filtro-status").addEventListener("change", carregarPagamentos);

document.getElementById("cobranca-parcelar").addEventListener("change", (evento) => {
  const parcelando = evento.target.checked;
  document.getElementById("cobranca-parcelas-campo").hidden = !parcelando;
  document.getElementById("cobranca-valor-rotulo").textContent = parcelando ? "Valor total" : "Valor";
  _atualizarPreviewParcelas();
});
for (const id of ["cobranca-valor", "cobranca-parcelas", "cobranca-vencimento"]) {
  document.getElementById(id).addEventListener("input", _atualizarPreviewParcelas);
}

registrarSalvamento(document.getElementById("form-nova-cobranca"), async (evento) => {
  evento.preventDefault();
  const botao = document.querySelector("button[form='form-nova-cobranca'][type='submit']");
  const resultado = document.getElementById("resultado-nova-cobranca");
  const parcelando = document.getElementById("cobranca-parcelar").checked;
  if (!document.getElementById("cobranca-cliente").value) {
    mostrarErro(resultado, "Digite o CPF/CNPJ de um cliente já cadastrado antes de criar a cobrança.");
    return;
  }
  const corpo = {
    cliente_id: document.getElementById("cobranca-cliente").value,
    billing_type: document.getElementById("cobranca-tipo").value,
    valor: document.getElementById("cobranca-valor").value,
    vencimento: document.getElementById("cobranca-vencimento").value.trim(),
    descricao: document.getElementById("cobranca-descricao").value.trim(),
  };
  if (parcelando) corpo.parcelas = document.getElementById("cobranca-parcelas").value;
  const pararEspera = mostrarEspera(resultado, botao, "Criando cobrança");
  try {
    await _enviarJson("/pagamentos", corpo);
    marcarFormularioSalvo(document.getElementById("form-nova-cobranca"));
    fecharModal("modal-nova-cobranca");
    await carregarPagamentos();
  } catch (erro) {
    mostrarErro(resultado, erro.message);
  } finally {
    pararEspera();
  }
});

// Date picker simples para cobranca-vencimento (sem range plugin).
(function () {
  const campo = document.getElementById("cobranca-vencimento");
  if (!campo || typeof window.flatpickr !== "function") return;
  window.flatpickr(campo, {
    altInput: true,
    altFormat: "d/m/Y",
    allowInput: true,
    locale: window.flatpickr.l10ns && window.flatpickr.l10ns.pt,
    dateFormat: "Y-m-d",
    onChange: () => _atualizarPreviewParcelas(),
  });
})();

let _honorarioCarregando = false;
async function _carregarVinculosHonorario() {
  if (_honorarioCarregando) return;
  _honorarioCarregando = true;
  const salvar = document.querySelector("button[form='form-honorario'][type='submit']");
  salvar.disabled = true;
  const resultado = document.getElementById("honorario-carregamento");
  limpar(resultado);
  const falhas = [];
  await Promise.all(["clientes", "casos"].map(async (tipo) => {
    try {
      if (!_cache[tipo].length) {
        const dados = await _buscarJson(`/${tipo}`);
        _cache[tipo] = dados[tipo] || [];
      }
      const nome = tipo === "casos" ? "processo" : "cliente";
      if (!_cache[tipo].length) falhas.push(`Nenhum ${nome} cadastrado. Cadastre um ${nome} para continuar.`);
    } catch {
      falhas.push(`Não foi possível carregar ${tipo === "casos" ? "os processos" : "os clientes"}. Tente novamente.`);
    }
  }));
  if (falhas.length) {
    mostrarErro(resultado, falhas.join(" "));
    resultado.appendChild(el("button", { type: "button", class: "cds--btn cds--btn--tertiary cds--btn--sm", texto: "Tentar novamente", onclick: _carregarVinculosHonorario }));
  }
  salvar.disabled = false;
  _honorarioCarregando = false;
}

// Remove acentos e caixa pra comparar texto digitado contra nomes cadastrados.
function _normalizarTexto(texto) {
  return String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function _renderizarProcessosDoCliente(clienteId) {
  const opcoes = document.getElementById("honorario-processos-opcoes");
  const ajuda = document.getElementById("honorario-processos-ajuda");
  const selecionados = new Set([...opcoes.querySelectorAll("input:checked")].map((input) => input.value));
  limpar(opcoes);
  if (!clienteId) {
    ajuda.textContent = "Selecione o cliente para ver os processos vinculados.";
    return;
  }
  const processos = _cache.casos.filter((caso) => caso.cliente_id === clienteId || (caso.clientes_adicionais || []).includes(clienteId));
  if (!processos.length) {
    ajuda.textContent = "Esse cliente não tem processos cadastrados.";
    return;
  }
  ajuda.textContent = "Selecione um ou mais processos.";
  for (const caso of processos) {
    const titulo = `${caso.numero ? `Processo ${caso.numero}` : caso.id} — ${formatarNomeExibicao(caso.titulo || "Sem título")}`;
    opcoes.appendChild(el("label", {}, [
      el("input", { type: "checkbox", value: caso.id, checked: selecionados.has(caso.id) ? "checked" : null }),
      titulo,
    ]));
  }
}

// Liga um campo de busca de cliente por nome ou CPF/CNPJ (com dropdown de resultados) a um
// input hidden com o cliente_id. `aoSelecionar(cliente|null)` roda ao escolher um resultado ou
// ao limpar o campo (nesse caso com `null`).
function _ligarBuscaCliente(idBusca, idHidden, idResultados, idStatus, aoSelecionar) {
  const campoBusca = document.getElementById(idBusca);
  const campoHidden = document.getElementById(idHidden);
  const status = document.getElementById(idStatus);
  const resultados = document.getElementById(idResultados);
  const selecionar = (cliente) => {
    campoBusca.value = formatarNomeExibicao(cliente.nome);
    campoHidden.value = cliente.id;
    status.textContent = `Cliente selecionado: ${formatarNomeExibicao(cliente.nome)}`;
    limpar(resultados);
    resultados.hidden = true;
    aoSelecionar(cliente);
  };
  campoBusca.addEventListener("input", () => {
    campoHidden.value = "";
    const termo = campoBusca.value.trim();
    limpar(resultados);
    if (!termo) { resultados.hidden = true; status.textContent = ""; aoSelecionar(null); return; }
    const termoNormalizado = _normalizarTexto(termo);
    const digitos = termo.replace(/\D/g, "");
    const encontrados = _cache.clientes.filter((cliente) => (
      _normalizarTexto(cliente.nome).includes(termoNormalizado)
      || (digitos.length >= 3 && (cliente.cpf_cnpj || "").replace(/\D/g, "").includes(digitos))
    )).slice(0, 8);
    if (!encontrados.length) {
      status.textContent = "Nenhum cliente encontrado.";
      resultados.hidden = true;
      return;
    }
    status.textContent = "";
    for (const cliente of encontrados) {
      resultados.appendChild(el("button", {
        type: "button",
        texto: `${formatarNomeExibicao(cliente.nome)}${cliente.cpf_cnpj ? ` — ${cliente.cpf_cnpj}` : ""}`,
        onclick: () => selecionar(cliente),
      }));
    }
    resultados.hidden = false;
  });
  campoBusca.addEventListener("blur", () => setTimeout(() => { resultados.hidden = true; }, 150));
}

_ligarBuscaCliente(
  "honorario-cliente-busca", "honorario-cliente", "honorario-cliente-resultados", "honorario-cliente-status",
  (cliente) => _renderizarProcessosDoCliente(cliente ? cliente.id : ""),
);

function _atualizarPreviewParcelasHonorario() {
  const preview = document.getElementById("honorario-parcelas-preview");
  const parcelando = document.getElementById("honorario-parcelar").checked;
  limpar(preview);
  if (!parcelando) { preview.hidden = true; return; }
  const total = _valorLancamentoEmReais(document.getElementById("honorario-valor").value);
  const quantidade = parseInt(document.getElementById("honorario-parcelas").value, 10);
  const vencimento = _ddmmaaaaParaIso(document.getElementById("honorario-vencimento").value);
  if (!total || !(quantidade >= 2) || !vencimento) { preview.hidden = true; return; }
  preview.hidden = false;
  const valoresCentavos = _calcularValoresParcelas(Math.round(total * 100), quantidade);
  const thead = el("thead", {}, [el("tr", {}, [
    el("th", { texto: "Parcela" }), el("th", { texto: "Vencimento" }), el("th", { texto: "Valor" }),
  ])]);
  const tbody = el("tbody", {});
  valoresCentavos.forEach((centavos, indice) => {
    tbody.appendChild(el("tr", {}, [
      el("td", { "data-label": "Parcela", texto: `${indice + 1}/${quantidade}` }),
      el("td", { "data-label": "Vencimento", texto: formatarDataSimples(_somarMeses(vencimento, indice)) }),
      el("td", { "data-label": "Valor", texto: formatarMoeda(centavos / 100) }),
    ]));
  });
  preview.appendChild(el("p", { class: "campo-ajuda", texto: "Prévia das parcelas:" }));
  preview.appendChild(el("div", { class: "tabela-responsiva-wrap" }, [el("table", { class: "tabela-responsiva" }, [thead, tbody])]));
}

document.getElementById("honorario-parcelar").addEventListener("change", (evento) => {
  const parcelando = evento.target.checked;
  document.getElementById("honorario-parcelas-campo").hidden = !parcelando;
  _atualizarPreviewParcelasHonorario();
});
for (const id of ["honorario-valor", "honorario-parcelas", "honorario-vencimento"]) {
  document.getElementById(id).addEventListener("input", _atualizarPreviewParcelasHonorario);
}

async function _abrirModalHonorario() {
  document.getElementById("form-honorario").reset();
  document.getElementById("honorario-valor").setCustomValidity("");
  document.getElementById("honorario-cliente").value = "";
  document.getElementById("honorario-cliente-status").textContent = "";
  limpar(document.getElementById("honorario-cliente-resultados"));
  document.getElementById("honorario-cliente-resultados").hidden = true;
  document.getElementById("honorario-parcelas-campo").hidden = true;
  limpar(document.getElementById("honorario-parcelas-preview"));
  document.getElementById("honorario-parcelas-preview").hidden = true;
  limpar(document.getElementById("resultado-honorario"));
  // Preencher opções antes de registrar a base de alterações pendentes.
  await _carregarVinculosHonorario();
  _renderizarProcessosDoCliente("");
  abrirModal("modal-honorario");
}

function _valorLancamentoEmReais(texto) {
  const valor = String(texto).trim();
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(valor)) return null;
  const numero = Number(valor.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(numero) && numero > 0 && numero <= Number.MAX_SAFE_INTEGER / 100 ? numero : null;
}

document.getElementById("honorario-valor").addEventListener("input", (evento) => {
  const campo = evento.target;
  campo.setCustomValidity(campo.value && _valorLancamentoEmReais(campo.value) === null ? "Informe um valor maior que zero, como 1.500,00." : "");
});

function cartaoPendente(p) {
  const d = p.dados || {};
  const card = el("article", { class: "cds--tile resultado-card" });
  card.appendChild(el("h3", { texto: d.tipoComunicacao || "Processo novo encontrado" }));
  card.appendChild(el("p", { texto: `Processo: ${formatarNumeroCNJ(d.numeroprocessocommascara || p.numero_processo)}` }));
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

async function carregarPendentes(tipoFeedback = "interno") {
  const feedback = { tipo: tipoFeedback === "pagina" ? "pagina" : "interno", regiao: document.getElementById("lista-pendentes") };
  const listaPendentesEl = document.getElementById("lista-pendentes");
  limpar(listaPendentesEl);
  try {
    const { pendentes } = await _buscarJson("/pendentes", feedback);
    if (!(pendentes || []).length) {
      listaPendentesEl.appendChild(notificacao("info", "Nenhum processo pendente de triagem"));
    } else {
      for (const p of pendentes) listaPendentesEl.appendChild(cartaoPendente(p));
    }
  } catch (erro) {
    mostrarErro(listaPendentesEl, erro.message);
  }
}

async function carregarContatos(tipoFeedback = "interno") {
  const feedback = { tipo: tipoFeedback === "pagina" ? "pagina" : "interno", regiao: document.getElementById("lista-contatos") };
  const listaContatosEl = document.getElementById("lista-contatos");
  if (!exigirCliente(listaContatosEl)) return;
  _construirBarraAZ();
  limpar(listaContatosEl);
  try {
    const { clientes } = await _buscarJson("/clientes", feedback);
    _cache.clientes = clientes || [];
    renderizarListaContatos();
  } catch (erro) {
    limpar(listaContatosEl);
    mostrarErro(listaContatosEl, erro.message);
  }
}

async function carregarCasosPagina(tipoFeedback = "interno") {
  const feedback = { tipo: tipoFeedback === "pagina" ? "pagina" : "interno", regiao: document.getElementById("lista-casos") };
  const listaCasosEl = document.getElementById("lista-casos");
  if (!exigirCliente(listaCasosEl)) return;
  limpar(listaCasosEl);
  carregarPendentes(tipoFeedback);
  try {
    const [{ clientes }, { casos }] = await Promise.all([_buscarJson("/clientes", feedback), _buscarJson("/casos", feedback)]);
    _cache.clientes = clientes || [];
    _cache.casos = casos || [];
    _renderizarTabelaCasosPagina();
  } catch (erro) {
    mostrarErro(listaCasosEl, erro.message);
  }
}

function _renderizarTabelaCasosPagina() {
  const listaCasosEl = document.getElementById("lista-casos");
  limpar(listaCasosEl);
  const nomeCliente = (id) => (_cache.clientes.find((c) => c.id === id) || {}).nome || "";
  const termo = _filtroCasos.toLowerCase().trim();
  const filtrados = termo
    ? _cache.casos.filter((c) => {
        const textos = [
          c.titulo, c.acao, c.foro, c.responsavel,
          nomeCliente(c.cliente_id),
          ...(c.clientes_adicionais || []).map(nomeCliente),
          ...(c.processos || []),
        ].map((t) => (t || "").toLowerCase());
        return textos.some((t) => t.includes(termo));
      })
    : _cache.casos;
  if (!filtrados.length) {
    listaCasosEl.appendChild(notificacao("info", termo ? "Nenhum processo corresponde ao filtro." : "Nenhum processo cadastrado ainda"));
  } else {
    listaCasosEl.appendChild(
      _visualizacaoCasos === "cards"
        ? cartoesCasos(filtrados, _renderizarTabelaCasosPagina)
        : tabelaCasos(filtrados, _renderizarTabelaCasosPagina)
    );
  }
  renderizarCasosFavoritos();
}

// --- Cadastro completo de cliente/contato: 3 seções (abas) --------------------------
// Compartilhado entre o modal "Novo cliente" (prefixo "cliente") e a sub-aba "Cadastro" da
// tela de detalhe (prefixo "contato") - mesmos ids de campo, só o prefixo muda.

function _selecionarAbaCadastro(prefixo, nome) {
  const abas = [
    { nome: "pessoal", sufixo: "pessoal" },
    { nome: "documentacao", sufixo: "documentacao" },
    { nome: "complementar", sufixo: "complementar" },
  ];
  for (const aba of abas) {
    const ativa = aba.nome === nome;
    const botao = document.getElementById(`${prefixo}-cadastro-aba-${aba.sufixo}-botao`);
    const painel = document.getElementById(`${prefixo}-cadastro-painel-${aba.sufixo}`);
    if (!botao.classList.contains("contato-cadastro-tab")) botao.classList.toggle("cds--content-switcher--selected", ativa);
    botao.setAttribute("aria-selected", String(ativa));
    botao.tabIndex = ativa ? 0 : -1;
    painel.hidden = !ativa;
  }
}

function _configurarAbasCadastro(prefixo) {
  for (const sufixo of ["pessoal", "documentacao", "complementar"]) {
    document.getElementById(`${prefixo}-cadastro-aba-${sufixo}-botao`)
      .addEventListener("click", () => _selecionarAbaCadastro(prefixo, sufixo));
  }
}

// Setter simples para um <select>: devolve uma função (valor) => void que define o valor
// (usado para preencher o formulário a partir de um registro já salvo).
function _configurarSelect(id, valorPadrao) {
  const select = document.getElementById(id);
  return (valor) => { select.value = valor || valorPadrao; };
}

// CPF/CNPJ é um único campo (aba Documentação) cujo rótulo muda com o tipo de pessoa.
function _configurarRotuloCpfCnpj(prefixo) {
  const label = document.getElementById(`${prefixo}-cpf-cnpj-label`);
  const input = document.getElementById(`${prefixo}-cpf-cnpj`);
  return (tipoPessoa) => {
    if (tipoPessoa === "juridica") {
      label.textContent = "CNPJ";
      input.placeholder = "Ex.: 12.345.678/0001-90";
    } else {
      label.textContent = "CPF";
      input.placeholder = "Ex.: 123.456.789-00";
    }
  };
}

// Select "Pessoa física ou jurídica": troca o rótulo do CPF/CNPJ quando muda.
function _configurarTipoPessoa(prefixo) {
  const select = document.getElementById(`${prefixo}-tipo-pessoa`);
  const atualizarRotulo = _configurarRotuloCpfCnpj(prefixo);
  select.addEventListener("change", () => atualizarRotulo(select.value));
  return (valor) => {
    select.value = valor || "fisica";
    atualizarRotulo(select.value);
  };
}

function _criarSelect(opcoes, valorSelecionado) {
  const select = el("select", { class: "cds--select-input" });
  for (const [valor, rotulo] of opcoes) select.appendChild(el("option", { value: valor, texto: rotulo }));
  select.value = valorSelecionado || "";
  return select;
}

function _criarBotaoRemoverLinha(aoRemover) {
  return el("button", {
    class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", "aria-label": "Remover", texto: "✕",
    onclick: aoRemover,
  });
}

const _TIPOS_TELEFONE = [["", "Tipo"], ["celular", "Celular"], ["residencial", "Residencial"], ["comercial", "Comercial"], ["whatsapp", "WhatsApp"], ["outro", "Outro"]];
const _TIPOS_EMAIL = [["", "Tipo"], ["pessoal", "Pessoal"], ["comercial", "Comercial"], ["outro", "Outro"]];
const _TIPOS_ENDERECO = [["", "Tipo"], ["residencial", "Residencial"], ["comercial", "Comercial"], ["cobranca", "Cobrança"], ["outro", "Outro"]];

let _sequenciaCampoRepetivel = 0;
function identificarGrupoRepetivel(grupo, nome, rotulos) {
  const identificador = ++_sequenciaCampoRepetivel;
  grupo.setAttribute("role", "group");
  const titulo = el("p", { id: `grupo-repetivel-${identificador}`, class: "campo-ajuda grupo-repetivel-titulo", texto: formatarNomeExibicao(nome) });
  grupo.prepend(titulo);
  grupo.setAttribute("aria-labelledby", titulo.id);
  [...grupo.querySelectorAll("input, select")].forEach((campo, i) => {
    campo.id = `campo-repetivel-${identificador}-${i}`;
    const item = el("div", { class: "cds--form-item campo-repetivel" });
    campo.before(item);
    item.append(el("label", { class: "cds--label", for: campo.id, texto: rotulos[i] }), campo);
  });
  const remover = grupo.querySelector("button");
  if (remover) remover.setAttribute("aria-label", `Remover ${nome.toLowerCase()}`);
  queueMicrotask(() => {
    [...(grupo.parentElement?.children || [])].forEach((item, i) => {
      const tituloItem = item.querySelector(".grupo-repetivel-titulo");
      if (!tituloItem) return;
      tituloItem.textContent = `${nome.replace(/ \d+$/, "")} ${i + 1}`;
      item.querySelector("button")?.setAttribute("aria-label", `Remover ${tituloItem.textContent.toLowerCase()}`);
    });
  });
}

// Grupo repetível de telefones: tipo + telefone + operadora + remover.
function _criarGrupoTelefones(prefixo) {
  const lista = document.getElementById(`${prefixo}-telefones-lista`);
  const botaoAdicionar = document.getElementById(`${prefixo}-telefones-adicionar`);

  function adicionarLinha(valor) {
    valor = valor || {};
    const linha = el("div", { class: "linha-repetivel" });
    const selectTipo = _criarSelect(_TIPOS_TELEFONE, valor.tipo);
    const inputTelefone = el("input", { class: "cds--text-input", type: "tel", placeholder: "Digite o telefone", autocomplete: "tel" });
    inputTelefone.value = valor.telefone || "";
    const inputOperadora = el("input", { class: "cds--text-input", type: "text", placeholder: "Operadora", autocomplete: "off" });
    inputOperadora.value = valor.operadora || "";
    linha.appendChild(selectTipo);
    linha.appendChild(inputTelefone);
    linha.appendChild(inputOperadora);
    linha.appendChild(_criarBotaoRemoverLinha(() => { linha.remove(); if (!lista.children.length) adicionarLinha(); }));
    identificarGrupoRepetivel(linha, `Telefone ${lista.children.length + 1}`, ["Tipo", "Telefone", "Operadora"]);
    lista.appendChild(linha);
  }

  botaoAdicionar.addEventListener("click", () => adicionarLinha());

  return {
    definirValores(valores) {
      limpar(lista);
      (valores && valores.length ? valores : []).forEach(adicionarLinha);
    },
    obterValores() {
      return Array.from(lista.children).map((linha) => {
        const [selectTipo, inputTelefone, inputOperadora] = linha.querySelectorAll("select, input");
        return { tipo: selectTipo.value, telefone: inputTelefone.value.trim(), operadora: inputOperadora.value.trim() };
      }).filter((item) => item.telefone);
    },
  };
}

// Grupo repetível de e-mails: tipo + e-mail + remover.
function _criarGrupoEmails(prefixo) {
  const lista = document.getElementById(`${prefixo}-emails-lista`);
  const botaoAdicionar = document.getElementById(`${prefixo}-emails-adicionar`);

  function adicionarLinha(valor) {
    valor = valor || {};
    const linha = el("div", { class: "linha-repetivel" });
    const selectTipo = _criarSelect(_TIPOS_EMAIL, valor.tipo);
    const inputEmail = el("input", { class: "cds--text-input", type: "email", placeholder: "Digite o email", autocomplete: "email" });
    inputEmail.value = valor.email || "";
    linha.appendChild(selectTipo);
    linha.appendChild(inputEmail);
    linha.appendChild(_criarBotaoRemoverLinha(() => { linha.remove(); if (!lista.children.length) adicionarLinha(); }));
    identificarGrupoRepetivel(linha, `E-mail ${lista.children.length + 1}`, ["Tipo", "E-mail"]);
    lista.appendChild(linha);
  }

  botaoAdicionar.addEventListener("click", () => adicionarLinha());

  return {
    definirValores(valores) {
      limpar(lista);
      (valores && valores.length ? valores : []).forEach(adicionarLinha);
    },
    obterValores() {
      return Array.from(lista.children).map((linha) => {
        const [selectTipo, inputEmail] = linha.querySelectorAll("select, input");
        return { tipo: selectTipo.value, email: inputEmail.value.trim() };
      }).filter((item) => item.email);
    },
  };
}

// Grupo repetível de sites: site + remover (sem tipo).
function _criarGrupoSites(prefixo) {
  const lista = document.getElementById(`${prefixo}-sites-lista`);
  const botaoAdicionar = document.getElementById(`${prefixo}-sites-adicionar`);

  function adicionarLinha(valor) {
    valor = valor || {};
    const linha = el("div", { class: "linha-repetivel" });
    const inputSite = el("input", { class: "cds--text-input", type: "url", placeholder: "Digite o site", autocomplete: "url" });
    inputSite.value = valor.site || "";
    linha.appendChild(inputSite);
    linha.appendChild(_criarBotaoRemoverLinha(() => { linha.remove(); if (!lista.children.length) adicionarLinha(); }));
    identificarGrupoRepetivel(linha, `Site ${lista.children.length + 1}`, ["Site"]);
    lista.appendChild(linha);
  }

  botaoAdicionar.addEventListener("click", () => adicionarLinha());

  return {
    definirValores(valores) {
      limpar(lista);
      (valores && valores.length ? valores : []).forEach(adicionarLinha);
    },
    obterValores() {
      return Array.from(lista.children).map((linha) => ({ site: linha.querySelector("input").value.trim() }))
        .filter((item) => item.site);
    },
  };
}

// Busca um CEP via /cep/<cep> (proxy same-origin no próprio servidor, não fala direto com
// viacep.com.br - ver o comentário de _cep_http em server.py: alguns ambientes têm um
// Content-Security-Policy com connect-src 'self' que bloqueia fetch() para domínios de
// terceiro, e indo pelo nosso servidor isso deixa de importar). Devolve {ok: true, dados} ou
// {ok: false, motivo}, distinguindo "CEP não existe" de falha de rede (sempre registrada no
// console, já que o motivo real não aparece pra quem está usando o formulário).
async function _buscarCep(...args) {
  return window.cnjUI.executar(() => _buscarCepSemProgresso(...args), "Consultando CEP");
}

async function _buscarCepSemProgresso(cep) {
  const digitos = (cep || "").replace(/\D/g, "");
  if (digitos.length !== 8) return { ok: false, motivo: "formato" };
  try {
    const resposta = await fetch(`/cep/${digitos}`);
    if (resposta.status === 404) return { ok: false, motivo: "nao_encontrado" };
    if (!resposta.ok) {
      console.error(`Busca de CEP respondeu HTTP ${resposta.status} para o CEP ${digitos}.`);
      return { ok: false, motivo: "http" };
    }
    const dados = await resposta.json();
    if (dados.erro) return { ok: false, motivo: "nao_encontrado" };
    return { ok: true, dados };
  } catch (erro) {
    console.error("Falha ao consultar o CEP:", erro);
    return { ok: false, motivo: "rede" };
  }
}

// Grupo repetível de endereços: cada um é um "card" com tipo + CEP (autopreenche o resto via
// ViaCEP) + rua/número/bairro/complemento/cidade/estado/país + remover.
function _criarGrupoEnderecos(prefixo) {
  const lista = document.getElementById(`${prefixo}-enderecos-lista`);
  const botaoAdicionar = document.getElementById(`${prefixo}-enderecos-adicionar`);

  function adicionarCard(valor) {
    valor = valor || {};
    const card = el("div", { class: "endereco-card" });

    const selectTipo = _criarSelect(_TIPOS_ENDERECO, valor.tipo);
    const inputCep = el("input", { class: "cds--text-input", type: "text", inputmode: "numeric", placeholder: "Digite o CEP", autocomplete: "postal-code" });
    inputCep.value = valor.cep || "";
    const topo = el("div", { class: "endereco-card-topo" }, [
      selectTipo, inputCep,
      _criarBotaoRemoverLinha(() => { card.remove(); if (!lista.children.length) adicionarCard(); }),
    ]);

    const inputRua = el("input", { class: "cds--text-input", placeholder: "Digite a rua", autocomplete: "address-line1" });
    const inputNumero = el("input", { class: "cds--text-input", placeholder: "Digite o número", autocomplete: "off" });
    const inputBairro = el("input", { class: "cds--text-input", placeholder: "Digite o bairro", autocomplete: "off" });
    const inputComplemento = el("input", { class: "cds--text-input", placeholder: "Digite o complemento", autocomplete: "address-line2" });
    const inputCidade = el("input", { class: "cds--text-input", placeholder: "Digite a cidade", autocomplete: "address-level2" });
    const inputEstado = el("input", { class: "cds--text-input", placeholder: "Digite o estado", autocomplete: "address-level1" });
    const inputPais = el("input", { class: "cds--text-input", placeholder: "Digite o país", autocomplete: "country-name" });
    inputRua.value = valor.rua || "";
    inputNumero.value = valor.numero || "";
    inputBairro.value = valor.bairro || "";
    inputComplemento.value = valor.complemento || "";
    inputCidade.value = valor.cidade || "";
    inputEstado.value = valor.estado || "";
    inputPais.value = valor.pais || "Brasil";
    const grade = el("div", { class: "endereco-grade cds--css-grid" }, [
      inputRua, inputNumero, inputBairro, inputComplemento, inputCidade, inputEstado, inputPais,
    ]);

    const statusCep = el("span", { class: "campo-ajuda" });
    _aplicarMascaraCep(inputCep);

    let _cepEmAndamento = "";
    async function autopreencherPorCep() {
      const digitos = inputCep.value.replace(/\D/g, "");
      if (digitos.length !== 8 || digitos === _cepEmAndamento) return;
      _cepEmAndamento = digitos;
      statusCep.textContent = "Buscando CEP…";
      const resultado = await _buscarCep(inputCep.value);
      if (inputCep.value.replace(/\D/g, "") !== digitos) return; // usuário já mudou o CEP
      if (!resultado.ok) {
        statusCep.textContent = resultado.motivo === "nao_encontrado"
          ? "CEP não encontrado."
          : "Não foi possível buscar o CEP agora. Preencha o endereço manualmente.";
        return;
      }
      const encontrado = resultado.dados;
      inputRua.value = encontrado.logradouro || inputRua.value;
      inputBairro.value = encontrado.bairro || inputBairro.value;
      inputCidade.value = encontrado.localidade || inputCidade.value;
      inputEstado.value = encontrado.uf || inputEstado.value;
      if (!inputPais.value) inputPais.value = "Brasil";
      statusCep.textContent = "";
      if (!inputNumero.value) inputNumero.focus();
    }
    // Busca assim que o 8º dígito é digitado (sem precisar sair do campo), e também ao sair do
    // campo ou apertar Enter - cobre teclado numérico mobile, colar o CEP, etc.
    inputCep.addEventListener("input", () => {
      statusCep.textContent = "";
      _cepEmAndamento = "";
      if (inputCep.value.replace(/\D/g, "").length === 8) autopreencherPorCep();
    });
    inputCep.addEventListener("blur", autopreencherPorCep);
    inputCep.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); autopreencherPorCep(); }
    });

    card.appendChild(topo);
    card.appendChild(grade);
    card.appendChild(statusCep);
    statusCep.setAttribute("role", "status");
    identificarGrupoRepetivel(card, `Endereço ${lista.children.length + 1}`, ["Tipo", "CEP", "Rua", "Número", "Bairro", "Complemento", "Cidade", "Estado", "País"]);
    lista.appendChild(card);
  }

  botaoAdicionar.addEventListener("click", () => adicionarCard());

  return {
    definirValores(valores) {
      limpar(lista);
      (valores && valores.length ? valores : []).forEach(adicionarCard);
    },
    obterValores() {
      return Array.from(lista.children).map((card) => {
        const selectTipo = card.querySelector("select");
        const [inputCep, inputRua, inputNumero, inputBairro, inputComplemento, inputCidade, inputEstado, inputPais] =
          card.querySelectorAll("input");
        return {
          tipo: selectTipo.value, cep: inputCep.value.trim(), rua: inputRua.value.trim(),
          numero: inputNumero.value.trim(), bairro: inputBairro.value.trim(),
          complemento: inputComplemento.value.trim(), cidade: inputCidade.value.trim(),
          estado: inputEstado.value.trim(), pais: inputPais.value.trim(),
        };
      }).filter((item) => item.rua || item.cep || item.cidade);
    },
  };
}

function _configurarCadastroCompleto(prefixo) {
  _configurarAbasCadastro(prefixo);
  return {
    telefones: _criarGrupoTelefones(prefixo),
    emails: _criarGrupoEmails(prefixo),
    sites: _criarGrupoSites(prefixo),
    enderecos: _criarGrupoEnderecos(prefixo),
  };
}

// Campos extras do cadastro completo (abas Documentação e Informações complementares),
// comuns ao modal e à tela de detalhe.
const _CAMPOS_CADASTRO_COMPLETO = [
  "rg_numero", "rg_emissao", "rg_emissor", "ctps_numero", "ctps_serie", "ctps_emissao", "ctps_uf",
  "pis", "estado_civil", "nacionalidade", "profissao",
];

function _lerCadastroCompleto(prefixo, grupos) {
  const dados = {
    telefones: grupos.telefones.obterValores(),
    emails: grupos.emails.obterValores(),
    sites: grupos.sites.obterValores(),
    enderecos: grupos.enderecos.obterValores(),
  };
  for (const campo of _CAMPOS_CADASTRO_COMPLETO) {
    dados[campo] = document.getElementById(`${prefixo}-${campo.replace(/_/g, "-")}`).value.trim();
  }
  dados.tipo_pessoa = document.getElementById(`${prefixo}-tipo-pessoa`).value;
  dados.perfil = document.getElementById(`${prefixo}-perfil`).value;
  return dados;
}

function _preencherCadastroCompleto(prefixo, grupos, registro, definirTipoPessoa, selecionarPerfil) {
  grupos.telefones.definirValores(
    registro.telefones && registro.telefones.length ? registro.telefones
      : registro.telefone ? [{ telefone: registro.telefone }] : [],
  );
  grupos.emails.definirValores(
    registro.emails && registro.emails.length ? registro.emails
      : registro.email ? [{ email: registro.email }] : [],
  );
  grupos.sites.definirValores(
    registro.sites && registro.sites.length ? registro.sites
      : registro.site ? [{ site: registro.site }] : [],
  );
  grupos.enderecos.definirValores(
    registro.enderecos && registro.enderecos.length ? registro.enderecos
      : registro.endereco_rua ? [{
        rua: registro.endereco_rua, numero: registro.endereco_numero, bairro: registro.endereco_bairro,
        complemento: registro.endereco_complemento, cidade: registro.endereco_cidade,
        estado: registro.endereco_estado, pais: registro.endereco_pais,
      }] : [],
  );
  for (const campo of _CAMPOS_CADASTRO_COMPLETO) {
    document.getElementById(`${prefixo}-${campo.replace(/_/g, "-")}`).value = registro[campo] || "";
  }
  definirTipoPessoa(registro.tipo_pessoa || "fisica");
  selecionarPerfil(registro.perfil || "cliente");
}

const gruposContato = _configurarCadastroCompleto("contato");
const definirTipoPessoaContato = _configurarTipoPessoa("contato");
const definirPerfilContato = _configurarSelect("contato-perfil", "cliente");

const formCaso = document.getElementById("form-caso");
const resultadoCaso = document.getElementById("resultado-caso");

registrarSalvamento(formCaso, async (evento) => {
  evento.preventDefault();
  if (!exigirCliente(resultadoCaso)) return;
  const buscaCliente = document.getElementById("caso-cliente-busca");
  const clienteIdExistente = document.getElementById("caso-cliente").value;
  const nomePrincipalDigitado = buscaCliente.value.trim();
  const nomePrincipalCapturado = _partesCapturadasNovoCaso.find(
    (p) => p.nome.trim().toUpperCase() === nomePrincipalDigitado.toUpperCase()
  );
  if (!clienteIdExistente && !(nomePrincipalDigitado && nomePrincipalCapturado)) {
    mostrarErro(resultadoCaso, "Selecione um cliente existente ou escolha uma parte capturada externamente.");
    buscaCliente.focus();
    return;
  }
  const botao = document.querySelector("button[form='form-caso'][type='submit']");
  const numeros = document.getElementById("caso-processos").value.split(",").map((s) => s.trim()).filter(Boolean);
  const corpo = {
    ...(clienteIdExistente ? { cliente_id: clienteIdExistente } : { cliente_novo: { nome: nomePrincipalDigitado } }),
    clientes_adicionais: _partesCapturadasNovoCaso
      .filter((p) => p.nome.trim().toUpperCase() !== nomePrincipalDigitado.toUpperCase())
      .map((p) => ({ cliente_novo: { nome: p.nome.trim() } })),
    titulo: document.getElementById("caso-titulo").value.trim(),
    responsavel: document.getElementById("caso-responsavel").value.trim(),
    acao: document.getElementById("caso-acao").value.trim(),
    foro: document.getElementById("caso-foro").value.trim(),
    pasta: document.getElementById("caso-pasta").value.trim(),
    acesso: document.getElementById("caso-acesso").value,
    numeros_processo: numeros,
  };
  const pararEspera = mostrarEspera(resultadoCaso, botao, "Cadastrando processo");
  try {
    const novoCaso = await _enviarJson("/casos", corpo);
    formCaso.reset();
    document.getElementById("caso-cliente-busca").value = "";
    document.getElementById("caso-cliente").value = "";
    _resetarIndicadoresCapturaExterna();
    marcarFormularioSalvo(formCaso, true);
    _cache.casos = [..._cache.casos, novoCaso];
    _renderizarTabelaCasosPagina();
    limpar(resultadoCaso);
    const divSucesso = el("div", {});
    divSucesso.appendChild(notificacao("success", `Processo "${novoCaso.titulo || "sem título"}" cadastrado.`));
    const btnAbrirCaso = el("button", {
      class: "cds--btn cds--btn--primary cds--btn--sm",
      type: "button",
      style: "margin-top: 0.75rem; display: block;",
      texto: "Abrir processo criado",
    });
    btnAbrirCaso.addEventListener("click", async () => {
      fecharModal("modal-novo-caso");
      if (!(await selecionarAba(abas.find((a) => a.painel.id === "aba-casos")))) return;
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

// Partes capturadas externamente para o "Novo processo": a escolhida vira o cliente
// principal, as demais são enviadas como clientes_adicionais no POST /casos.
let _partesCapturadasNovoCaso = [];

function _resetarIndicadoresCapturaExterna() {
  _partesCapturadasNovoCaso = [];
  limpar(document.getElementById("status-datajud-modal"));
  const partesEl = document.getElementById("caso-partes-captura");
  limpar(partesEl);
  partesEl.hidden = true;
  document.getElementById("caso-titulo-aviso").hidden = true;
  document.getElementById("caso-acao-tag").hidden = true;
  document.getElementById("caso-foro-tag").hidden = true;
  document.getElementById("caso-titulo-tag").hidden = true;
}

document.getElementById("btn-novo-contato").addEventListener("click", abrirNovoContato);
document.getElementById("btn-novo-caso").addEventListener("click", async () => {
  if (!_cache.clientes.length) {
    try { const { clientes } = await _buscarJson("/clientes"); _cache.clientes = clientes || []; } catch { /* segue */ }
  }
  _resetarIndicadoresCapturaExterna();
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
    const filtrados = _cache.clientes.filter((c) => c.nome.toLowerCase().includes(termo.toLowerCase()));
    if (!filtrados.length) { lista.hidden = true; return; }
    filtrados.slice(0, 10).forEach((c) => {
      const btn = el("button", { type: "button", texto: formatarNomeExibicao(c.nome) });
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
document.getElementById("contatos-limpar-filtros").addEventListener("click", limparFiltrosContatos);
document.getElementById("clientes-lote-etiquetas").addEventListener("click", () => abrirClientesLote("etiquetas"));
document.getElementById("clientes-lote-perfil").addEventListener("click", () => abrirClientesLote("perfil"));
document.getElementById("clientes-lote-cancelar").addEventListener("click", () => { _limparSelecaoClientes(); renderizarListaContatos(); document.getElementById("contatos-titulo").focus(); });
document.getElementById("clientes-lote-confirmar").addEventListener("click", executarClientesLote);
document.getElementById("clientes-lote-voltar").addEventListener("click", _configurarClientesLote);
document.getElementById("clientes-lote-operacao").addEventListener("change", evento => { document.getElementById("clientes-lote-nova-campo").hidden = evento.target.value === "remover_etiquetas"; });
document.getElementById("contato-subaba-cadastro-botao").addEventListener("click", () => _selecionarSubabaContato("cadastro"));
document.getElementById("contato-subaba-processos-botao").addEventListener("click", () => _selecionarSubabaContato("processos"));
document.getElementById("contato-subaba-financeiro-botao").addEventListener("click", () => _selecionarSubabaContato("financeiro"));
document.getElementById("contato-financeiro-atualizar").addEventListener("click", carregarFinanceiroContato);
document.getElementById("contatos-busca").addEventListener("input", (evento) => {
  _limparSelecaoClientes();
  _contatosFiltroBusca = evento.target.value;
  renderizarListaContatos();
});

document.getElementById("casos-busca").addEventListener("input", (evento) => {
  _filtroCasos = evento.target.value;
  _renderizarTabelaCasosPagina();
});

const formContatoCadastro = document.getElementById("form-contato-cadastro");
const resultadoContatoCadastro = document.getElementById("resultado-contato-cadastro");

registrarSalvamento(formContatoCadastro, async (evento) => {
  evento.preventDefault();
  const clienteId = formContatoCadastro.dataset.clienteId;
  const criando = !clienteId;
  if (criando && !exigirCliente(resultadoContatoCadastro)) return;
  const botao = formContatoCadastro.querySelector("button[type=submit]");
  const corpo = {
    nome: document.getElementById("contato-nome").value.trim(),
    cpf_cnpj: document.getElementById("contato-cpf-cnpj").value.trim(),
    observacoes: document.getElementById("contato-observacoes").value.trim(),
    ..._lerCadastroCompleto("contato", gruposContato),
  };
  const pararEspera = mostrarEspera(resultadoContatoCadastro, botao, criando ? "Cadastrando cliente" : "Salvando");
  try {
    const salvo = criando
      ? await _enviarJson("/clientes", corpo)
      : await _enviarJson(`/clientes/${clienteId}`, corpo, "PATCH");
    limpar(resultadoContatoCadastro);
    resultadoContatoCadastro.appendChild(notificacao("success", criando ? "Cliente cadastrado" : "Cliente atualizado"));
    document.getElementById("contato-detalhe-nome").textContent = formatarNomeExibicao(salvo.nome);
    formContatoCadastro.dataset.clienteId = salvo.id;
    marcarFormularioSalvo(formContatoCadastro);
    if (criando) {
      _definirModoCadastroContato("existente");
      _cache.clientes = [..._cache.clientes, salvo];
      await _renderizarProcessosVinculados(salvo.id);
    } else {
      const indice = _cache.clientes.findIndex((c) => c.id === clienteId);
      if (indice !== -1) _cache.clientes[indice] = salvo;
    }
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
    _cache.clientes = _cache.clientes.filter((c) => c.id !== clienteId);
    marcarFormularioSalvo(formContatoCadastro, true);
    await voltarParaContatos();
    mostrarToast("success", "Cliente excluído");
  } catch (erro) {
    mostrarErro(resultadoContatoCadastro, erro.message);
    botao.disabled = false;
  }
});

// Botão "Cadastrar como processo" no resultado da consulta de processo (DataJud): abre um mini
// formulário inline, sem precisar trocar de aba. Cria o cliente na hora se for novo (Fase 1).
function anexarBotaoCadastrarCaso(acoes, numeroProcesso, aoSalvar, opcoes = {}) {
  const { rotulo, tituloModal, nomeSugerido, tituloSugerido, partes, tribunal, hashPublicacao, dadosPublicacao, classeBotao } = opcoes;
  const botao = el("button", {
    class: classeBotao || "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: rotulo || "Cadastrar como processo",
  });
  acoes.appendChild(botao);

  botao.addEventListener("click", async () => {
    if (!_cache.clientes.length) {
      try {
        const { clientes } = await _buscarJson("/clientes");
        _cache.clientes = clientes || [];
      } catch {
        // segue mesmo sem conseguir pré-carregar: o select só vai ficar com "Novo cliente"
      }
    }

    const usaCheckboxesPartes = Boolean(partes && partes.length);

    const selectCliente = el("select", { class: "cds--select-input", "aria-label": "Cliente" }, [
      el("option", { value: "" }, ["+ Novo cliente"]),
      ..._cache.clientes.map((c) => el("option", { value: c.id }, [c.nome])),
    ]);
    const campoNomeNovo = el("input", {
      class: "cds--text-input",
      "aria-label": usaCheckboxesPartes ? "Outro cliente (opcional)" : "Nome do novo cliente",
      placeholder: usaCheckboxesPartes ? "+ outro cliente (opcional)" : "Nome do novo cliente",
      value: usaCheckboxesPartes ? "" : (nomeSugerido || ""),
    });
    const campoTitulo = el("input", { class: "cds--text-input", "aria-label": "Título do processo (opcional)", placeholder: "Título do processo (opcional)", value: tituloSugerido || "" });
    const campoAcao = el("input", { class: "cds--text-input", "aria-label": "Ação (opcional)", placeholder: "Ação (opcional)" });
    const campoForo = el("input", { class: "cds--text-input", "aria-label": "Foro (opcional)", placeholder: "Foro (opcional)" });
    const botaoSalvar = el("button", { class: "cds--btn cds--btn--primary cds--btn--sm", type: "submit", texto: "Salvar processo" });
    const miniForm = el("form", { class: "mini-form-caso", id: "form-caso-publicacao" });
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
          el("label", { class: "cds--label", texto: "Cadastrar como cliente(s) deste processo" }),
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

    registrarSalvamento(miniForm, async (evento) => {
      evento.preventDefault();
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
            mostrarToast("warning", "Processo criado", `Processo cadastrado, mas não foi possível vincular a publicação: ${erroVinculo.message}`);
          }
        }
        marcarFormularioSalvo(miniForm);
        fecharModal("modal-cadastrar-caso-publicacao");
        mostrarToast("success", "Processo cadastrado", publicacaoVinculada ? "Processo criado e publicação vinculada." : "Processo criado.");
        if (aoSalvar) aoSalvar();
      } catch (erro) {
        statusMini.textContent = erro.message;
        botaoSalvar.disabled = false;
      }
    });

    miniForm.append(...[
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
    ].filter(Boolean));
    const corpoModal = document.getElementById("modal-cadastrar-caso-publicacao-corpo");
    for (const form of corpoModal.querySelectorAll("form")) formulariosProtegidos.delete(form);
    limpar(corpoModal);
    document.getElementById("modal-cadastrar-caso-publicacao-titulo").textContent = tituloModal || rotulo || "Cadastrar como processo";
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
      container.appendChild(notificacao("info", "Nenhum processo cadastrado", "Cadastre este processo antes de criar o evento na agenda."));
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
      el("div", { class: "cds--form-item" }, [el("label", { class: "cds--label", texto: "Vincular ao processo" }), selectCaso]),
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
  return el("cds-tag", { class: "pub-oab-status", type: cor, size: "sm" }, [
    el("span", { class: "pub-oab-status-texto", texto: _ROTULO_STATUS_PUB_OAB[status] || status }),
  ]);
}

async function _irParaConsultaProcesso(numeroProcesso) {
  const abaProcesso = abas.find((a) => a.painel.id === "aba-processo");
  if (abaProcesso && !(await selecionarAba(abaProcesso))) return;
  const campo = document.getElementById("numero-processo");
  if (campo) campo.value = numeroProcesso || "";
  const campTribunal = document.getElementById("tribunal");
  if (campTribunal && !campTribunal.value) {
    const sigla = _siglaTribunal(numeroProcesso || "");
    if (sigla) campTribunal.value = sigla;
  }
}

const _publicacoesOabSelecionadas = new Set();
let _pubOabCarregando = false;
let _pubOabAtualizando = false;
let _pubOabInlineEnviando = false;
let _pubOabPagina = 1;
let _pubOabTamanho = 5;
let _pubOabRequisicao = 0;
const _pubOabExpandidas = new Set();

function _sincronizarSelecaoPubOab() {
  const container = document.getElementById("lista-publicacoes-oab");
  const linhas = [...container.querySelectorAll("input[data-publicacao-hash]")];
  for (const campo of linhas) {
    campo.checked = _publicacoesOabSelecionadas.has(campo.dataset.publicacaoHash);
    campo.disabled = _pubOabAtualizando || _pubOabInlineEnviando;
    const linha = campo.closest("cds-table-row");
    linha.classList.toggle("pub-oab-linha--selecionada", campo.checked);
    linha.selected = campo.checked;
  }
  const todos = container.querySelector("input[data-publicacoes-todas]");
  if (todos) {
    const selecionadas = linhas.filter((campo) => campo.checked).length;
    todos.checked = linhas.length > 0 && selecionadas === linhas.length;
    todos.indeterminate = selecionadas > 0 && selecionadas < linhas.length;
    todos.disabled = _pubOabAtualizando || _pubOabInlineEnviando;
  }
  _atualizarBotoesLotePubOab();
}

function _acaoLinhaBloqueadaPubOab() {
  return _publicacoesOabSelecionadas.size > 0 || _pubOabCarregando || _pubOabAtualizando || _pubOabInlineEnviando;
}

function _atualizarBotoesLotePubOab() {
  const quantidade = _publicacoesOabSelecionadas.size;
  const bloqueada = _acaoLinhaBloqueadaPubOab();
  if (bloqueada) _fecharTodosComboMenusOab();
  for (const acao of document.querySelectorAll('[data-pub-oab-acao]')) {
    acao.disabled = bloqueada;
    acao.inert = bloqueada;
  }
  for (const linha of document.querySelectorAll('.pub-oab-inline-row')) {
    const suspenso = quantidade > 0;
    linha.querySelector('form').inert = suspenso;
    linha.classList.toggle('pub-oab-inline-row--suspensa', suspenso);
    linha.querySelector('.pub-oab-inline-suspensao').hidden = !suspenso;
  }
  const tem = !_pubOabCarregando && !_pubOabAtualizando && !_pubOabInlineEnviando && quantidade > 0;
  for (const botao of document.querySelectorAll("[data-status-lote]")) botao.disabled = !tem;
  const toolbar = document.querySelector(".pub-oab-tabela-toolbar");
  if (toolbar) toolbar.hidden = quantidade > 0;
  for (const controle of document.querySelectorAll(".pub-oab-paginacao button, .pub-oab-paginacao select, [data-cancelar-lote]")) {
    controle.disabled = _pubOabAtualizando || _pubOabCarregando || _pubOabInlineEnviando || controle.dataset.limite === "true";
  }
  const barra = document.getElementById("pub-oab-batch");
  if (barra) {
    barra.hidden = quantidade === 0;
    barra.classList.toggle("cds--batch-actions--active", quantidade > 0);
    document.getElementById("pub-oab-selecionadas").textContent = `${quantidade} ${quantidade === 1 ? "selecionada" : "selecionadas"}`;
  }
}

function _statusGeralPubOab(mensagem, erro) {
  const areaStatus = document.getElementById("pub-oab-status-geral");
  if (!areaStatus) return;
  limpar(areaStatus);
  if (mensagem) areaStatus.appendChild(notificacao(erro ? "error" : "success", mensagem));
}

async function _aplicarStatusPubOab(hashes, status) {
  if (!hashes.length || _pubOabAtualizando || _pubOabCarregando || _pubOabInlineEnviando) return;
  _pubOabAtualizando = true;
  _sincronizarSelecaoPubOab();
  try {
    const resultado = await _enviarJson("/publicacoes-oab/status", { hashes, status });
    const atualizados = resultado.hashes_atualizados || (resultado.atualizadas === hashes.length ? hashes : []);
    const falhas = resultado.hashes_falharam || hashes.filter((h) => !atualizados.includes(h));
    for (const hash of atualizados) _publicacoesOabSelecionadas.delete(hash);
    if (falhas.length) {
      mostrarToast("error", "Atualização parcial", `${atualizados.length} atualizadas; ${falhas.length} não atualizadas. Revise a seleção e tente novamente.`);
    } else {
      mostrarToast("success", "Status atualizado",
        `${atualizados.length} ${atualizados.length === 1 ? "publicação marcada" : "publicações marcadas"} como “${_ROTULO_STATUS_PUB_OAB[status]}”.`);
    }
    await carregarPublicacoesOab();
  } catch (erro) {
    mostrarToast("error", "Não foi possível atualizar o status", erro.message);
  } finally {
    _pubOabAtualizando = false;
    _sincronizarSelecaoPubOab();
  }
}

let _pubOabContadorLinha = 0;

// Formata somente dados de nomes na exibição, sem alterar o valor persistido.
function formatarNomeExibicao(valor) {
  return String(valor ?? "").toLocaleLowerCase("pt-BR").replace(/(^|[^\p{L}\p{N}])(\p{L})/gu,
    (_, separador, letra) => separador + letra.toLocaleUpperCase("pt-BR"));
}

function _valorPubOab(valor, literal = false) {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (Array.isArray(valor)) return valor.map((v) => _valorPubOab(v, literal)).join(" · ") || "—";
  if (typeof valor === "object") return Object.entries(valor).map(([k, v]) => {
    const rotulo = ({ nome: "Nome", uf_oab: "UF da OAB", numero_oab: "Número da OAB" })[k] || _rotuloCampoDjen(k);
    const preservar = literal || /(^|_)(uf|oab|id|hash|url|link|numero)(_|$)/i.test(k);
    return `${rotulo}: ${k === "nome" ? formatarNomeExibicao(v) : _valorPubOab(v, preservar)}`;
  }).join("; ");
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  return literal ? String(valor) : String(valor).charAt(0).toLocaleUpperCase("pt-BR") + String(valor).slice(1).toLocaleLowerCase("pt-BR");
}

const _COLUNAS_FIXAS_PUB_OAB = new Set(["processo", "tribunal", "nome"]);

function _nomeProcessoPubOab(p) {
  const partes = p.dados?.destinatarios || [];
  const nomes = (polo) => [...new Set(partes.filter((d) => String(d.polo || "").toUpperCase() === polo).map((d) => d.nome).filter(Boolean))].map(formatarNomeExibicao).join(" / ");
  return `${nomes("A") || "Parte ativa não informada"} X ${nomes("P") || "Parte passiva não informada"}`;
}

function _publicacaoCompletaPubOab(p, id) {
  const d = p.dados || {};
  const informacoes = [
    ["Processo", formatarNumeroCNJ(d.numeroprocessocommascara || p.numero_processo || "")],
    ["Nome do processo", _nomeProcessoPubOab(p)],
    ["Partes", (d.destinatarios || []).map((parte) => `${parte.nome ? formatarNomeExibicao(parte.nome) : "—"} (${parte.polo || "Polo não informado"})`).join("; ")],
    ["Tribunal", (d.siglaTribunal || "").toUpperCase()], ["Órgão", d.nomeOrgao],
    ["Divulgado", formatarDataSimples(d.data_disponibilizacao)],
    ["Tipo", d.tipoComunicacao], ["Documento", d.tipoDocumento], ["Classe", d.nomeClasse],
    ["Advogados", (d.destinatarioadvogados || []).map((a) => `${a.nome ? formatarNomeExibicao(a.nome) : "—"} · OAB ${a.numero_oab || "—"}/${a.uf_oab || "—"}`).join("; ")],
  ];
  return el("article", { id, class: "pub-oab-publicacao-completa", "aria-label": "Publicação completa" }, [
    el("header", { class: "pub-oab-publicacao-cabecalho" }, informacoes.filter(([, valor]) => valor).map(([rotulo, valor]) => el("p", {}, [el("strong", { texto: `${rotulo}: ${valor}` })]))),
    el("div", { class: "pub-oab-publicacao-texto", texto: d.texto || "Texto não informado" }),
  ]);
}

function _normalizarConsultaPubOab(valor) {
  return String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function _abrirFluxoInlinePubOab(tr, p, colunas, tipo, origem) {
  if (_acaoLinhaBloqueadaPubOab()) return;
  const anterior = [...tr.parentElement.querySelectorAll(".pub-oab-inline-row")].find((linha) => linha.dataset.fluxoPublicacao === p.hash);
  if (anterior) anterior.remove();
  const id = `pub-oab-fluxo-${++_pubOabContadorLinha}`;
  const busca = el("input", { id: `${id}-busca`, type: "search", class: "cds--text-input", autocomplete: "off",
    placeholder: tipo === "cadastro" ? "Nome do cliente" : "Número, parte ou cliente" });
  const resultados = el("div", { class: "pub-oab-resultados-busca", "aria-label": "Resultados da consulta" });
  const escolhido = el("div", { class: "pub-oab-confirmacao", hidden: "hidden" });
  const status = el("p", { id: `${id}-status`, class: "campo-ajuda", role: "status", "aria-live": "polite", texto: "Carregando…" });
  busca.setAttribute("aria-describedby", status.id);
  const confirmar = el("button", { type: "submit", class: "cds--btn cds--btn--primary cds--btn--sm", texto: tipo === "cadastro" ? "Confirmar cadastro" : "Confirmar vínculo", disabled: "disabled" });
  const cancelar = el("button", { type: "button", class: "cds--btn cds--btn--ghost cds--btn--sm", texto: "Cancelar" });
  const responsavel = el("select", { id: `${id}-responsavel`, class: "cds--select-input", required: "required" }, [el("option", { value: "", texto: "Selecione o responsável" })]);
  const form = el("form", { class: "pub-oab-inline-form", "aria-label": tipo === "cadastro" ? "Cadastrar processo" : "Vincular a processo existente" }, [
    el("h3", { texto: tipo === "cadastro" ? "Cadastrar processo" : "Vincular a processo existente" }),
    el("p", { class: "campo-ajuda", texto: `${formatarNumeroCNJ(p.numero_processo || "")} · ${_nomeProcessoPubOab(p)}` }),
    el("div", { class: "cds--form-item" }, [el("label", { class: "cds--label", for: busca.id, texto: tipo === "cadastro" ? "Cliente" : "Consultar processo" }), busca]),
    resultados, escolhido,
    ...(tipo === "cadastro" ? [el("div", { class: "cds--form-item" }, [el("label", { class: "cds--label", for: responsavel.id, texto: "Responsável" }), responsavel])] : []),
    status, el("div", { class: "pub-oab-inline-acoes" }, [confirmar, cancelar]),
  ]);
  const linha = el("cds-table-expanded-row", { class: "pub-oab-inline-row", expanded: "", colspan: String(colunas.length + 3), "data-fluxo-publicacao": p.hash }, [el("p", { class: "pub-oab-inline-suspensao campo-ajuda", role: "status", hidden: "hidden", texto: "Formulário pausado durante a seleção em lote. Cancele a seleção para continuar; os valores foram preservados." }), form]);
  const expansao = tr.nextElementSibling;
  if (expansao?.matches(".pub-oab-expansao")) expansao.after(linha);
  else tr.after(linha);
  tr.closest("cds-table")?._pubOabAplicarColunas?.();
  cancelar.addEventListener("click", () => { linha.remove(); origem.focus(); });
  // O conteúdo só fica disponível para foco após o primeiro render do Web Component.
  await linha.updateComplete;
  if (!linha.isConnected) return;
  busca.focus();
  let selecionado = null, clientes = [], pronto = false, requisicao = 0, temporizador;
  const escolher = (item, descricao) => {
    selecionado = item;
    limpar(escolhido);
    escolhido.append(el("strong", { texto: tipo === "cadastro" ? "Cliente selecionado" : "Confirmar processo selecionado" }), el("p", { texto: descricao }));
    escolhido.hidden = false;
    confirmar.disabled = false;
    limpar(resultados);
    status.textContent = "Confira os dados e confirme abaixo.";
  };
  const exibir = (itens) => {
    limpar(resultados);
    if (!itens.length) { status.textContent = "Nenhum resultado. Altere os termos da consulta."; return; }
    for (const item of itens.slice(0, 20)) {
      const cliente = clientes.find((c) => c.id === item.cliente_id);
      const descricao = tipo === "cadastro" ? formatarNomeExibicao(item.nome) : [item.titulo, item.autor, item.reu].map(formatarNomeExibicao).concat([ ...(item.processos || []).map(formatarNumeroCNJ), formatarNomeExibicao(cliente?.nome || item.nome_cliente)]).filter(Boolean).join(" · ");
      const botao = el("button", { type: "button", class: "cds--btn cds--btn--ghost cds--btn--sm", texto: descricao });
      botao.addEventListener("click", () => escolher(item, descricao));
      resultados.appendChild(botao);
    }
    status.textContent = `${Math.min(itens.length, 20)} resultado(s). Selecione um para confirmar.`;
  };
  busca.addEventListener("input", () => {
    selecionado = null; confirmar.disabled = true; escolhido.hidden = true; limpar(resultados);
    clearTimeout(temporizador); const numeroRequisicao = ++requisicao;
    if (!pronto) return;
    const termo = busca.value.trim();
    if (!termo) { status.textContent = "Informe um termo para consultar."; return; }
    if (tipo === "cadastro") { exibir(clientes.filter((c) => _normalizarConsultaPubOab(c.nome).includes(_normalizarConsultaPubOab(termo)))); return; }
    status.textContent = "Consultando processos…";
    temporizador = setTimeout(async () => {
      try {
        const dados = await _buscarJson(`/casos?q=${encodeURIComponent(termo)}`);
        if (numeroRequisicao === requisicao && linha.isConnected) exibir(dados.casos || []);
      } catch (erro) { if (numeroRequisicao === requisicao && linha.isConnected) status.textContent = erro.message; }
    }, 200);
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!selecionado || confirmar.disabled || _acaoLinhaBloqueadaPubOab()) return;
    _pubOabInlineEnviando = true;
    _sincronizarSelecaoPubOab();
    confirmar.disabled = true; cancelar.disabled = true; busca.disabled = true; responsavel.disabled = true;
    status.textContent = tipo === "cadastro" ? "Cadastrando processo…" : "Vinculando publicação…";
    try {
      if (tipo === "cadastro") await _enviarJson(`/publicacoes-oab/${encodeURIComponent(p.hash)}/criar-caso`, { cliente_id: selecionado.id, responsavel: responsavel.value });
      else await _enviarJson(`/casos/${encodeURIComponent(selecionado.id)}/publicacoes`, { hash: p.hash, numero_processo: p.numero_processo || null, dados: p.dados || null });
      mostrarToast("success", tipo === "cadastro" ? "Processo cadastrado" : "Publicação vinculada", tipo === "cadastro" ? "Dados capturados preenchidos e publicação vinculada." : "Vínculo confirmado.");
      await carregarPublicacoesOab();
    } catch (erro) {
      status.textContent = erro.message;
      confirmar.disabled = false; cancelar.disabled = false; busca.disabled = false; responsavel.disabled = false;
    } finally {
      _pubOabInlineEnviando = false;
      _sincronizarSelecaoPubOab();
    }
  });
  try {
    const dadosClientes = await _buscarJson("/clientes"); clientes = dadosClientes.clientes || [];
    if (tipo === "cadastro") {
      const dados = await _buscarJson("/responsaveis");
      for (const nome of dados.responsaveis || []) responsavel.appendChild(el("option", { value: nome, texto: formatarNomeExibicao(nome) }));
    }
    pronto = true;
    status.textContent = "Informe um termo para consultar.";
    if (busca.value) busca.dispatchEvent(new Event("input"));
  } catch (erro) {
    status.textContent = `Não foi possível carregar as opções: ${erro.message}`;
    const repetir = el("button", { type: "button", class: "cds--btn cds--btn--ghost cds--btn--sm", texto: "Tentar novamente" });
    repetir.addEventListener("click", () => _abrirFluxoInlinePubOab(tr, p, colunas, tipo, origem));
    resultados.appendChild(repetir);
  }
}

function _rotuloCampoDjen(chave) {
  // Rótulo de interface: nunca usar o formatador de nomes ou transformar o dado.
  const siglas = new Set(["oab", "uf", "id", "cnj", "djen", "url", "api", "cpf", "cnpj"]);
  const palavras = chave
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2")
    .replace(/_/g, " ").trim().toLocaleLowerCase("pt-BR").split(/\s+/);
  return palavras.map((palavra, indice) => siglas.has(palavra)
    ? palavra.toLocaleUpperCase("pt-BR")
    : indice === 0 ? palavra.charAt(0).toLocaleUpperCase("pt-BR") + palavra.slice(1) : palavra).join(" ");
}

function _colunasPubOab(publicacoes = [], camposDjen = []) {
  const colunas = [
    ["divulgado", "Divulgado", (p) => formatarDataSimples(p.dados?.data_disponibilizacao), false],
    ["capturado", "Capturado", (p) => formatarData(p.criado_em), false],
    ["tipo", "Tipo", (p) => p.dados?.tipoComunicacao, false],
    ["processo", "Processo", () => "", true],
    ["tribunal", "Tribunal", (p) => (p.dados?.siglaTribunal || "").toUpperCase(), true, true],
    ["orgao", "Órgão", (p) => p.dados?.nomeOrgao, false],
    ["nome", "Nome do processo", _nomeProcessoPubOab, true, true],
    ["referencia", "Nome de referência", (p) => formatarNomeExibicao(p.nome_pesquisado), false, true],
    ["status", "Status", (p) => _ROTULO_STATUS_PUB_OAB[p.status] || p.status, false],
    ["documento", "Tipo de documento", (p) => p.dados?.tipoDocumento, false],
    ["classe", "Classe", (p) => p.dados?.nomeClasse, false],
    ["destinatarios", "Destinatários", (p) => (p.dados?.destinatarios || []).map((d) => formatarNomeExibicao(d.nome)), false, true],
    ["polos", "Polos dos destinatários", (p) => (p.dados?.destinatarios || []).map((d) => d.polo), false],
    ["advogados", "Advogados", (p) => (p.dados?.destinatarioadvogados || []).map((d) => formatarNomeExibicao(d.nome)), false, true],
    ["oab", "Número da OAB", (p) => (p.dados?.destinatarioadvogados || []).map((d) => d.numero_oab), false, true],
    ["uf", "UF da OAB", (p) => (p.dados?.destinatarioadvogados || []).map((d) => d.uf_oab), false, true],
    ["dados_advogados", "Dados dos advogados", (p) => p.dados?.destinatarioadvogados, false],
    ["texto", "Texto", (p) => p.dados?.texto, false, true],
    ["hash", "Hash", (p) => p.dados?.hash || p.hash, false, true],
    ["link", "Link", (p) => p.dados?.link, false, true],
  ].map(([id, rotulo, valor, padrao, literal = false]) => ({ id, rotulo, valor, padrao, literal }));
  const conhecidos = new Set(["data_disponibilizacao", "siglaTribunal", "nomeOrgao", "tipoComunicacao", "tipoDocumento", "nomeClasse", "numeroprocessocommascara", "destinatarios", "destinatarioadvogados", "texto", "hash", "link"]);
  const extras = new Set([...camposDjen, ...publicacoes.flatMap((p) => Object.keys(p.dados || {}))].filter((k) => !conhecidos.has(k)));
  for (const chave of [...extras].sort()) {
    colunas.push({ id: `djen:${chave}`, rotulo: _rotuloCampoDjen(chave),
      valor: (p) => p.dados?.[chave], padrao: false, literal: /(^id$|hash|url|link|numero)/i.test(chave) });
  }
  const ordem = { tribunal: 0, processo: 1, nome: 2 };
  return colunas.map((c) => ({ ...c, padrao: _COLUNAS_FIXAS_PUB_OAB.has(c.id) }))
    .sort((a, b) => (ordem[a.id] ?? 3) - (ordem[b.id] ?? 3));
}

// Carbon Link16 / Archive16, Apache-2.0. Licença em carbon/LICENSE-web-components.txt.
const _ICONES_PUBLICACAO_OAB = {
  "vinculo": {
    "elem": "svg",
    "attrs": {
      "xmlns": "http://www.w3.org/2000/svg",
      "viewBox": "0 0 32 32",
      "fill": "currentColor",
      "width": 16,
      "height": 16
    },
    "content": [
      {
        "elem": "path",
        "attrs": {
          "d": "M29.25,6.76a6,6,0,0,0-8.5,0l1.42,1.42a4,4,0,1,1,5.67,5.67l-8,8a4,4,0,1,1-5.67-5.66l1.41-1.42-1.41-1.42-1.42,1.42a6,6,0,0,0,0,8.5A6,6,0,0,0,17,25a6,6,0,0,0,4.27-1.76l8-8A6,6,0,0,0,29.25,6.76Z"
        }
      },
      {
        "elem": "path",
        "attrs": {
          "d": "M4.19,24.82a4,4,0,0,1,0-5.67l8-8a4,4,0,0,1,5.67,0A3.94,3.94,0,0,1,19,14a4,4,0,0,1-1.17,2.85L15.71,19l1.42,1.42,2.12-2.12a6,6,0,0,0-8.51-8.51l-8,8a6,6,0,0,0,0,8.51A6,6,0,0,0,7,28a6.07,6.07,0,0,0,4.28-1.76L9.86,24.82A4,4,0,0,1,4.19,24.82Z"
        }
      }
    ],
    "name": "link",
    "size": 16
  },
  "arquivar": {
    "elem": "svg",
    "attrs": {
      "xmlns": "http://www.w3.org/2000/svg",
      "viewBox": "0 0 32 32",
      "fill": "currentColor",
      "width": 16,
      "height": 16
    },
    "content": [
      {
        "elem": "path",
        "attrs": {
          "d": "M14 19H18V21H14z"
        }
      },
      {
        "elem": "path",
        "attrs": {
          "d": "M6,2V28a2,2,0,0,0,2,2H24a2,2,0,0,0,2-2V2ZM24,28H8V16H24Zm0-14H8V10H24ZM8,8V4H24V8Z"
        }
      }
    ],
    "name": "archive",
    "size": 16
  }
};

function _iconePublicacaoOab(chave) {
  const fonte = _ICONES_PUBLICACAO_OAB[chave];
  if (!fonte) throw new Error("Ícone de ação de publicação indisponível: " + chave);
  const montar = no => _elSvg(document, no.elem, { ...no.attrs }, (no.content || []).map(montar));
  return _elSvg(document, "svg", { ...fonte.attrs, slot: "icon", width: "16", height: "16", "aria-hidden": "true", focusable: "false", fill: "currentColor" }, (fonte.content || []).map(montar));
}

function _cabecalhoPublicacaoOab(coluna) {
  const id = "pub-oab-cabecalho-" + (++_pubOabContadorLinha);
  const texto = el("span", { class: "pub-oab-cabecalho-texto", texto: coluna.rotulo });
  const alvo = el("span", { class: "pub-oab-cabecalho", tabindex: "0", "aria-describedby": id }, [texto]);
  const tooltip = el("span", { id, class: "pub-oab-tooltip-nome", role: "tooltip", popover: "manual", texto: coluna.rotulo });
  const fechar = () => { if (tooltip.matches(":popover-open")) tooltip.hidePopover(); };
  const mostrar = (evento) => {
    if (!tooltip.isConnected || tooltip.matches(":popover-open")) return;
    tooltip.showPopover();
    _animarTooltip(tooltip, evento);
    const r = alvo.getBoundingClientRect(), t = tooltip.getBoundingClientRect();
    tooltip.style.left = Math.max(8, Math.min(r.left, innerWidth - t.width - 8)) + "px";
    tooltip.style.top = Math.max(8, Math.min(r.bottom + 4, innerHeight - t.height - 8)) + "px";
  };
  alvo.addEventListener("mouseenter", mostrar);
  alvo.addEventListener("focus", mostrar);
  alvo.addEventListener("blur", fechar);
  alvo.addEventListener("mouseleave", evento => { if (document.activeElement !== alvo && !tooltip.contains(evento.relatedTarget)) fechar(); });
  tooltip.addEventListener("mouseleave", () => { if (document.activeElement !== alvo) fechar(); });
  alvo.addEventListener("keydown", evento => { if (evento.key === "Escape") { evento.preventDefault(); fechar(); } });
  return el("cds-table-header-cell", { "data-coluna": coluna.id }, [alvo, tooltip]);
}

function linhaPublicacaoOab(p, colunas = _colunasPubOab([p])) {
  const d = p.dados || {};
  const linhas = [];
  const tr = el("cds-table-row", { class: "pub-oab-linha", "data-publicacao": p.hash, size: "md" });
  const idTexto = `pub-oab-texto-${++_pubOabContadorLinha}`;
  const identificacao = d.numeroprocessocommascara || p.numero_processo || p.nome_pesquisado || "publicação";

  const checkbox = el("input", { type: "checkbox", "data-publicacao-hash": p.hash, "aria-label": `Selecionar publicação: ${identificacao}` });
  checkbox.checked = _publicacoesOabSelecionadas.has(p.hash);
  checkbox.addEventListener("change", () => {
    if (_pubOabAtualizando || _pubOabInlineEnviando) { _sincronizarSelecaoPubOab(); return; }
    if (checkbox.checked) _publicacoesOabSelecionadas.add(p.hash);
    else _publicacoesOabSelecionadas.delete(p.hash);
    _sincronizarSelecaoPubOab();
  });
  const celSelecao = el("cds-table-cell", { "data-label": "Selecionar", class: "pub-oab-controle" }, [checkbox]);

  const celExpansao = el("cds-table-cell", { "data-label": "Expandir", class: "pub-oab-controle" });
  tr.append(celExpansao, celSelecao);
  const celProcesso = el("cds-table-cell", { "data-label": "Processo" });
  if (p.numero_processo) {
    celProcesso.appendChild(el("div", { texto: formatarNumeroCNJ(d.numeroprocessocommascara || p.numero_processo) }));
  } else {
    celProcesso.appendChild(el("div", { texto: "Número do processo não informado" }));
    const linkBusca = el("a", { href: "#", texto: "Consultar processo" });
    linkBusca.addEventListener("click", (ev) => {
      ev.preventDefault();
      _irParaConsultaProcesso(d.numeroprocessocommascara);
    });
    celProcesso.appendChild(linkBusca);
  }
  const trTexto = el("cds-table-expanded-row", { class: "pub-oab-expansao", expanded: "", colspan: String(colunas.length + 3) }, [_publicacaoCompletaPubOab(p, idTexto)]);
  trTexto.hidden = !_pubOabExpandidas.has(p.hash);
  tr.expanded = !trTexto.hidden;
  trTexto.expanded = !trTexto.hidden;
  const botaoExpandir = el("button", {
    class: "pub-oab-expandir", type: "button", texto: trTexto.hidden ? "›" : "⌄",
    "aria-label": `Expandir publicação: ${identificacao}`,
    "aria-expanded": String(!trTexto.hidden), "aria-controls": idTexto,
  });
  botaoExpandir.addEventListener("click", () => {
    trTexto.hidden = !trTexto.hidden;
    tr.expanded = !trTexto.hidden;
    trTexto.expanded = !trTexto.hidden;
    if (trTexto.hidden) _pubOabExpandidas.delete(p.hash); else _pubOabExpandidas.add(p.hash);
    botaoExpandir.textContent = trTexto.hidden ? "›" : "⌄";
    botaoExpandir.setAttribute("aria-expanded", String(!trTexto.hidden));
    botaoExpandir.setAttribute("aria-label", `${trTexto.hidden ? "Expandir" : "Recolher"} publicação: ${identificacao}`);
  });
  celExpansao.appendChild(botaoExpandir);
  linhas.push(tr, trTexto);
  for (const coluna of colunas) {
    let celula;
    if (coluna.id === "processo") celula = celProcesso;
    else if (coluna.id === "status") {
      const badge = _badgeStatusPubOab(p.status);
      // O status mantém o rótulo de interface em capitalização de frase.
      celula = el("cds-table-cell", {}, [badge]);
    } else {
      const valor = _valorPubOab(coluna.valor(p), coluna.literal);
      celula = el("cds-table-cell", {}, [el("span", { class: "pub-oab-celula-valor", texto: valor, title: valor })]);
    }
    if (coluna.id === "nome") {
      const nome = _nomeProcessoPubOab(p);
      limpar(celula);
      const nomeEl = el("span", { class: "pub-oab-nome-processo", texto: nome, title: nome, tabindex: "0" });
      const tooltip = el("span", { id: `${idTexto}-nome`, class: "pub-oab-tooltip-nome", role: "tooltip", popover: "manual", texto: formatarNomeExibicao(nome) });
      nomeEl.setAttribute("aria-describedby", tooltip.id);
      const mostrar = (evento) => {
        if (!tooltip.isConnected || tooltip.matches(":popover-open")) return;
        tooltip.showPopover();
        _animarTooltip(tooltip, evento);
        const r = nomeEl.getBoundingClientRect(), t = tooltip.getBoundingClientRect();
        tooltip.style.left = `${Math.max(8, Math.min(r.left, innerWidth - t.width - 8))}px`;
        tooltip.style.top = `${Math.max(8, Math.min(r.bottom + 4, innerHeight - t.height - 8))}px`;
      };
      const fechar = () => { if (tooltip.matches(":popover-open")) tooltip.hidePopover(); };
      nomeEl.addEventListener("mouseenter", mostrar);
      nomeEl.addEventListener("focus", mostrar);
      nomeEl.addEventListener("mouseleave", () => { if (document.activeElement !== nomeEl) fechar(); });
      nomeEl.addEventListener("blur", fechar);
      nomeEl.addEventListener("keydown", (e) => { if (e.key === "Escape") fechar(); });
      celula.append(nomeEl, tooltip);
    }
    celula.setAttribute("data-coluna", coluna.id);
    celula.setAttribute("data-label", coluna.rotulo);
    tr.appendChild(celula);
  }

  const celAcoes = el("cds-table-cell", { "data-label": "Ações" });
  const acoesLinha = el("div", { class: "pub-oab-acoes-linha" });

  if (d.link) {
    acoesLinha.appendChild(
      el("cds-icon-button", {
        class: "pub-oab-abrir", "data-pub-oab-acao": "", onclick: (evento) => { if (_acaoLinhaBloqueadaPubOab()) { evento.preventDefault(); evento.stopImmediatePropagation(); } }, href: d.link, target: "_blank", rel: "noopener noreferrer",
        kind: "ghost", size: "md", align: "left", "link-role": "link",
      }, [
        el("span", { class: "pub-oab-abrir-rotulo", texto: "Abrir publicação no DJEN (nova aba)" }),
        _elSvg(document, "svg", { slot: "icon", width: "16", height: "16", viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false", fill: "currentColor" }, [
          _elSvg(document, "path", { d: "M13,14H3c-0.6,0-1-0.4-1-1V3c0-0.6,0.4-1,1-1h5v1H3v10h10V8h1v5C14,13.6,13.6,14,13,14z" }),
          _elSvg(document, "polygon", { points: "10,1 10,2 13.3,2 9,6.3 9.7,7 14,2.7 14,6 15,6 15,1" }),
        ]),
        el("span", { slot: "tooltip-content", texto: "Abrir publicação no DJEN (nova aba)" }),
      ])
    );
  }

  const comboContainer = el("div", { class: "pub-oab-combo" });
  const acoes = [];
  if (!p.caso_id) {
    const motivo = p.status === "tratada" ? "Publicação já tratada" : !p.numero_processo ? "Número do processo não informado" : "";
    acoes.push({ id: "cadastro", rotulo: "Cadastrar processo", motivo,
      executar: origem => _abrirFluxoInlinePubOab(tr, p, colunas, "cadastro", origem) });
    acoes.push({ id: "vinculo", rotulo: "Vincular a processo existente",
      executar: origem => _abrirFluxoInlinePubOab(tr, p, colunas, "vinculo", origem) });
  } else {
    acoes.push({ id: "abrir", rotulo: "Abrir processo", executar: async () => {
      if (await selecionarAba(abas.find(a => a.painel.id === "aba-casos"))) await abrirCaso(p.caso_id);
    }});
    acoes.push({ id: "atividade", rotulo: "Criar atividade", executar: async () => {
      if (!(await selecionarAba(abas.find(a => a.painel.id === "aba-casos")))) return;
      if (!(await abrirCaso(p.caso_id))) return;
      _selecionarSubabaCaso("atividades");
      _abrirModalAtividade(p.caso_id, null, p.hash);
    }});
  }
  if (p.status !== "tratada") acoes.push({ id: "tratada", rotulo: "Marcar como tratada", executar: () => _aplicarStatusPubOab([p.hash], "tratada") });
  if (p.status !== "arquivada") acoes.push({ id: "arquivar", rotulo: "Arquivar", executar: () => _aplicarStatusPubOab([p.hash], "arquivada") });
  const executarAcao = (acao, origem) => {
    if (acao.motivo || _acaoLinhaBloqueadaPubOab()) return;
    _fecharTodosComboMenusOab(true);
    return acao.executar(origem);
  };
  const disponiveis = acoes.filter(a => !a.motivo);
  if (disponiveis.length < 3) {
    const motivos = acoes.filter(a => a.motivo).map(a => a.rotulo + ": " + a.motivo).join(". ");
    if (motivos) acoesLinha.setAttribute("aria-description", motivos);
    for (const acao of disponiveis) {
      const botao = el("cds-icon-button", { class: "pub-oab-acao-inline", "data-pub-oab-acao": "", "data-acao-publicacao": acao.id,
        kind: "ghost", size: "md", align: "left", "aria-label": acao.rotulo + ": " + identificacao }, [
        _iconePublicacaoOab(acao.id), el("span", { slot: "tooltip-content", texto: acao.rotulo + ": " + identificacao }),
      ]);
      botao.addEventListener("click", () => executarAcao(acao, botao));
      acoesLinha.appendChild(botao);
    }
    if (motivos) acoesLinha.appendChild(el("span", { class: "pub-oab-motivo-indisponivel", texto: motivos }));
    celAcoes.appendChild(acoesLinha); tr.appendChild(celAcoes);
    return linhas;
  }
  const iconeChevron = _elSvg(document, "svg", { width: "16", height: "16", viewBox: "0 0 16 16", "aria-hidden": "true" }, [
    _elSvg(document, "path", { d: "M9 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm0 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm0 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z", fill: "currentColor" }),
  ]);
  const botaoTrigger = el("button", {
    class: "cds--btn cds--btn--ghost cds--btn--sm cds--btn--icon-only cds--menu-button__trigger pub-oab-overflow",
    type: "button", "data-pub-oab-acao": "", "aria-haspopup": "true", "aria-expanded": "false", "aria-label": "Mais ações da publicação: " + identificacao, "aria-controls": idTexto + "-menu",
  }, [iconeChevron]);
  comboContainer.appendChild(botaoTrigger);
  const menu = el("ul", { id: idTexto + "-menu", class: "cds--menu pub-oab-combo-menu", popover: "manual", role: "menu", "aria-label": "Ações da publicação: " + identificacao });
  menu.hidden = true;
  for (const acao of acoes) {
    const item = el("li", { class: "cds--menu-item", role: "menuitem", tabindex: "-1", "aria-disabled": String(Boolean(acao.motivo)) }, [el("div", { class: "cds--menu-item__label", texto: acao.rotulo })]);
    if (acao.motivo) item.appendChild(el("div", { class: "pub-oab-menu-motivo", texto: acao.motivo }));
    item.addEventListener("click", () => executarAcao(acao, botaoTrigger));
    menu.appendChild(item);
  }
  botaoTrigger.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (_acaoLinhaBloqueadaPubOab()) return;
    const abrindo = menu.hidden;
    _fecharTodosComboMenusOab(true);
    if (abrindo) {
      menu.hidden = false;
      menu.classList.add("cds--menu--open", "cds--menu--shown");
      botaoTrigger.setAttribute("aria-expanded", "true");
      menu.showPopover();
      _posicionarMenuPubOab(menu);
      menu.querySelector('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    }
  });
  botaoTrigger.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (_acaoLinhaBloqueadaPubOab()) return;
      if (menu.hidden) botaoTrigger.click();
      const itens = menu.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])');
      itens[ev.key === "ArrowUp" ? itens.length - 1 : 0]?.focus();
    }
  });
  menu.addEventListener("keydown", (ev) => {
    const itens = [...menu.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')];
    const indice = itens.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) {
      ev.preventDefault();
      const proximo = ev.key === "Home" ? 0 : ev.key === "End" ? itens.length - 1
        : (indice + (ev.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
      itens[proximo]?.focus();
    } else if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      itens[indice]?.click();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      _fecharTodosComboMenusOab(true);
    }
  });
  comboContainer.addEventListener("focusout", (ev) => {
    if (!comboContainer.contains(ev.relatedTarget)) _fecharTodosComboMenusOab();
  });
  comboContainer.appendChild(menu);
  acoesLinha.appendChild(comboContainer);

  celAcoes.appendChild(acoesLinha);
  tr.appendChild(celAcoes);

  return linhas;
}


function criarTabelaPublicacoesOab(tabela, quantidade, colunas) {
  const chave = "cnj_pub_oab_colunas_visiveis_v2";
  const opcionais = colunas;
  let visiveis = colunas.filter((c) => c.padrao).map((c) => c.id);
  try {
    const valor = JSON.parse(localStorage.getItem(chave) || "null");
    if (Array.isArray(valor)) {
      const validas = [...new Set(valor.filter((id) => colunas.some((c) => c.id === id)))];
      if (!valor.length || validas.length) visiveis = validas;
    }
  } catch { /* usa as colunas padrão */ }
  const aplicar = () => {
    const quantidadeVisivel = 3 + colunas.filter((c) => _COLUNAS_FIXAS_PUB_OAB.has(c.id) || visiveis.includes(c.id)).length;
    for (const linha of tabela.querySelectorAll("cds-table-header-row, cds-table-row, cds-table-expanded-row")) {
      for (const celula of linha.querySelectorAll("[data-coluna]")) celula.hidden = !_COLUNAS_FIXAS_PUB_OAB.has(celula.dataset.coluna) && !visiveis.includes(celula.dataset.coluna);
      if (linha.matches("cds-table-expanded-row")) linha.colSpan = quantidadeVisivel;
    }
    tabela.headerCount = quantidadeVisivel;
    tabela.classList.toggle("pub-oab-tabela--reduzida", quantidadeVisivel <= 6);
  };
  tabela._pubOabAplicarColunas = aplicar;
  const seletor = el("cds-toggletip", { id: "pub-oab-colunas-toggletip", class: "pub-oab-colunas", alignment: "bottom-right", "button-label": "Colunas" });
  const resumo = el("span", { slot: "trigger", class: "pub-oab-colunas-trigger", texto: "Colunas" });
  const campos = el("fieldset", { slot: "body-text", class: "pub-oab-colunas-campos" }, [el("legend", { texto: "Colunas visíveis" })]);
  let atualizacaoColunas = null;
  for (const coluna of opcionais) {
    const id = `pub-oab-coluna-${encodeURIComponent(coluna.id)}`;
    const input = el("input", { id, type: "checkbox" });
    input.checked = _COLUNAS_FIXAS_PUB_OAB.has(coluna.id) || visiveis.includes(coluna.id);
    input.disabled = _COLUNAS_FIXAS_PUB_OAB.has(coluna.id);
    input.addEventListener("change", () => {
      visiveis = input.checked ? [...visiveis, coluna.id] : visiveis.filter((id) => id !== coluna.id);
      // O clique no rótulo ainda está ativando o controle nativo neste ponto.
      // Só altere o layout da tabela depois que essa ativação terminar.
      if (atualizacaoColunas !== null) cancelAnimationFrame(atualizacaoColunas);
      atualizacaoColunas = requestAnimationFrame(() => {
        atualizacaoColunas = null;
        if (tabela.isConnected) aplicar();
      });
      try { localStorage.setItem(chave, JSON.stringify(visiveis)); } catch { /* preferência da sessão */ }
    });
    const rotulo = el("label", { for: id, texto: coluna.rotulo });
    if (_COLUNAS_FIXAS_PUB_OAB.has(coluna.id)) rotulo.appendChild(el("small", { class: "pub-oab-coluna-fixa", texto: "Sempre visível" }));
    // Mantém a ativação nativa do label sem mover o foco antes do checkbox.
    rotulo.addEventListener("pointerdown", (evento) => evento.preventDefault());
    campos.appendChild(el("div", { class: "pub-oab-coluna-opcao" }, [input, rotulo]));
  }
  campos.appendChild(el("p", { class: "campo-ajuda", texto: "Seleção, processo, tribunal, nome do processo e ações ficam sempre visíveis." }));
  seletor.append(resumo, campos);
  seletor.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape") { evento.preventDefault(); seletor.open = false; seletor.focus(); }
  });
  document.addEventListener("click", function fecharColunas(evento) {
    if (!seletor.isConnected) { document.removeEventListener("click", fecharColunas); return; }
    if (!evento.composedPath().includes(seletor)) seletor.open = false;
  });
  const criarAcaoLote = (id, rotulo, status) => {
    const botao = el("button", { id, type: "button", class: "cds--btn cds--btn--primary cds--btn--sm", "data-status-lote": status, texto: rotulo, disabled: "disabled" });
    botao.addEventListener("click", () => _aplicarStatusPubOab([..._publicacoesOabSelecionadas], status));
    return botao;
  };
  const cancelar = el("button", { type: "button", class: "cds--btn cds--btn--primary cds--btn--sm", texto: "Cancelar seleção", "data-cancelar-lote": "" });
  cancelar.addEventListener("click", () => {
    _publicacoesOabSelecionadas.clear();
    _sincronizarSelecaoPubOab();
    tabela.querySelector("input[data-publicacoes-todas]")?.focus();
  });

  const lote = el("div", { id: "pub-oab-batch", class: "cds--batch-actions pub-oab-batch", role: "region", "aria-label": "Ações das publicações selecionadas" }, [
    el("span", { id: "pub-oab-selecionadas", role: "status", "aria-live": "polite" }),
    criarAcaoLote("pub-oab-marcar-tratada", "Marcar como tratada", "tratada"),
    criarAcaoLote("pub-oab-arquivar", "Arquivar", "arquivada"), cancelar,
  ]);
  lote.hidden = _publicacoesOabSelecionadas.size === 0;
  const barra = el("div", { class: "pub-oab-tabela-toolbar" }, [
    el("strong", { texto: "Publicações" }),
    el("span", { class: "pub-oab-tabela-contagem", texto: `${quantidade} ${quantidade === 1 ? "publicação" : "publicações"}` }),
    seletor,
  ]);
  aplicar();
  tabela.updateComplete?.then(aplicar);
  return el("div", { class: "pub-oab-grade" }, [barra, lote,
    el("div", { class: "tabela-responsiva-wrap pub-oab-rolagem", tabindex: "0", role: "region", "aria-label": "Tabela de publicações; role horizontalmente para ver todas as colunas" }, [tabela]),
  ]);
}

function _paginacaoPubOab(total) {
  const paginas = Math.max(1, Math.ceil(total / _pubOabTamanho));
  const seletor = el("select", { id: "pub-oab-tamanho", class: "pub-oab-pagina-tamanho" }, [5, 10, 20].map((n) => el("option", { value: String(n), texto: String(n) })));
  seletor.value = String(_pubOabTamanho);
  seletor.addEventListener("change", () => {
    _pubOabTamanho = Number(seletor.value); _pubOabPagina = 1;
    _publicacoesOabSelecionadas.clear(); carregarPublicacoesOab();
  });
  const mover = (delta, nome) => {
    const limite = total === 0 || (delta < 0 ? _pubOabPagina === 1 : _pubOabPagina >= paginas);
    const botao = el("button", { type: "button", class: "pub-oab-pagina-botao", "aria-label": nome,
      "data-limite": String(limite), texto: delta < 0 ? "‹" : "›" });
    botao.disabled = limite;
    botao.addEventListener("click", async () => {
      _pubOabPagina += delta; _fecharTodosComboMenusOab();
      await carregarPublicacoesOab();
      document.querySelector(`.pub-oab-pagina-botao[aria-label="${nome}"]:not(:disabled)`)?.focus();
    });
    return botao;
  };
  return el("nav", { class: "pub-oab-paginacao", "aria-label": "Paginação de publicações" }, [
    el("div", { class: "pub-oab-paginacao-grupo" }, [el("label", { for: seletor.id, texto: "Itens por página" }), seletor]),
    el("div", { class: "pub-oab-paginacao-grupo" }, [
      el("span", { role: "status", "aria-live": "polite", texto: `${total ? (_pubOabPagina - 1) * _pubOabTamanho + 1 : 0}–${Math.min(_pubOabPagina * _pubOabTamanho, total)} de ${total} itens` }),
      el("span", { texto: `Página ${_pubOabPagina} de ${paginas}` }), mover(-1, "Página anterior"), mover(1, "Próxima página"),
    ]),
  ]);
}

async function carregarPublicacoesOab(tipoFeedback = "interno") {
  const feedback = { tipo: tipoFeedback === "pagina" ? "pagina" : "interno", regiao: document.getElementById("lista-publicacoes-oab") };
  const container = document.getElementById("lista-publicacoes-oab");
  if (!exigirCliente(container)) return;
  const requisicao = ++_pubOabRequisicao;
  _pubOabCarregando = true;
  _atualizarBotoesLotePubOab();
  container.setAttribute("aria-busy", "true");
  const filtroStatus = document.getElementById("pub-oab-filtro-status").value;
  try {
    const query = new URLSearchParams({ pagina: String(_pubOabPagina), tamanho: String(_pubOabTamanho) });
    if (filtroStatus) query.set("status", filtroStatus);
    const dados = await _buscarJson(`/publicacoes-oab?${query}`, feedback);
    if (requisicao !== _pubOabRequisicao) return;
    const publicacoes = dados.publicacoes || [], total = dados.total ?? publicacoes.length;
    _pubOabPagina = dados.pagina || Math.min(_pubOabPagina, Math.max(1, Math.ceil(total / _pubOabTamanho)));
    if (dados.hashes_disponiveis) {
      const disponiveis = new Set(dados.hashes_disponiveis);
      for (const hash of _publicacoesOabSelecionadas) if (!disponiveis.has(hash)) _publicacoesOabSelecionadas.delete(hash);
      for (const hash of _pubOabExpandidas) if (!disponiveis.has(hash)) _pubOabExpandidas.delete(hash);
    }
    _fecharTodosComboMenusOab();
    limpar(container);
    container.appendChild(el("div", { id: "pub-oab-status-geral" }));
    if (!publicacoes.length) {
      container.appendChild(notificacao("info", filtroStatus ? "Nenhuma publicação com este status" : "Nenhuma publicação encontrada",
        filtroStatus ? "Selecione Todos no filtro de status para ver as demais publicações." : "Use a captura manual para adicionar publicações à lista."));
      container.appendChild(_paginacaoPubOab(total));
      return;
    }
    const checkboxTodos = el("input", { type: "checkbox", "data-publicacoes-todas": "", "aria-label": "Selecionar publicações desta página" });
    checkboxTodos.addEventListener("change", () => {
      if (_pubOabAtualizando || _pubOabInlineEnviando) { _sincronizarSelecaoPubOab(); return; }
      for (const p of publicacoes) {
        if (checkboxTodos.checked) _publicacoesOabSelecionadas.add(p.hash); else _publicacoesOabSelecionadas.delete(p.hash);
      }
      _sincronizarSelecaoPubOab();
    });
    const colunas = _colunasPubOab(publicacoes, dados.campos_djen || []);
    const thead = el("cds-table-head", {}, [el("cds-table-header-row", { size: "md" }, [
      el("cds-table-header-cell", { class: "pub-oab-controle", "aria-label": "Expandir publicação" }),
      el("cds-table-header-cell", { class: "pub-oab-controle" }, [checkboxTodos]),
      ...colunas.map(_cabecalhoPublicacaoOab),
      el("cds-table-header-cell", { texto: "Ações" }),
    ])]);
    const tbody = el("cds-table-body", {});
    for (const p of publicacoes) for (const linha of linhaPublicacaoOab(p, colunas)) tbody.appendChild(linha);
    const tabela = el("cds-table", { class: "pub-oab-tabela", size: "md", locale: "pt-BR", "aria-label": "Publicações monitoradas" }, [thead, tbody]);
    container.appendChild(criarTabelaPublicacoesOab(tabela, total, colunas));
    container.querySelector(".pub-oab-grade").appendChild(_paginacaoPubOab(total));
    _sincronizarSelecaoPubOab();
  } catch (erro) {
    if (requisicao !== _pubOabRequisicao) return;
    _statusGeralPubOab(erro.message, true);
    if (!container.querySelector("#pub-oab-status-geral")) mostrarErro(container, erro.message);
    const repetir = el("button", { type: "button", class: "cds--btn cds--btn--ghost cds--btn--sm", texto: "Tentar novamente" });
    repetir.addEventListener("click", () => { repetir.remove(); carregarPublicacoesOab(); });
    container.appendChild(repetir);
  } finally {
    if (requisicao === _pubOabRequisicao) {
      _pubOabCarregando = false; container.setAttribute("aria-busy", "false"); _sincronizarSelecaoPubOab();
    }
  }
}

document.getElementById("pub-oab-filtro-status").addEventListener("change", () => {
  _pubOabPagina = 1;
  _pubOabExpandidas.clear();
  _publicacoesOabSelecionadas.clear();
  _atualizarBotoesLotePubOab();
  carregarPublicacoesOab();
});
document.getElementById("pub-oab-atualizar").addEventListener("click", carregarPublicacoesOab);
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
    status.textContent = `${resultado.encontradas} ${resultado.encontradas === 1 ? "publicação encontrada" : "publicações encontradas"} no DJEN. ${resultado.novas} ${resultado.novas === 1 ? "nova publicação adicionada" : "novas publicações adicionadas"} à lista.`;
    carregarPublicacoesOab();
  } catch (erro) {
    status.textContent = erro.message;
  } finally {
    botao.disabled = false;
  }
});

// ─── Captura externa: ação/foro/título/partes a partir de número de processo ─

function _preencherClienteCapturado(nome, statusEl) {
  const busca = document.getElementById("caso-cliente-busca");
  const hidden = document.getElementById("caso-cliente");
  if (busca.value.trim()) { mostrarAviso(statusEl, "Campo Cliente já preenchido — não alterado."); return; }
  const correspondencia = _cache.clientes.find((c) => c.nome.trim().toUpperCase() === nome.trim().toUpperCase());
  busca.value = nome;
  hidden.value = correspondencia ? correspondencia.id : "";
  if (!correspondencia) busca.dispatchEvent(new Event("input"));
}

async function capturarDadosExternos() {
  const numerosCampo = document.getElementById("caso-processos");
  const campAcao = document.getElementById("caso-acao");
  const campForo = document.getElementById("caso-foro");
  const campTitulo = document.getElementById("caso-titulo");
  const tagAcao = document.getElementById("caso-acao-tag");
  const tagForo = document.getElementById("caso-foro-tag");
  const tagTitulo = document.getElementById("caso-titulo-tag");
  const tituloAviso = document.getElementById("caso-titulo-aviso");
  const partesEl = document.getElementById("caso-partes-captura");
  const statusEl = document.getElementById("status-datajud-modal");
  const botao = document.getElementById("btn-datajud-modal");

  if (!cliente) { mostrarErro(statusEl, "Conecte-se em Acesso antes de capturar externamente."); return; }
  const numeros = numerosCampo.value.split(",").map((s) => s.trim()).filter(Boolean);
  if (numeros.length !== 1) { mostrarAviso(statusEl, "Informe um único número CNJ para consultar."); return; }
  const numero = numeros[0];
  const tribunal = _siglaTribunal(numero);
  if (!tribunal) { mostrarAviso(statusEl, "Não foi possível determinar o tribunal pelo número informado."); return; }

  botao.disabled = true;
  limpar(statusEl);
  limpar(partesEl);
  partesEl.hidden = true;
  // Nova captura substitui as partes da anterior, mesmo que não haja resultado.
  _partesCapturadasNovoCaso = [];
  tituloAviso.hidden = true;
  tagAcao.hidden = true;
  tagForo.hidden = true;
  tagTitulo.hidden = true;
  const progresso = document.getElementById("captura-progresso");
  progresso.hidden = false;
  try {
    const dados = await cliente.chamarTool("consultar_processo_unificado", { numero_processo: numero, tribunal });
    progresso.hidden = true;
    limpar(statusEl);
    if (dados.erro) { mostrarErro(statusEl, dados.mensagem || "Erro ao consultar DataJud/DJEN."); return; }

    const instancia = (dados.instancias || [])[0];
    if (instancia) {
      if (instancia.classe && !campAcao.value) {
        campAcao.value = [instancia.classe, ...(instancia.assuntos || [])].filter(Boolean).join(" - ");
        tagAcao.hidden = false;
      }
      if (!campForo.value) {
        if (instancia.orgaoJulgador) {
          campForo.value = instancia.orgaoJulgador;
          tagForo.textContent = "auto · DataJud";
          tagForo.hidden = false;
        } else if (dados.orgao_julgador_djen) {
          campForo.value = dados.orgao_julgador_djen;
          tagForo.textContent = "auto · DJEN (reserva)";
          tagForo.hidden = false;
        }
      }
    } else if (!campForo.value && dados.orgao_julgador_djen) {
      campForo.value = dados.orgao_julgador_djen;
      tagForo.textContent = "auto · DJEN (reserva)";
      tagForo.hidden = false;
    }

    const partes = dados.partes || [];
    const poloAtivo = (p) => /^(A|AT|ATIVO)$/i.test(p.polo || "");
    const poloPassivo = (p) => /^(P|PA|PASSIVO)$/i.test(p.polo || "");
    const autores = [...new Set(partes.filter(poloAtivo).map((p) => (p.nome || "").trim()).filter(Boolean))];
    const reus = [...new Set(partes.filter(poloPassivo).map((p) => (p.nome || "").trim()).filter(Boolean))];

    if (!instancia && !partes.length) {
      statusEl.appendChild(notificacao("warning", "Atenção", "Nada encontrado no DataJud nem no DJEN para este número."));
    } else {
      statusEl.appendChild(notificacao("success", instancia ? "Dados localizados em DataJud e DJEN." : "Dados localizados no DJEN (DataJud sem este processo)."));
    }

    if (!campTitulo.value) {
      if (autores.length || reus.length) {
        campTitulo.value = `${autores.join(" / ") || "Parte autora não informada"} x ${reus.join(" / ") || "Parte ré não informada"}`;
        tagTitulo.hidden = false;
      } else {
        tituloAviso.hidden = false;
      }
    }

    if (partes.length) {
      partesEl.hidden = false;
      partesEl.appendChild(el("p", { class: "campo-ajuda" }, [document.createTextNode("Partes encontradas no DJEN — clique para escolher o cliente principal (todas as partes são cadastradas como clientes do processo):")]));
      const nomesUnicos = [...new Map(partes.map((p) => [(p.nome || "").trim().toUpperCase(), p])).values()];
      _partesCapturadasNovoCaso = nomesUnicos.filter((p) => p.nome);
      nomesUnicos.filter((p) => p.nome).forEach((p) => {
        const polo = poloAtivo(p) ? "Autor" : poloPassivo(p) ? "Réu" : "Polo não informado";
        const btn = el("button", { class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: `${formatarNomeExibicao(p.nome)} · ${polo}` });
        btn.addEventListener("click", () => _preencherClienteCapturado(p.nome, statusEl));
        partesEl.appendChild(btn);
      });
    }

    const form = campAcao.closest("form");
    if (form) atualizarIndicadorEdicao(form);
  } catch (err) {
    progresso.hidden = true;
    limpar(statusEl);
    mostrarErro(statusEl, err.message || "Erro ao consultar DataJud/DJEN.");
  } finally {
    progresso.hidden = true;
    botao.disabled = false;
  }
}

document.getElementById("btn-datajud-modal").addEventListener("click", capturarDadosExternos);

// ─── Vista de detalhe do caso ────────────────────────────────────────────────

let _casoDetalheAtual = null;

async function voltarParaCasos() {
  if (!(await permitirSaidaEdicao(document.getElementById("caso-vista-detalhe")))) return;
  document.getElementById("caso-vista-detalhe").hidden = true;
  document.getElementById("caso-vista-lista").hidden = false;
  _casoDetalheAtual = null;
}

function _selecionarSubabaCaso(nome) {
  for (const n of ["cadastro", "atividades", "publicacoes", "movimentacoes", "vinculos"]) {
    document.getElementById(`caso-subaba-${n}`).hidden = n !== nome;
    const btn = document.getElementById(`caso-subaba-${n}-botao`);
    btn.classList.toggle("sub-aba-ativa", n === nome);
    btn.setAttribute("aria-selected", n === nome ? "true" : "false");
    btn.tabIndex = n === nome ? 0 : -1;
  }
}

async function abrirCaso(casoId, tipoFeedback = "pagina") {
  const feedback = { tipo: tipoFeedback === "pagina" ? "pagina" : "interno", regiao: document.getElementById("caso-vista-detalhe") };
  if (!(await permitirSaidaEdicao())) return false;
  invalidarOrigemAtividade();
  document.getElementById("caso-vista-lista").hidden = true;
  document.getElementById("caso-vista-detalhe").hidden = false;
  _selecionarSubabaCaso("cadastro");
  document.getElementById("caso-detalhe-titulo").textContent = "Carregando…";
  limpar(document.getElementById("lista-atividades"));
  limpar(document.getElementById("resultado-caso-editar"));
  try {
    const caso = await _buscarJson(`/casos/${casoId}`, feedback);
    _casoDetalheAtual = caso;
    document.getElementById("caso-detalhe-titulo").textContent = caso.titulo ? formatarNomeExibicao(caso.titulo) : "(sem título)";
    const responsavel = document.getElementById("editar-caso-responsavel");
    limpar(responsavel);
    responsavel.appendChild(el("option", {value: "", texto: "Selecione um responsável"}));
    try {
      const dados = await _buscarJson("/responsaveis", feedback);
      for (const nome of [...new Set([...(dados.responsaveis || []), caso.responsavel].filter(Boolean))]) {
        responsavel.appendChild(el("option", {value: nome, texto: formatarNomeExibicao(nome)}));
      }
    } catch (erro) {
      if (caso.responsavel) responsavel.appendChild(el("option", {value: caso.responsavel, texto: formatarNomeExibicao(caso.responsavel)}));
      mostrarAviso(document.getElementById("resultado-caso-editar"), "Não foi possível carregar os responsáveis. Reabra o processo para tentar novamente.");
    }
    responsavel.value = caso.responsavel || "";
    document.getElementById("editar-caso-pasta").value = caso.pasta || "";
    document.getElementById("editar-caso-acesso").value = caso.acesso || "equipe";
    document.getElementById("form-caso-editar").dataset.casoId = casoId;
    marcarFormularioSalvo(document.getElementById("form-caso-editar"), true);
    limpar(document.getElementById("lista-movimentacoes"));
    await _carregarCapaProcessos(casoId, tipoFeedback);
    await _carregarAtividades(casoId, tipoFeedback);
    return true;
  } catch (erro) {
    document.getElementById("caso-detalhe-titulo").textContent = "Erro ao carregar";
    mostrarErro(document.getElementById("resultado-caso-editar"), erro.message);
    return false;
  }
}

const _casosComOrigemEstruturada = new Set();
const _casosComAgendaDisponivel = new Set();
const _chavesAgendaAtividade = new Map();
async function _carregarAtividades(casoId, tipoFeedback = "interno") {
  const feedback = { tipo: tipoFeedback === "pagina" ? "pagina" : "interno", regiao: document.getElementById("lista-atividades") };
  const lista = document.getElementById("lista-atividades");
  limpar(lista);
  try {
    const { atividades, origem_djen_estruturada, agenda_disponivel } = await _buscarJson(`/casos/${casoId}/atividades`, feedback);
    if (agenda_disponivel) _casosComAgendaDisponivel.add(casoId);
    else _casosComAgendaDisponivel.delete(casoId);
    if (origem_djen_estruturada === true || (atividades || []).some((a) => Object.hasOwn(a, "origem_djen_hash"))) _casosComOrigemEstruturada.add(casoId);
    else _casosComOrigemEstruturada.delete(casoId);
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
    const titulo = el("p", { class: `atividade-titulo${atv.status === "concluida" ? " concluida" : ""}`, texto: formatarNomeExibicao(atv.titulo) });
    corpo.appendChild(titulo);
    const partesMeta = [_ROTULO_TIPO_ATIVIDADE[atv.tipo] || atv.tipo];
    if (atv.data) partesMeta.push(formatarDataSimples(atv.data));
    if (atv.hora) partesMeta.push(atv.hora);
    corpo.appendChild(el("p", { class: "atividade-meta", texto: partesMeta.join(" · ") }));
    if (atv.responsavel) corpo.appendChild(el("p", { class: "atividade-meta", texto: `Responsável: ${formatarNomeExibicao(atv.responsavel)}` }));
    if (atv.observacoes) corpo.appendChild(el("p", { class: "atividade-meta", texto: atv.observacoes }));
    const origem = origemPublicacaoAtividade(atv);
    if (origem) corpo.appendChild(el("button", { type: "button", class: "cds--btn cds--btn--ghost cds--btn--sm", texto: "Ver publicação de origem", onclick: () => mostrarOrigemAtividade(casoId, origem) }));
    if (atv.agenda || _casosComAgendaDisponivel.has(casoId)) corpo.appendChild(_controlesAgendaAtividade(casoId, atv));
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

function _controlesAgendaAtividade(casoId, atividade) {
  const v = atividade.agenda;
  const destino = el("div", { class: "atividade-agenda", "data-agenda-atividade": String(atividade.id) });
  const acoes = el("div", { class: "atividade-agenda-acoes" });
  const chaveLocal = `${casoId}/${atividade.id}`;
  const estados = { pendente: "Sincronização pendente", sincronizado: "Sincronizado", divergente: "Dados diferentes na agenda",
    cancelamento_pendente: "Cancelamento pendente", cancelado: "Evento cancelado; atividade preservada", falha: "Não foi possível confirmar a operação" };
  if (v) destino.appendChild(el("p", { class: "atividade-meta", texto: `Agenda: ${estados[v.estado] || v.estado}` }));
  if (v?.erro) destino.appendChild(el("p", { class: "atividade-meta", texto: v.erro }));
  if (v?.estado === "divergente") destino.appendChild(el("p", { class: "atividade-meta", texto:
    `Na agenda: ${v.titulo_remoto || "Sem título"} · ${v.data_remota ? formatarDataSimples(v.data_remota) : "Evento sem data de dia inteiro"}` }));
  if (!_casosComAgendaDisponivel.has(casoId)) destino.appendChild(el("p", { class: "atividade-meta", texto: "Conecte sua agenda individual em Integrações e atualize as atividades." }));
  const ativo = v && v.estado !== "cancelado";
  if (v?.estado === "cancelado") _chavesAgendaAtividade.delete(chaveLocal);
  const executar = async (botao, metodo, comando) => {
    if (metodo === "DELETE" && !(await confirmarAcao("Cancelar o evento na agenda? A atividade será preservada."))) return;
    if (metodo === "PATCH" && !(await confirmarAcao(comando === "aceitar_data_da_agenda"
      ? "Usar a data e o título da agenda nesta atividade?" : "Substituir a data e o título do evento pelos dados desta atividade?"))) return;
    botao.disabled = true;
    try {
      let corpo = {}, cabecalhos = {};
      if (metodo === "POST") {
        if (comando === "reconciliar_institucional") {
          if (!(await confirmarAcao("Associar o vínculo institucional à sua agenda individual? A conta Google precisa ser a mesma; o evento será preservado."))) return;
          corpo = {reconciliar_institucional: true};
        }
        if (!_chavesAgendaAtividade.has(chaveLocal)) _chavesAgendaAtividade.set(chaveLocal, crypto.randomUUID());
        cabecalhos = { "Idempotency-Key": _chavesAgendaAtividade.get(chaveLocal) };
      } else corpo = { vinculo_id: v.id, versao: v.versao, ...(comando ? { comando } : {}) };
      const resposta = await _enviarJson(`/casos/${casoId}/atividades/${atividade.id}/agenda`, corpo, metodo, cabecalhos);
      await _carregarAtividades(casoId);
      [...document.querySelectorAll("#lista-atividades [data-agenda-atividade]")]
        .find((no) => no.dataset.agendaAtividade === String(atividade.id))?.querySelector("button")?.focus();
      const estado = resposta.agenda?.estado;
      mostrarToast(["sincronizado", "cancelado"].includes(estado) ? "success" : "warning",
        estado === "divergente" ? "Revise os dados da agenda" : "Agenda atualizada", estados[estado] || "Confira o vínculo da atividade.");
    } catch (erro) {
      mostrarToast("error", "Não foi possível atualizar a agenda", erro.message);
    } finally { botao.disabled = false; }
  };
  const botao = (texto, metodo, comando) => {
    const b = el("button", { type: "button", class: "cds--btn cds--btn--ghost cds--btn--sm", texto,
      "aria-label": `${texto}: ${atividade.titulo}` });
    b.addEventListener("click", () => executar(b, metodo, comando));
    acoes.appendChild(b);
  };
  if (atividade.agenda_institucional_anterior) {
    destino.appendChild(el("p", {class:"atividade-meta", texto:"Vínculo institucional anterior preservado. Reconcilie usando a conta Google original."}));
    if (_casosComAgendaDisponivel.has(casoId)) botao("Reconciliar vínculo institucional", "POST", "reconciliar_institucional");
  } else if (ativo) {
    botao("Atualizar agenda", "POST");
    if (v.estado === "divergente") {
      botao("Manter dados da atividade", "PATCH", "usar_data_da_atividade");
      botao("Usar data e título da agenda", "PATCH", "aceitar_data_da_agenda");
    }
    botao("Cancelar evento", "DELETE");
  } else if (_casosComAgendaDisponivel.has(casoId) && atividade.data && !atividade.hora) botao("Vincular à agenda", "POST");
  else if (_casosComAgendaDisponivel.has(casoId)) destino.appendChild(el("p", { class: "atividade-meta", texto: "Para vincular à agenda, informe uma data e deixe a hora vazia." }));
  if (v?.link) acoes.appendChild(el("a", { href: v.link, target: "_blank", rel: "noopener", class: "cds--btn cds--btn--ghost cds--btn--sm", texto: "Abrir no Google Calendar" }));
  destino.appendChild(acoes);
  return destino;
}

function origemPublicacaoAtividade(atividade) {
  if (atividade && Object.hasOwn(atividade, "origem_djen_hash")) return atividade.origem_djen_hash || "";
  const marcadores = String(atividade?.observacoes || "").split(/\r?\n/).filter((linha) => linha.startsWith("Publicação de origem (DJEN)"));
  return marcadores.length === 1 ? marcadores[0].match(/^Publicação de origem \(DJEN\): ([A-Za-z0-9_-]{1,512})$/)?.[1] || "" : "";
}
let _geracaoOrigemAtividade = 0;
function invalidarOrigemAtividade() {
  ++_geracaoOrigemAtividade;
  limpar(document.getElementById("atividade-origem"));
}
async function mostrarOrigemAtividade(casoId, hash) {
  const geracao = ++_geracaoOrigemAtividade;
  const destino = document.getElementById("atividade-origem");
  limpar(destino);
  destino.appendChild(el("p", { role: "status", texto: "Carregando publicação de origem…" }));
  try {
    const { publicacoes } = await _buscarJson(`/casos/${casoId}/publicacoes`);
    if (geracao !== _geracaoOrigemAtividade) return;
    const origem = (publicacoes || []).find((p) => p.hash === hash);
    limpar(destino);
    if (!origem) destino.appendChild(notificacao("warning", "Publicação de origem indisponível", `Referência DJEN: ${hash}. Ela pode ter sido desvinculada deste processo.`));
    else destino.appendChild(_publicacaoCompletaPubOab(origem, "publicacao-origem-atividade"));
  } catch (erro) {
    if (geracao !== _geracaoOrigemAtividade) return;
    mostrarErro(destino, erro.message);
    destino.appendChild(el("button", { type: "button", class: "cds--btn cds--btn--tertiary cds--btn--sm", texto: "Tentar novamente", onclick: () => mostrarOrigemAtividade(casoId, hash) }));
  }
  destino.tabIndex = -1;
  destino.focus();
}

async function _abrirModalAtividade(casoId, atividade = null, publicacaoHash = "") {
  const resultado = document.getElementById("resultado-atividade");
  limpar(resultado);
  const form = document.getElementById("form-atividade");
  form.dataset.publicacaoHash = publicacaoHash || origemPublicacaoAtividade(atividade);
  form.dataset.origemEstruturada = String(_casosComOrigemEstruturada.has(casoId) || !!atividade && Object.hasOwn(atividade, "origem_djen_hash"));
  document.getElementById("atividade-id").value = atividade ? atividade.id : "";
  document.getElementById("atividade-tipo").value = atividade ? atividade.tipo : "tarefa";
  document.getElementById("atividade-titulo").value = atividade ? atividade.titulo : "";
  if (window._fpAtividadeData) {
    window._fpAtividadeData.setDate(atividade ? (atividade.data || "") : "", false);
  } else {
    document.getElementById("atividade-data").value = atividade ? (atividade.data || "") : "";
  }
  document.getElementById("atividade-hora").value = atividade ? (atividade.hora || "") : "";
  const responsavel = document.getElementById("atividade-responsavel");
  limpar(responsavel);
  responsavel.appendChild(el("option", { value: "", texto: "Eu mesmo" }));
  const nomes = new Set([atividade?.responsavel].filter(Boolean));
  try {
    const { responsaveis } = await _buscarJson("/responsaveis");
    for (const nome of (responsaveis || []).filter(Boolean)) nomes.add(nome);
  } catch {
    mostrarAviso(resultado, "Não foi possível carregar os responsáveis. O responsável atual foi preservado. Reabra a atividade para tentar novamente.");
  }
  for (const nome of nomes) responsavel.appendChild(el("option", { value: nome, texto: formatarNomeExibicao(nome) }));
  responsavel.value = atividade?.responsavel || "";
  const hashOrigem = form.dataset.publicacaoHash;
  document.getElementById("atividade-observacoes").value = String(atividade?.observacoes || "").split(/\r?\n/)
    .filter((linha) => !hashOrigem || linha !== `Publicação de origem (DJEN): ${hashOrigem}`).join("\n").trim();
  const origem = document.getElementById("atividade-publicacao-origem");
  origem.textContent = document.getElementById("form-atividade").dataset.publicacaoHash
    ? `Origem: publicação DJEN ${document.getElementById("form-atividade").dataset.publicacaoHash}. Criar a atividade não altera o status da publicação.` : "";
  document.getElementById("modal-atividade-titulo").textContent = atividade ? "Editar atividade" : "Nova atividade";
  document.getElementById("form-atividade").dataset.casoId = casoId;
  const checklistWrapper = document.getElementById("atividade-checklist-wrapper");
  checklistWrapper.hidden = !atividade;
  checklistWrapper.dataset.casoId = casoId;
  checklistWrapper.dataset.aid = atividade ? atividade.id : "";
  if (atividade) await _carregarChecklistAtividade(casoId, atividade.id);
  abrirModal("modal-atividade");
}

async function _carregarChecklistAtividade(casoId, aid, tipoFeedback = "pagina") {
  const feedback = { tipo: tipoFeedback === "pagina" ? "pagina" : "interno", regiao: document.getElementById("atividade-checklist-lista") };
  try {
    const { itens } = await _buscarJson(`/casos/${casoId}/atividades/${aid}/checklist`, feedback);
    _renderizarChecklistAtividade(itens || []);
  } catch (erro) {
    mostrarToast("error", "Erro ao carregar checklist", erro.message);
  }
}

function _renderizarChecklistAtividade(itens) {
  const lista = document.getElementById("atividade-checklist-lista");
  limpar(lista);
  const wrapper = document.getElementById("atividade-checklist-wrapper");
  const { casoId, aid } = wrapper.dataset;
  const concluidos = itens.filter((i) => i.concluido).length;
  document.getElementById("atividade-checklist-progresso").textContent =
    itens.length ? `${concluidos} de ${itens.length} concluído(s)` : "Nenhum item ainda";
  for (const item of itens) {
    const linha = el("div", { class: "atividade-item" });
    const check = el("input", { type: "checkbox", class: "atividade-check", "aria-label": "Concluído" });
    check.checked = item.concluido;
    check.addEventListener("change", async () => {
      try {
        await _enviarJson(`/casos/${casoId}/atividades/${aid}/checklist/${item.id}`, { concluido: check.checked }, "PATCH");
        await _carregarChecklistAtividade(casoId, aid);
      } catch (erro) {
        check.checked = !check.checked;
        mostrarToast("error", "Erro", erro.message);
      }
    });
    linha.appendChild(check);
    const corpo = el("div", { class: "atividade-corpo" });
    corpo.appendChild(el("p", { class: `atividade-titulo${item.concluido ? " concluida" : ""}`, texto: item.texto }));
    linha.appendChild(corpo);
    const btnExcluir = el("button", { class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button", texto: "✕" });
    btnExcluir.setAttribute("aria-label", "Excluir item");
    btnExcluir.addEventListener("click", async () => {
      try {
        await _enviarJson(`/casos/${casoId}/atividades/${aid}/checklist/${item.id}`, {}, "DELETE");
        await _carregarChecklistAtividade(casoId, aid);
      } catch (erro) { mostrarToast("error", "Erro", erro.message); }
    });
    const acoes = el("div", { class: "atividade-acoes" });
    acoes.appendChild(btnExcluir);
    linha.appendChild(acoes);
    lista.appendChild(linha);
  }
}

document.getElementById("atividade-checklist-adicionar-botao").addEventListener("click", async () => {
  const wrapper = document.getElementById("atividade-checklist-wrapper");
  const { casoId, aid } = wrapper.dataset;
  const campo = document.getElementById("atividade-checklist-novo");
  const texto = campo.value.trim();
  if (!texto) return;
  try {
    await _enviarJson(`/casos/${casoId}/atividades/${aid}/checklist`, { texto });
    campo.value = "";
    await _carregarChecklistAtividade(casoId, aid);
  } catch (erro) { mostrarToast("error", "Erro", erro.message); }
});
document.getElementById("atividade-checklist-novo").addEventListener("keydown", (evento) => {
  if (evento.key === "Enter") {
    evento.preventDefault();
    document.getElementById("atividade-checklist-adicionar-botao").click();
  }
});

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

async function _carregarPublicacoesCaso(casoId, tipoFeedback = "interno") {
  const feedback = { tipo: tipoFeedback === "pagina" ? "pagina" : "interno", regiao: document.getElementById("lista-publicacoes-caso") };
  const lista = document.getElementById("lista-publicacoes-caso");
  limpar(lista);
  try {
    const resp = await _buscarJson(`/casos/${casoId}/publicacoes`, feedback);
    const pubs = resp.publicacoes || [];
    if (!pubs.length) {
      lista.textContent = "Nenhuma publicação vinculada a este processo.";
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
        if (!(await confirmarAcao("Desvincular esta publicação do processo?"))) return;
        try {
          await _enviarJson(`/casos/${cid}/publicacoes/${h}`, {}, "DELETE");
          invalidarOrigemAtividade();
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

// ─── Capa do processo (DataJud + DJEN, via consultar_processo_unificado) ────

const _CAMPOS_CAPA_MANUAIS = [
  ["area_direito", "Área do direito"],
  ["magistrado", "Magistrado"],
  ["valor_causa", "Valor da causa"],
  ["fase", "Fase"],
  ["status_processo", "Status do processo"],
];

function formatarNumeroCNJ(valor) {
  return String(valor || "").replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, "$1-$2.$3.$4.$5.$6");
}

async function _carregarCapaProcessos(casoId, tipoFeedback = "interno") {
  const feedback = { tipo: tipoFeedback === "pagina" ? "pagina" : "interno", regiao: document.getElementById("lista-capa-processos") };
  const lista = document.getElementById("lista-capa-processos");
  limpar(lista);
  let numeros;
  try {
    numeros = (await _buscarJson(`/casos/${casoId}`, feedback)).processos || [];
  } catch (erro) {
    mostrarErro(lista, erro.message);
    return;
  }
  if (!numeros.length) {
    lista.appendChild(notificacao("info", "Este processo não tem número CNJ para consultar a capa."));
    return;
  }
  const movimentos = [];
  for (const numero of numeros) {
    try {
      const capa = await _buscarJson(`/casos/${casoId}/processos/${numero}/capa`, feedback);
      lista.appendChild(_cardCapaProcesso(casoId, numero, capa));
      movimentos.push(...(capa.movimentos || []));
    } catch (erro) {
      lista.appendChild(notificacao("error", `${numero}: ${erro.message}`));
    }
  }
  const listaMovs = document.getElementById("lista-movimentacoes");
  limpar(listaMovs);
  if (movimentos.length) listaMovs.appendChild(linhaDoTempoMovimentos(movimentos));
  else listaMovs.appendChild(notificacao("info", "Nenhuma movimentação disponível. Atualize a capa para consultar o DataJud."));
}

async function _atualizarCapaProcessos(casoId) {
  const statusEl = document.getElementById("capa-status");
  limpar(statusEl);
  const numeros = (await _buscarJson(`/casos/${casoId}`)).processos || [];
  if (!numeros.length) {
    mostrarAviso(statusEl, "Este processo não tem número CNJ para consultar a capa.");
    return;
  }
  const botao = document.getElementById("btn-atualizar-capa");
  botao.disabled = true;
  statusEl.appendChild(notificacao("info", `Atualizando ${numeros.length} processo(s)…`));
  const erros = [];
  for (const numero of numeros) {
    const tribunal = _siglaTribunal(numero);
    if (!tribunal) { erros.push(`${numero}: não foi possível determinar o tribunal`); continue; }
    try {
      await _enviarJson(`/casos/${casoId}/processos/${numero}/capa/atualizar`, { tribunal }, "POST");
    } catch (erro) {
      erros.push(`${numero}: ${erro.message}`);
    }
  }
  botao.disabled = false;
  limpar(statusEl);
  if (erros.length) mostrarAviso(statusEl, erros.join(" | "));
  const caso = await _buscarJson(`/casos/${casoId}`);
  if (_casoDetalheAtual?.id !== casoId) return;
  _casoDetalheAtual = caso;
  document.getElementById("caso-detalhe-titulo").textContent = caso.titulo ? formatarNomeExibicao(caso.titulo) : "(sem título)";
  await _carregarCapaProcessos(casoId);
}

function _numeroProcessoComMascara(numero) {
  return String(numero).replace(/\D/g, "").replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, "$1-$2.$3.$4.$5.$6");
}

function _dataDistribuicaoLegivel(valor) {
  if (!valor) return "";
  const partes = String(valor).match(/^(\d{4})-?(\d{2})-?(\d{2})(?:T|\s)?(\d{2}):?(\d{2}):?(\d{2})/);
  if (partes) return `${partes[3]}/${partes[2]}/${partes[1]} ${partes[4]}:${partes[5]}:${partes[6]}`;
  const data = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return data ? `${data[3]}/${data[2]}/${data[1]}` : String(valor);
}

function _participantesCapa(capa) {
  const nomes = (registros) => [...new Set(registros.map(p => formatarNomeExibicao((p.nome || "").trim())).filter(Boolean))].join("; ");
  const partes = capa.partes || [];
  const poloAtivo = p => /^(A|AT|ATIVO)$/i.test(p.polo || "");
  const poloPassivo = p => /^(P|PA|PASSIVO)$/i.test(p.polo || "");
  const advogados = [...new Set((capa.advogados || []).map(registro => {
    const advogado = registro.advogado || registro;
    const nome = formatarNomeExibicao((advogado.nome || "").trim());
    if (!nome) return "";
    const oab = String(advogado.numero_oab || "").trim();
    const uf = String(advogado.uf_oab || "").trim().toUpperCase();
    return oab ? `${nome} — OAB ${oab}${uf ? `/${uf}` : ""}` : nome;
  }).filter(Boolean))].join("; ");
  return [
    ["Polo ativo", nomes(partes.filter(poloAtivo)) || "Não informado pelo DJEN"],
    ["Polo passivo", nomes(partes.filter(poloPassivo)) || "Não informado pelo DJEN"],
    ["Partes sem polo informado", nomes(partes.filter(p => !poloAtivo(p) && !poloPassivo(p)))],
    ["Advogados", advogados || "Não informado pelo DJEN"],
  ];
}

function _cardCapaProcesso(casoId, numero, capa) {
  const autoCampos = [
    ["Tribunal", capa.tribunal], ["Ação", _casoDetalheAtual?.acao], ["Classe", capa.classe], ["Grau", capa.grau],
    ["Foro / Vara (órgão julgador)", capa.orgao_julgador],
    ["Tipo de justiça", capa.tipo_justica], ["Município", capa.cidade], ["UF", capa.uf],
    ["Assuntos", (capa.assuntos || []).join(", ")], ["Distribuição", _dataDistribuicaoLegivel(capa.data_distribuicao)],
    ["Nível de sigilo", capa.nivel_sigilo], ["Nome do processo", capa.nome_processo ? formatarNomeExibicao(capa.nome_processo) : ""],
    ..._participantesCapa(capa),
  ].filter(([, valor]) => valor !== null && valor !== undefined && valor !== "");

  const blocoAuto = autoCampos.length
    ? el("dl", { class: "capa-card-auto" }, autoCampos.flatMap(([rotulo, valor]) => [
        el("dt", {}, [document.createTextNode(rotulo)]),
        el("dd", {}, [document.createTextNode(String(valor ?? "Não informado"))]),
      ]))
    : el("p", { class: "texto-auxiliar" }, [document.createTextNode(
        "Sem dados automáticos ainda — clique em \"Atualizar capa\" para buscar no DataJud/DJEN.",
      )]);

  const campos = {};
  const inputs = _CAMPOS_CAPA_MANUAIS.map(([chave, rotulo]) => {
    const input = el("input", {
      class: "cds--text-input", type: chave === "valor_causa" ? "number" : "text",
      placeholder: rotulo, value: capa[chave] ?? "",
      id: `capa-${numero}-${chave}`,
      ...(chave === "valor_causa" ? { step: "0.01", min: "0" } : {}),
    });
    campos[chave] = input;
    return el("div", { class: "cds--form-item capa-card-campo" }, [
      el("label", { class: "cds--label", for: `capa-${numero}-${chave}` }, [document.createTextNode(rotulo)]),
      input,
    ]);
  });

  const btnSalvar = el(
    "button", { class: "cds--btn cds--btn--tertiary cds--btn--sm", type: "button" },
    [document.createTextNode("Salvar")],
  );
  btnSalvar.addEventListener("click", async () => {
    btnSalvar.disabled = true;
    const corpo = {};
    for (const [chave] of _CAMPOS_CAPA_MANUAIS) {
      const valor = campos[chave].value.trim();
      corpo[chave] = chave === "valor_causa" ? (valor ? Number(valor) : null) : (valor || null);
    }
    try {
      await _enviarJson(`/casos/${casoId}/processos/${numero}/capa`, corpo, "PATCH");
      mostrarToast("success", "Capa salva", `Processo ${numero} atualizado.`);
    } catch (erro) {
      mostrarToast("error", "Erro", erro.message);
    } finally {
      btnSalvar.disabled = false;
    }
  });

  const btnMonitorar = el(
    "button", { class: "cds--btn cds--btn--ghost cds--btn--sm", type: "button" },
    [document.createTextNode(capa.monitorando ? "Parar monitoramento" : "Monitorar automaticamente")],
  );
  btnMonitorar.addEventListener("click", async () => {
    btnMonitorar.disabled = true;
    const monitorando = capa.monitorando;
    try {
      await _enviarJson(
        `/casos/${casoId}/processos/${numero}/capa/monitorar`, {},
        monitorando ? "DELETE" : "POST",
      );
      capa.monitorando = !monitorando;
      btnMonitorar.textContent = capa.monitorando ? "Parar monitoramento" : "Monitorar automaticamente";
      mostrarToast("success", capa.monitorando ? "Monitoramento ativado" : "Monitoramento removido",
        `Processo ${formatarNumeroCNJ(numero)}.`);
    } catch (erro) {
      mostrarToast("error", "Erro", erro.message);
    } finally {
      btnMonitorar.disabled = false;
    }
  });

  return el("div", { class: "capa-card" }, [
    el("h4", {}, [document.createTextNode(formatarNumeroCNJ(numero))]),
    blocoAuto,
    el("div", { class: "capa-card-campos cds--css-grid" }, inputs),
    el("div", { class: "capa-card-acoes" }, [btnSalvar, btnMonitorar]),
  ]);
}

async function _buscarMovimentacoes(casoId) {
  const statusEl = document.getElementById("movimentacoes-status");
  const lista = document.getElementById("lista-movimentacoes");
  limpar(lista);
  limpar(statusEl);
  const resp = await _buscarJson(`/casos/${casoId}`);
  const numeros = resp.processos || [];
  if (!numeros.length) {
    mostrarAviso(statusEl, "Informe o número CNJ no Cadastro para consultar as movimentações.");
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

// ─── Vínculos entre processos ────────────────────────────────────────────────────

const _ROTULO_TIPO_VINCULO = {
  recurso: "Recurso",
  apenso: "Apenso",
  execucao: "Execução de sentença",
  cautelar: "Cautelar / Tutela",
  relacionado: "Relacionado",
};

async function _carregarVinculos(casoId, tipoFeedback = "interno") {
  const feedback = { tipo: tipoFeedback === "pagina" ? "pagina" : "interno", regiao: document.getElementById("lista-vinculos") };
  const lista = document.getElementById("lista-vinculos");
  limpar(lista);
  try {
    const { vinculos } = await _buscarJson(`/casos/${casoId}/vinculos`, feedback);
    _renderizarVinculos(casoId, vinculos || []);
  } catch (erro) {
    mostrarErro(lista, erro.message);
  }
  await _popularSelectCasos(casoId);
}

let _casosVinculoDisponiveis = [];

async function _popularSelectCasos(casoAtualId) {
  _casosVinculoDisponiveis = [];
  const campoNumero = document.getElementById("vinculos-numero-processo");
  const campoCasoId = document.getElementById("vinculos-caso-select");
  const preview = document.getElementById("vinculos-preview");
  campoNumero.value = "";
  campoCasoId.value = "";
  preview.hidden = true;
  try {
    const { casos } = await _buscarJson("/casos");
    _casosVinculoDisponiveis = (casos || []).filter((c) => c.id !== casoAtualId);
  } catch (_) { /* silencioso — busca por número fica indisponível até recarregar */ }
}

function _buscarCasoPorNumeroProcesso() {
  const campoNumero = document.getElementById("vinculos-numero-processo");
  const campoCasoId = document.getElementById("vinculos-caso-select");
  const preview = document.getElementById("vinculos-preview");
  const digitado = _soDigitos(campoNumero.value);
  if (!digitado) {
    campoCasoId.value = "";
    preview.hidden = true;
    return;
  }
  const encontrado = _casosVinculoDisponiveis.find((c) =>
    (c.processos || []).some((p) => _soDigitos(p) === digitado)
  );
  if (encontrado) {
    campoCasoId.value = encontrado.id;
    const parte = encontrado.autor || encontrado.reu || "(parte não informada)";
    const acao = encontrado.acao || "(ação não informada)";
    preview.textContent = `Parte: ${parte} · Ação: ${acao}` + (encontrado.titulo ? ` — ${encontrado.titulo}` : "");
    preview.hidden = false;
  } else {
    campoCasoId.value = "";
    preview.textContent = "Nenhum processo cadastrado com esse número de processo.";
    preview.hidden = false;
  }
}

document.getElementById("vinculos-numero-processo").addEventListener("input", _buscarCasoPorNumeroProcesso);

function _renderizarVinculos(casoId, vinculos) {
  const lista = document.getElementById("lista-vinculos");
  limpar(lista);
  if (!vinculos.length) {
    lista.appendChild(notificacao("info", "Nenhum processo vinculado"));
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
    resultado.appendChild(notificacao("error", "Selecione um processo."));
    return;
  }
  const botao = evento.target.querySelector("button[type=submit]");
  botao.disabled = true;
  try {
    await _enviarJson(`/casos/${casoId}/vinculos`, { caso_vinculado_id: outroId, tipo });
    limpar(resultado);
    document.getElementById("vinculos-caso-select").value = "";
    document.getElementById("vinculos-numero-processo").value = "";
    document.getElementById("vinculos-preview").hidden = true;
    document.getElementById("vinculos-tipo-select").value = "relacionado";
    document.getElementById("vinculos-adicionar-painel").open = false;
    mostrarToast("success", "Vínculo criado", "Processo vinculado com sucesso.");
    await _carregarVinculos(casoId);
  } catch (erro) {
    resultado.appendChild(notificacao("error", erro.message));
  } finally {
    botao.disabled = false;
  }
});

document.getElementById("caso-voltar").addEventListener("click", voltarParaCasos);
document.getElementById("caso-subaba-cadastro-botao").addEventListener("click", () => _selecionarSubabaCaso("cadastro"));
document.getElementById("caso-subaba-atividades-botao").addEventListener("click", () => _selecionarSubabaCaso("atividades"));
document.getElementById("caso-subaba-publicacoes-botao").addEventListener("click", () => {
  _selecionarSubabaCaso("publicacoes");
  const casoId = document.getElementById("form-caso-editar").dataset.casoId;
  if (casoId) _carregarPublicacoesCaso(casoId, "pagina");
});
document.getElementById("caso-subaba-movimentacoes-botao").addEventListener("click", () => {
  _selecionarSubabaCaso("movimentacoes");
  const casoId = document.getElementById("form-caso-editar").dataset.casoId;
});
document.getElementById("caso-subaba-vinculos-botao").addEventListener("click", () => {
  _selecionarSubabaCaso("vinculos");
  const casoId = document.getElementById("form-caso-editar").dataset.casoId;
  if (casoId) _carregarVinculos(casoId, "pagina");
});
document.getElementById("btn-buscar-movimentacoes").addEventListener("click", () => {
  const casoId = document.getElementById("form-caso-editar").dataset.casoId;
  if (casoId) _buscarMovimentacoes(casoId);
});
document.getElementById("btn-atualizar-capa").addEventListener("click", () => {
  const casoId = document.getElementById("form-caso-editar").dataset.casoId;
  if (casoId) _atualizarCapaProcessos(casoId);
});

document.getElementById("btn-nova-atividade").addEventListener("click", () => {
  const casoId = document.getElementById("form-caso-editar").dataset.casoId;
  if (casoId) _abrirModalAtividade(casoId);
});
document.getElementById("modal-atividade-fechar").addEventListener("click", () => fecharModal("modal-atividade"));

registrarSalvamento(document.getElementById("form-caso-editar"), async (evento) => {
  evento.preventDefault();
  const casoId = evento.target.dataset.casoId;
  if (!casoId) return;
  const botao = evento.target.querySelector("button[type=submit]");
  const resultado = document.getElementById("resultado-caso-editar");
  const corpo = {
    responsavel: document.getElementById("editar-caso-responsavel").value.trim(),
    pasta: document.getElementById("editar-caso-pasta").value.trim(),
    acesso: document.getElementById("editar-caso-acesso").value,
  };
  const pararEspera = mostrarEspera(resultado, botao, "Salvando");
  try {
    const atualizado = await _enviarJson(`/casos/${casoId}`, corpo, "PATCH");
    limpar(resultado);
    resultado.appendChild(notificacao("success", "Processo atualizado"));
    marcarFormularioSalvo(evento.target);
    _casoDetalheAtual = atualizado;
    document.getElementById("caso-detalhe-titulo").textContent = atualizado.titulo ? formatarNomeExibicao(atualizado.titulo) : "(sem título)";
    const indice = _cache.casos.findIndex((c) => c.id === casoId);
    if (indice !== -1) _cache.casos[indice] = { ..._cache.casos[indice], ...atualizado };
  } catch (erro) {
    mostrarErro(resultado, erro.message);
  } finally {
    pararEspera();
  }
});

document.getElementById("btn-excluir-caso").addEventListener("click", async () => {
  const casoId = document.getElementById("form-caso-editar").dataset.casoId;
  if (!casoId) return;
  const titulo = _casoDetalheAtual?.titulo || "(sem título)";
  if (!(await confirmarAcao(`Excluir o processo "${titulo}"? Essa ação não pode ser desfeita.`))) return;
  const botao = document.getElementById("btn-excluir-caso");
  botao.disabled = true;
  try {
    await _enviarJson(`/casos/${casoId}`, {}, "DELETE");
    _cache.casos = _cache.casos.filter((c) => c.id !== casoId);
    marcarFormularioSalvo(document.getElementById("form-caso-editar"), true);
    await voltarParaCasos();
    mostrarToast("success", "Processo excluído");
    _renderizarTabelaCasosPagina();
  } catch (erro) {
    mostrarErro(document.getElementById("resultado-caso-editar"), erro.message);
    botao.disabled = false;
  }
});

registrarSalvamento(document.getElementById("form-atividade"), async (evento) => {
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
    responsavel: document.getElementById("atividade-responsavel").value || null,
    observacoes: document.getElementById("atividade-observacoes").value.trim() || null,
  };
  const origem = evento.target.dataset.publicacaoHash;
  if (evento.target.dataset.origemEstruturada === "true") {
    // Edição comum não troca a origem, inclusive se um marcador antigo permaneceu no texto.
    if (!aid) corpo.origem_djen_hash = origem || null;
  }
  else if (origem) corpo.observacoes = [corpo.observacoes, `Publicação de origem (DJEN): ${origem.replace(/[\r\n]/g, "")}`].filter(Boolean).join("\n");
  if (!corpo.titulo) { mostrarErro(resultado, "Informe o título."); return; }
  const pararEspera = mostrarEspera(resultado, botao, "Salvando");
  try {
    if (aid) {
      await _enviarJson(`/casos/${casoId}/atividades/${aid}`, corpo, "PATCH");
    } else {
      await _enviarJson(`/casos/${casoId}/atividades`, corpo);
    }
    marcarFormularioSalvo(document.getElementById("form-atividade"));
    fecharModal("modal-atividade");
    await _carregarAtividades(casoId);
    _selecionarSubabaCaso("atividades");
    mostrarToast("success", "Atividade salva", origem ? "A publicação mantém o status anterior. Use Ver publicação de origem para conferir a referência." : "");
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
    altInput: opcoes.dateFormat === "Y-m-d",
    altFormat: "d/m/Y",
    allowInput: true,
    locale: window.flatpickr.l10ns && window.flatpickr.l10ns.pt,
    plugins: [new window.rangePlugin({ input: elFim })],
  }, opcoes));
}

// dateFormat define exatamente o texto entregue em `.value` (o formato que o backend espera).
_inicializarDatePickerRange("pub-data-inicio", "pub-data-fim", { dateFormat: "d/m/Y" });
_inicializarDatePickerRange("jur-data-inicio", "jur-data-fim", { dateFormat: "d/m/Y" });
_inicializarDatePickerRange("pub-oab-manual-data-inicio", "pub-oab-manual-data-fim", { dateFormat: "Y-m-d" });

// Date picker simples para atividade-data (sem range plugin).
(function () {
  const el = document.getElementById("atividade-data");
  if (!el || typeof window.flatpickr !== "function") return;
  const fp = window.flatpickr(el, {
    altInput: true,
    altFormat: "d/m/Y",
    allowInput: true,
    locale: window.flatpickr.l10ns && window.flatpickr.l10ns.pt,
    dateFormat: "Y-m-d",
  });
  // Expõe a instância para que _abrirModalAtividade possa pré-popular via setDate().
  window._fpAtividadeData = fp;
})();

// Date picker simples para honorario-vencimento (sem range plugin).
(function () {
  const el = document.getElementById("honorario-vencimento");
  if (!el || typeof window.flatpickr !== "function") return;
  window.flatpickr(el, {
    appendTo: document.querySelector("#modal-honorario cds-modal-body"),
    altInput: false,
    allowInput: true,
    locale: window.flatpickr.l10ns && window.flatpickr.l10ns.pt,
    dateFormat: "d/m/Y",
  });
})();

document.getElementById("btn-novo-lancamento").addEventListener("click", () => abrirModal("modal-lancamento-tipo"));

document.getElementById("btn-lancamento-tipo-honorario").addEventListener("click", async () => {
  fecharModal("modal-lancamento-tipo");
  await _abrirModalHonorario();
});

document.getElementById("modal-honorario-fechar").addEventListener("click", () => fecharModal("modal-honorario"));

registrarSalvamento(document.getElementById("form-honorario"), async (evento) => {
  evento.preventDefault();
  const botao = document.querySelector("button[form='form-honorario'][type='submit']");
  const resultado = document.getElementById("resultado-honorario");
  const campoValor = document.getElementById("honorario-valor");
  if (_valorLancamentoEmReais(campoValor.value) === null) {
    campoValor.setCustomValidity("Informe um valor maior que zero, como 1.500,00.");
    campoValor.reportValidity();
    return;
  }
  const clienteId = document.getElementById("honorario-cliente").value;
  if (!clienteId) {
    mostrarErro(resultado, "Busque e selecione um cliente cadastrado.");
    return;
  }
  const casoIds = [...document.querySelectorAll("#honorario-processos-opcoes input:checked")].map((input) => input.value);
  if (!casoIds.length) {
    mostrarErro(resultado, "Selecione ao menos um processo do cliente.");
    return;
  }
  const descricao = document.getElementById("honorario-descricao").value.trim();
  const vencimento = _ddmmaaaaParaIso(document.getElementById("honorario-vencimento").value);
  const valorTotal = _valorLancamentoEmReais(campoValor.value);
  const recorrente = document.getElementById("honorario-recorrente").checked;
  const responsavel = document.getElementById("honorario-responsavel").value.trim();
  const direcao = document.getElementById("honorario-direcao").value;
  const parcelando = document.getElementById("honorario-parcelar").checked;
  const quantidadeParcelas = parcelando ? parseInt(document.getElementById("honorario-parcelas").value, 10) : 1;
  const parcelas = parcelando
    ? _calcularValoresParcelas(Math.round(valorTotal * 100), quantidadeParcelas).map((centavos, indice) => ({
      valor: centavos / 100,
      vencimento: _somarMeses(vencimento, indice),
      descricao: `${descricao} (parcela ${indice + 1}/${quantidadeParcelas})`,
    }))
    : [{ valor: valorTotal, vencimento, descricao }];
  const pararEspera = mostrarEspera(resultado, botao, "Salvando");
  try {
    for (const casoId of casoIds) {
      for (const parcela of parcelas) {
        await _enviarJson("/lancamentos", {
          vencimento: parcela.vencimento,
          valor: parcela.valor,
          descricao: parcela.descricao,
          recorrente,
          caso_id: casoId,
          cliente_id: clienteId,
          responsavel,
          direcao,
        });
      }
    }
    marcarFormularioSalvo(document.getElementById("form-honorario"));
    await fecharModal("modal-honorario");
    mostrarToast("success", "Lançamento salvo");
    await carregarLancamentos();
  } catch (erro) {
    mostrarErro(resultado, erro.message);
  } finally {
    pararEspera();
  }
});

// Alternância entre visualização em tabela e em cards na aba Casos.
// Os botões vivem no HTML (fora de #lista-casos, que é recriado a cada render), então
// os listeners são registrados uma única vez aqui e apenas re-renderizam a lista.
(function () {
  const switcher = document.getElementById("casos-vista-switcher");
  const botaoTabela = document.getElementById("casos-vista-tabela-botao");
  const botaoCards = document.getElementById("casos-vista-cards-botao");
  if (!switcher || !botaoTabela || !botaoCards) return;

  function selecionar(visualizacao) {
    _visualizacaoCasos = visualizacao;
    for (const outro of switcher.querySelectorAll("button")) {
      outro.classList.remove("cds--content-switcher--selected");
      outro.setAttribute("aria-pressed", "false");
    }
    const ativo = visualizacao === "cards" ? botaoCards : botaoTabela;
    ativo.classList.add("cds--content-switcher--selected");
    ativo.setAttribute("aria-pressed", "true");
    _renderizarTabelaCasosPagina();
  }

  botaoTabela.addEventListener("click", () => selecionar("tabela"));
  botaoCards.addEventListener("click", () => selecionar("cards"));
  switcher.addEventListener("keydown", (ev) => {
    const botoes = [botaoCards, botaoTabela];
    let alvo;
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") alvo = botoes[1 - botoes.indexOf(document.activeElement)];
    else if (ev.key === "Home") alvo = botaoCards;
    else if (ev.key === "End") alvo = botaoTabela;
    if (alvo) { ev.preventDefault(); alvo.click(); alvo.focus(); }
  });
})();

// Revisão transversal usando as mesmas permissões e endpoints do detalhe.
let _atividadesAbertas = [];
let _geracaoAtividades = 0;
function valorFiltroExecutor(atividade) {
  return atividade.responsavel ? `responsavel:${atividade.responsavel}` : "sem-responsavel";
}
async function carregarAtividadesAbertas(tipoFeedback = "interno") {
  const feedback = { tipo: tipoFeedback === "pagina" ? "pagina" : "interno", regiao: document.getElementById("atividades-lista") };
  const lista = document.getElementById("atividades-lista");
  const status = document.getElementById("atividades-status");
  const geracao = ++_geracaoAtividades;
  _atividadesAbertas = [];
  limpar(lista); limpar(status);
  if (!exigirCliente(status)) return;
  const atualizar = document.getElementById("atividades-atualizar");
  atualizar.disabled = true;
  status.appendChild(el("p", { role: "status", texto: "Carregando atividades dos processos…" }));
  try {
    const { casos } = await _buscarJson("/casos", feedback);
    if (!Array.isArray(casos)) throw new Error("Resposta de processos inválida.");
    const resultados = [];
    const falhas = [];
    let indice = 0;
    // Limita concorrência para não disparar uma requisição por processo de uma vez.
    await Promise.all(Array.from({ length: Math.min(4, casos.length) }, async () => {
      while (indice < casos.length && geracao === _geracaoAtividades) {
        const caso = casos[indice++];
        try {
          const dados = await _buscarJson(`/casos/${caso.id}/atividades`, feedback);
          if (!Array.isArray(dados.atividades)) throw new Error("Resposta de atividades inválida.");
          resultados.push(...dados.atividades.filter((a) => a.status !== "concluida").map((atividade) => ({ caso, atividade })));
        } catch { falhas.push(caso.titulo || "Processo sem título"); }
      }
    }));
    if (geracao !== _geracaoAtividades) return;
    _atividadesAbertas = resultados;
    const responsavel = document.getElementById("atividades-responsavel");
    const anterior = responsavel.value;
    limpar(responsavel);
    responsavel.appendChild(el("option", { value: "", texto: "Todos" }));
    for (const nome of [...new Set(casos.map((c) => c.responsavel || "Sem responsável"))].sort()) responsavel.appendChild(el("option", { value: nome, texto: nome === "Sem responsável" ? nome : formatarNomeExibicao(nome) }));
    if ([...responsavel.options].some((o) => o.value === anterior)) responsavel.value = anterior;
    const executor = document.getElementById("atividades-executor");
    const executorAnterior = executor.value;
    limpar(executor);
    executor.appendChild(el("option", { value: "", texto: "Todos" }));
    const executores = new Map(resultados.map(({ atividade }) => [valorFiltroExecutor(atividade), atividade.responsavel || "Sem responsável"]));
    for (const [valor, nome] of [...executores].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))) {
      executor.appendChild(el("option", { value: valor, texto: nome }));
    }
    if ([...executor.options].some((o) => o.value === executorAnterior)) executor.value = executorAnterior;
    limpar(status);
    if (falhas.length) {
      status.appendChild(notificacao("warning", "Lista incompleta", `Não foi possível carregar ${falhas.length} processo(s): ${falhas.join(", ")}. Use Atualizar atividades para tentar novamente.`));
    } else status.appendChild(el("p", { class: "campo-ajuda", role: "status", texto: `Revisados ${casos.length} processos. Atualizado às ${new Date().toLocaleTimeString("pt-BR")}.` }));
    renderizarAtividadesAbertas();
  } catch (erro) {
    if (geracao === _geracaoAtividades) mostrarErro(status, `${erro.message} Use Atualizar atividades para tentar novamente.`);
  } finally {
    if (geracao === _geracaoAtividades) atualizar.disabled = false;
  }
}
function renderizarAtividadesAbertas() {
  const lista = document.getElementById("atividades-lista");
  limpar(lista);
  const responsavel = document.getElementById("atividades-responsavel").value;
  const executor = document.getElementById("atividades-executor").value;
  const tipo = document.getElementById("atividades-tipo").value;
  const itens = _atividadesAbertas.filter(({ caso, atividade }) => (!responsavel || (caso.responsavel || "Sem responsável") === responsavel)
    && (!executor || valorFiltroExecutor(atividade) === executor) && (!tipo || atividade.tipo === tipo));
  if (!itens.length) {
    lista.appendChild(notificacao("info", "Nenhuma atividade aberta nos processos carregados com estes filtros"));
    return;
  }
  for (const { caso, atividade } of itens) {
    const item = el("article", { class: "atividade-item" });
    const corpo = el("div", { class: "atividade-corpo" }, [
      el("h3", { class: "atividade-titulo", texto: formatarNomeExibicao(atividade.titulo) }),
      el("p", { class: "atividade-meta", texto: `${caso.titulo ? formatarNomeExibicao(caso.titulo) : "Processo sem título"} · Responsável pelo processo: ${caso.responsavel ? formatarNomeExibicao(caso.responsavel) : "Não definido"}` }),
      el("p", { class: "atividade-meta", texto: `Responsável pela atividade: ${atividade.responsavel || "Sem responsável"}` }),
      el("p", { class: "atividade-meta", texto: `${_ROTULO_TIPO_ATIVIDADE[atividade.tipo] || atividade.tipo} · ${atividade.data ? formatarDataSimples(atividade.data) : "Sem data"}${atividade.hora ? " · " + atividade.hora : ""}` }),
    ]);
    const abrir = el("button", { type: "button", class: "cds--btn cds--btn--ghost cds--btn--sm", texto: "Abrir processo", onclick: async () => {
      if (!(await selecionarAba(abas.find((a) => a.painel.id === "aba-casos")))) return;
      if (await abrirCaso(caso.id)) _selecionarSubabaCaso("atividades");
    } });
    const concluir = el("button", { type: "button", class: "cds--btn cds--btn--tertiary cds--btn--sm", texto: "Concluir atividade", "aria-label": `Concluir atividade: ${atividade.titulo}`, onclick: async () => {
      concluir.disabled = true;
      try {
        await _enviarJson(`/casos/${caso.id}/atividades/${atividade.id}`, { status: "concluida" }, "PATCH");
        _atividadesAbertas = _atividadesAbertas.filter((a) => !(a.caso.id === caso.id && a.atividade.id === atividade.id));
        renderizarAtividadesAbertas();
        document.getElementById("atividades-atualizar").focus();
        mostrarToast("success", "Atividade concluída", atividade.titulo);
      } catch (erro) { mostrarToast("error", "Não foi possível concluir a atividade", erro.message); concluir.disabled = false; }
    } });
    item.append(corpo, el("div", { class: "atividade-acoes" }, [abrir, concluir]));
    lista.appendChild(item);
  }
}
document.getElementById("atividades-atualizar").addEventListener("click", carregarAtividadesAbertas);
for (const id of ["atividades-executor", "atividades-responsavel", "atividades-tipo"]) document.getElementById(id).addEventListener("change", renderizarAtividadesAbertas);

// --- Header: hambúrguer / side-nav rail ----------------------------------------------------
const _mqMobile = window.matchMedia("(max-width: 768px)");
const _sideNav = document.getElementById("side-nav");
const _sideNavOverlay = document.getElementById("side-nav-overlay");
const _btnMenuToggle = document.getElementById("btn-menu-toggle");

function _sideNavAbrir() {
  _sideNav.classList.add("cds--side-nav--expanded");
  if (_mqMobile.matches) _sideNavOverlay.classList.add("cds--side-nav__overlay-active");
  _btnMenuToggle.setAttribute("aria-expanded", "true");
  _btnMenuToggle.setAttribute("aria-label", "Fechar menu");
}
function _sideNavFechar() {
  _sideNav.classList.remove("cds--side-nav--expanded");
  _sideNavOverlay.classList.remove("cds--side-nav__overlay-active");
  _btnMenuToggle.setAttribute("aria-expanded", "false");
  _btnMenuToggle.setAttribute("aria-label", "Abrir menu");
}
function _sideNavInicializar() {
  if (_mqMobile.matches) { _sideNavFechar(); return; }
  let salvo;
  try { salvo = localStorage.getItem("cnj_side_nav_expanded"); } catch { /* usa o padrão */ }
  if (salvo !== "0") _sideNavAbrir(); else _sideNavFechar();
}
_btnMenuToggle.addEventListener("click", () => {
  const vaiAbrir = !_sideNav.classList.contains("cds--side-nav--expanded");
  if (vaiAbrir) _sideNavAbrir(); else _sideNavFechar();
  if (!_mqMobile.matches) {
    try { localStorage.setItem("cnj_side_nav_expanded", vaiAbrir ? "1" : "0"); } catch { /* preferência só nesta sessão */ }
  }
});
_sideNavOverlay.addEventListener("click", _sideNavFechar);
_sideNav.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && _mqMobile.matches) {
    ev.preventDefault(); _sideNavFechar(); _btnMenuToggle.focus();
  }
});
_mqMobile.addEventListener("change", _sideNavInicializar);
_sideNavInicializar();

document.getElementById("link-home").addEventListener("click", (ev) => {
  ev.preventDefault();
  const abaProcesso = abas.find((a) => a.painel.id === "aba-processo");
  if (abaProcesso) selecionarAba(abaProcesso);
  if (_mqMobile.matches) _sideNavFechar();
});

// --- Header: notificações e busca (abrir um fecha o outro) ---------------------------------
const _btnNotificacoesToggle = document.getElementById("btn-notificacoes-toggle");
const _painelNotificacoes = document.getElementById("header-notificacoes-painel");
const _btnBuscaToggle = document.getElementById("btn-busca-toggle");
const _painelBusca = document.getElementById("header-busca-painel");
const _inputBusca = document.getElementById("header-busca-input");

function _fecharPainelNotificacoes() {
  _painelNotificacoes.hidden = true;
  const popover = document.getElementById("notificacoes-popover");
  popover.open = false;
  _btnNotificacoesToggle.setAttribute("aria-expanded", "false");
  _btnNotificacoesToggle.isSelected = false;
  _btnNotificacoesToggle.shadowRoot?.querySelector("button")?.setAttribute("aria-expanded", "false");
}
function _fecharPainelBusca() {
  _painelBusca.hidden = true;
  _btnBuscaToggle.setAttribute("aria-expanded", "false");
}
document.addEventListener("click", (ev) => {
  const caminho = ev.composedPath();
  if (!_painelNotificacoes.hidden && !caminho.includes(_painelNotificacoes) && !caminho.includes(_btnNotificacoesToggle)) {
    _fecharPainelNotificacoes();
  }
  if (!_painelBusca.hidden && !caminho.includes(_painelBusca) && !caminho.includes(_btnBuscaToggle)) {
    _fecharPainelBusca();
  }
});

// --- Header: busca global (cliente, processo, número de processo) ------------------------------
let _consultaGlobalCarregando = false;
let _consultaGlobalFalhas = [];
let _consultaGlobalGeracao = 0;
async function carregarConsultaGlobal() {
  const geracao = ++_consultaGlobalGeracao;
  _consultaGlobalCarregando = true;
  _consultaGlobalFalhas = [];
  atualizarConsultaGlobal();
  const fontes = [["clientes", "/clientes", "Clientes"], ["casos", "/casos", "Processos"]];
  const respostas = await Promise.allSettled(fontes.map(async ([chave, url]) => {
    const dados = await _buscarJson(url, { tipo: "interno", regiao: document.getElementById("header-busca-resultados") });
    if (!Array.isArray(dados[chave])) throw new Error("Resposta inválida");
    return dados[chave];
  }));
  if (geracao !== _consultaGlobalGeracao) return;
  respostas.forEach((resposta, i) => {
    const [chave, , nome] = fontes[i];
    if (resposta.status === "fulfilled") _cache[chave] = resposta.value;
    else { _cache[chave] = []; _consultaGlobalFalhas.push(nome); }
  });
  _consultaGlobalCarregando = false;
  atualizarConsultaGlobal();
}
function atualizarConsultaGlobal() {
  _renderizarResultadosBusca(_buscaGlobalResultados(_inputBusca.value));
}
_btnBuscaToggle.addEventListener("click", async () => {
  const abrindo = _painelBusca.hidden;
  _fecharPainelNotificacoes();
  if (!abrindo) { _fecharPainelBusca(); return; }
  _painelBusca.hidden = false;
  _btnBuscaToggle.setAttribute("aria-expanded", "true");
  _inputBusca.focus();
  await carregarConsultaGlobal();
});

function _buscaGlobalResultados(termo) {
  const t = termo.toLowerCase().trim();
  const tDigitos = t.replace(/\D/g, "");
  if (!t) return [];
  const resultados = [];
  for (const c of _cache.clientes) {
    if ((c.nome || "").toLowerCase().includes(t)) {
      resultados.push({ tipo: "cliente", id: c.id, rotulo: c.nome, sub: "Cliente" });
    }
  }
  for (const c of _cache.casos) {
    const tituloBate = (c.titulo || "").toLowerCase().includes(t);
    const processoBate = tDigitos.length >= 3 && (c.processos || []).some((p) => p.replace(/\D/g, "").includes(tDigitos));
    if (tituloBate || processoBate) {
      resultados.push({ tipo: "caso", id: c.id, rotulo: c.titulo || "(sem título)", sub: processoBate ? "Processo · " + (c.processos || []).find((p) => p.replace(/\D/g, "").includes(tDigitos)) : "Processo" });
    }
  }
  return resultados;
}

function _renderizarResultadosBusca(resultados) {
  const container = document.getElementById("header-busca-resultados");
  limpar(container);
  if (_consultaGlobalCarregando) {
    container.appendChild(el("p", { class: "campo-ajuda", role: "status", texto: "Carregando clientes e processos…" }));
    return;
  }
  if (_consultaGlobalFalhas.length) {
    container.appendChild(notificacao("warning", "Consulta incompleta", `Não foi possível carregar: ${_consultaGlobalFalhas.join(", ")}. Conecte-se na aba Acesso se necessário e tente novamente.`));
    container.appendChild(el("button", { type: "button", class: "cds--btn cds--btn--tertiary cds--btn--sm", texto: "Tentar novamente", onclick: carregarConsultaGlobal }));
  }
  if (!_inputBusca.value.trim()) {
    container.appendChild(el("p", { class: "campo-ajuda", texto: "Digite um nome, título ou número de processo." }));
    return;
  }
  if (!resultados.length) {
    container.appendChild(el("p", { class: "campo-ajuda", texto: _consultaGlobalFalhas.length ? "Nenhuma correspondência nas fontes disponíveis." : "Nenhum resultado." }));
    return;
  }
  if (resultados.length > 20) container.appendChild(el("p", { class: "campo-ajuda", texto: `Mostrando 20 de ${resultados.length} resultados. Refine o termo para localizar o registro.` }));
  for (const r of resultados.slice(0, 20)) {
    const botao = el("button", {
      class: "header-busca-resultado-item", type: "button",
      texto: `${formatarNomeExibicao(r.rotulo)} — ${r.sub}`,
    });
    botao.addEventListener("click", async () => {
      _fecharPainelBusca();
      _inputBusca.value = "";
      limpar(container);
      if (_mqMobile.matches) _sideNavFechar();
      if (r.tipo === "cliente") {
        const abaContatos = abas.find((a) => a.painel.id === "aba-contatos");
        if (abaContatos && !(await selecionarAba(abaContatos))) return;
        await abrirContato(r.id);
      } else {
        const abaCasos = abas.find((a) => a.painel.id === "aba-casos");
        if (abaCasos && !(await selecionarAba(abaCasos))) return;
        await abrirCaso(r.id);
      }
    });
    container.appendChild(botao);
  }
}

_inputBusca.addEventListener("input", () => {
  _renderizarResultadosBusca(_buscaGlobalResultados(_inputBusca.value));
});

// Restaura a seção sem descartar edições nem colocar dados sensíveis na URL.
async function restaurarAbaDaUrl() {
  const alvo = abas.find((aba) => `#${aba.painel.id}` === window.location.hash)
    || abas.find((aba) => aba.painel.id === (cliente ? "aba-processo" : "aba-acesso"));
  await selecionarAba(alvo, { registrarHistorico: false });
  const atual = abas.find((aba) => !aba.painel.hidden);
  if (atual) window.history.replaceState(null, "", `#${atual.painel.id}`);
}
window.addEventListener("hashchange", restaurarAbaDaUrl);

// Valida também tokens lembrados antes de entrar no painel.
(async function carregarTokenSalvo() {
  let salvo;
  try { salvo = localStorage.getItem(CHAVE_TOKEN); } catch { /* continua sem persistência */ }
  if (!salvo) { await restaurarAbaDaUrl(); return; }
  campoToken.value = salvo;
  checkboxLembrar.checked = true;
  await validarToken(salvo, true, false);
  if (cliente) await restaurarAbaDaUrl();
})();

for (const lista of document.querySelectorAll(".sub-abas[role=tablist], .sub-tabs[role=tablist], .cadastro-tabs[role=tablist]")) {
  const botoes = [...lista.querySelectorAll('[role="tab"]')];
  for (const botao of botoes) botao.tabIndex = botao.getAttribute("aria-selected") === "true" ? 0 : -1;
  lista.addEventListener("click", (ev) => {
    const alvo = ev.target.closest('[role="tab"]');
    if (!alvo) return;
    for (const botao of botoes) botao.tabIndex = botao === alvo ? 0 : -1;
  });
  lista.addEventListener("keydown", (ev) => {
    const visiveis = botoes.filter((botao) => !botao.hidden);
    const indice = visiveis.indexOf(document.activeElement);
    let alvo;
    if (ev.key === "ArrowRight") alvo = visiveis[(indice + 1) % visiveis.length];
    if (ev.key === "ArrowLeft") alvo = visiveis[(indice - 1 + visiveis.length) % visiveis.length];
    if (ev.key === "Home") alvo = visiveis[0];
    if (ev.key === "End") alvo = visiveis.at(-1);
    if (alvo) { ev.preventDefault(); alvo.click(); alvo.focus(); }
  });
}

// Consentimento Calendar individual: nunca recebe ou transmite o token de outro usuário.
async function minhaAgendaGoogle(acao) {
  const status = document.getElementById('calendar-status');
  try {
    const token = cliente && cliente.token;
    if (!token) throw new Error('Conecte-se na aba Acesso.');
    const r = await fetch('/integracoes/calendar/' + acao, {method: acao === 'status' ? 'GET' : 'POST', headers: {Authorization: 'Bearer ' + token}});
    const dados = await r.json();
    if (!r.ok) throw new Error(dados.erro || 'Não foi possível atualizar a agenda.');
    if (dados.url) {
      if (new URL(dados.url).origin !== 'https://accounts.google.com') throw new Error('URL de autorização inválida.');
      window.open(dados.url, '_blank', 'noopener');
      status.textContent = 'Conclua o consentimento na aba Google e verifique a conexão ao retornar.';
    } else status.textContent = dados.conectado ? 'Sua agenda está conectada.' : 'Sua agenda está desconectada.';
  } catch (erro) { status.textContent = erro.message; }
}
document.getElementById('calendar-connect').addEventListener('click', () => minhaAgendaGoogle('conectar'));
document.getElementById('calendar-disconnect').addEventListener('click', () => minhaAgendaGoogle('desconectar'));
document.getElementById('calendar-refresh').addEventListener('click', () => minhaAgendaGoogle('status'));
