// Feed individual; nenhum conteúdo é persistido no navegador.
"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const sino = $("btn-notificacoes-toggle"), popover = $("notificacoes-popover");
  const lista = $("notificacoes-lista"), status = $("notificacoes-status");
  const filtro = $("notificacoes-filtro"), mais = $("notificacoes-mais"), atualizar = $("notificacoes-atualizar");
  let geracao = 0, cursor = null, carregando = false;
  function badge(contagem = null) {
    const contador = $("notificacoes-contador");
    contador.hidden = contagem === null || contagem === 0;
    if (contagem !== null) contador.count = contagem;
    $("notificacoes-rotulo").textContent = contagem === null ? "Notificações: contagem indisponível" : `Notificações: ${contagem} não lidas`;
    sino.requestUpdate?.();
  }
  function expandido(aberto) {
    popover.open = aberto;
    _painelNotificacoes.hidden = !aberto;
    sino.setAttribute("aria-expanded", String(aberto));
    sino.isSelected = aberto;
    const nativo = sino.shadowRoot?.querySelector("button");
    nativo?.setAttribute("aria-expanded", String(aberto));
    nativo?.setAttribute("aria-controls", "header-notificacoes-painel");
  }
  function botao(texto, acao) {
    return el("button", { type: "button", class: "cds--btn cds--btn--ghost cds--btn--sm", texto, onclick: acao });
  }
  function erroFeed(erro) {
    badge(); lista.replaceChildren(); cursor = null; mais.hidden = true;
    status.replaceChildren(el("p", { texto: erro.status === 401 || erro.status === 403 ? "Conecte-se na aba Acesso para consultar suas notificações." : erro.message }));
    if (erro.status !== 401 && erro.status !== 403) status.append(botao("Tentar novamente", () => carregar()));
  }
  function renderizar(item) {
    const linha = el("li", { "data-notificacao-id": item.id });
    linha.append(el("h3", { texto: item.titulo }), el("p", { texto: item.mensagem }),
      el("p", { class: "campo-ajuda", texto: `${new Date(item.criado_em).toLocaleString("pt-BR")} · ${item.lida_em ? "Lida" : "Não lida"}` }));
    const acoes = el("div", { class: "notificacoes-acoes" });
    const executar = (acao) => async (ev) => {
      const dono = cliente, versao = geracao, controle = ev.currentTarget;
      controle.disabled = true;
      try { await acao(dono, versao); }
      catch (erro) {
        if (cliente === dono && versao === geracao) {
          if (!popover.open) mostrarToast("error", "Notificação indisponível", erro.message);
          erroFeed(erro);
        }
      } finally { if (linha.isConnected) controle.disabled = false; }
    };
    acoes.append(botao("Abrir", executar(async (dono, versao) => {
      const { destino } = await _buscarJson(`/notificacoes/${encodeURIComponent(item.id)}/destino`);
      if (cliente !== dono || versao !== geracao) return;
      if (!destino || !["atividade", "publicacoes_processo", "publicacoes_monitoradas"].includes(destino.tipo)) throw new Error("Destino indisponível. Atualize a lista.");
      expandido(false);
      if (destino.tipo === "publicacoes_monitoradas") {
        await selecionarAba(abas.find((a) => a.painel.id === "aba-publicacoes-oab"));
        return;
      }
      if (!(await selecionarAba(abas.find((a) => a.painel.id === "aba-casos")))) return;
      if (cliente !== dono || versao !== geracao || !(await abrirCaso(destino.caso_id))) return;
      if (cliente !== dono || versao !== geracao) return;
      if (destino.tipo === "publicacoes_processo") {
        _selecionarSubabaCaso("publicacoes");
        await _carregarPublicacoesCaso(destino.caso_id);
        $("caso-subaba-publicacoes-botao").focus();
      } else {
        _selecionarSubabaCaso("atividades");
        const { atividades } = await _buscarJson(`/casos/${encodeURIComponent(destino.caso_id)}/atividades`);
        if (cliente !== dono || versao !== geracao) return;
        const atividade = atividades.find((a) => a.id === destino.atividade_id);
        if (!atividade) throw new Error("Atividade indisponível. Atualize a lista.");
        await _abrirModalAtividade(destino.caso_id, atividade);
      }
    })));
    if (!item.lida_em) acoes.append(botao("Marcar como lida", executar(async (dono, versao) => {
      await _enviarJson(`/notificacoes/${encodeURIComponent(item.id)}`, { lida: true }, "PATCH");
      if (cliente !== dono || versao !== geracao) return;
      await carregar();
      if (popover.open) atualizar.focus();
    })));
    linha.append(acoes);
    return linha;
  }
  async function carregar(anexar = false) {
    if (anexar && (carregando || !cursor)) return;
    const dono = cliente, versao = ++geracao;
    const proximo = anexar ? cursor : null;
    carregando = true; atualizar.disabled = true; mais.disabled = true;
    lista.setAttribute("aria-busy", "true");
    if (!anexar) { lista.replaceChildren(); cursor = null; mais.hidden = true; badge(); }
    status.textContent = "Carregando notificações…";
    try {
      const query = new URLSearchParams({ limite: "20", estado: filtro.checked ? "nao_lidas" : "todas" });
      if (proximo) query.set("cursor", proximo);
      const dados = await _buscarJson(`/notificacoes?${query}`);
      if (versao !== geracao || dono !== cliente) return;
      if (!Array.isArray(dados.notificacoes) || !Number.isInteger(dados.nao_lidas) || dados.nao_lidas < 0) throw new Error("Resposta de notificações inválida. Tente novamente.");
      if (!anexar) lista.replaceChildren();
      const ids = new Set([...lista.children].map((n) => n.dataset.notificacaoId));
      for (const item of dados.notificacoes) if (!ids.has(item.id)) { lista.append(renderizar(item)); ids.add(item.id); }
      badge(dados.nao_lidas); cursor = dados.proximo_cursor || null; mais.hidden = !cursor;
      status.textContent = lista.children.length ? "" : filtro.checked ? "Nenhuma notificação não lida nos últimos 180 dias." : "Nenhuma notificação disponível nos últimos 180 dias.";
    } catch (erro) { if (versao === geracao && dono === cliente) erroFeed(erro); }
    finally {
      if (versao === geracao && dono === cliente) {
        carregando = false; atualizar.disabled = false; mais.disabled = false; lista.removeAttribute("aria-busy");
      }
    }
  }
  sino.addEventListener("click", () => {
    if (popover.open) { expandido(false); return; }
    _fecharPainelBusca(); expandido(true); carregar();
  });
  popover.addEventListener("cds-popover-closed", () => expandido(false));
  atualizar.addEventListener("click", () => carregar());
  filtro.addEventListener("change", () => carregar());
  mais.addEventListener("click", () => carregar(true));
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && popover.open) {
      ev.preventDefault(); expandido(false); sino.shadowRoot?.querySelector("button")?.focus();
    }
  }, { capture: true });
  window.addEventListener("cnj-acesso-alterado", () => {
    ++geracao; cursor = null; carregando = false; lista.replaceChildren(); status.textContent = ""; badge();
    mais.hidden = true; atualizar.disabled = false; lista.removeAttribute("aria-busy"); expandido(false);
    if (cliente) carregar();
  });
  Promise.all(["cds-icon-button", "cds-badge-indicator", "cds-popover", "cds-popover-content"].map((nome) => customElements.whenDefined(nome))).then(() => {
    badge(); expandido(false);
    if (cliente) carregar();
  });
})();
