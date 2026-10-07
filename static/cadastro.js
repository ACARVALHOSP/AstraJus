// Feedback de envio da página de cadastro.
// Ao enviar, o botão é desabilitado para evitar envios repetidos e a barra de progresso aparece.
// Quando o servidor responde, a página é recarregada e o estado volta ao normal.
(function () {
  var form = document.querySelector('form[action="/cadastro"]');
  if (!form) return;
  var botao = form.querySelector('button[type="submit"]');
  if (!botao) return;
  var textoOriginal = botao.textContent;

  function mostrarEnvio() {
    form.classList.add("enviando");
    form.setAttribute("aria-busy", "true");
    botao.disabled = true;
    botao.textContent = "Enviando...";
  }

  function restaurar() {
    form.classList.remove("enviando");
    form.removeAttribute("aria-busy");
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }

  form.addEventListener("submit", function () {
    // o evento só dispara depois da validação do navegador, então campos inválidos não bloqueiam o botão
    mostrarEnvio();
  });

  // ao voltar pelo histórico, a página pode ser restaurada com o botão ainda desabilitado
  window.addEventListener("pageshow", function (evento) {
    if (evento.persisted) restaurar();
  });
})();
