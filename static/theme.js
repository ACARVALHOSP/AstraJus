// Carregado no head, antes do conteúdo, para restaurar a preferência sem flash.
(() => {
  'use strict';
  const chave = 'cnj_tema';
  const raiz = document.documentElement;
  const validar = valor => valor === 'g100' ? 'g100' : 'white';
  let tema = 'white';
  let armazenamentoDisponivel = true;
  try { tema = validar(localStorage.getItem(chave)); } catch { armazenamentoDisponivel = false; }

  function sincronizar() {
    document.querySelectorAll('[data-theme-toggle]').forEach(toggle => { toggle.toggled = tema === 'g100'; });
  }
  function aplicar(valor, guardar = false) {
    tema = validar(valor);
    raiz.classList.remove('cds--white', 'cds--g100');
    raiz.classList.add(`cds--${tema}`);
    raiz.dataset.carbonTheme = tema;
    raiz.dataset.theme = tema === 'g100' ? 'dark' : 'light';
    raiz.style.colorScheme = tema === 'g100' ? 'dark' : 'light';
    if (guardar) {
      try { localStorage.setItem(chave, tema); armazenamentoDisponivel = true; }
      catch { armazenamentoDisponivel = false; }
    }
    sincronizar();
    const aviso = document.getElementById('theme-status');
    if (aviso) aviso.textContent = guardar && !armazenamentoDisponivel
      ? 'Tema aplicado. Não foi possível lembrar a preferência neste navegador.' : '';
    return tema;
  }
  aplicar(tema);
  window.AstraJusTema = { obter: () => tema, aplicar: valor => aplicar(valor, true) };
  window.addEventListener('storage', evento => {
    if (evento.key === chave || evento.key === null) aplicar(evento.newValue);
  });

  document.addEventListener('DOMContentLoaded', () => {
    // Compatibilidade com páginas antigas que fixavam um tema no body.
    document.body.classList.remove('cds--white', 'cds--g10', 'cds--g100');
    let controle = document.querySelector('[data-theme-control]');
    if (!controle) {
      controle = document.createElement('div');
      controle.className = 'theme-control theme-control--public';
      controle.dataset.themeControl = '';
      const destino = document.querySelector('.admin-cabecalho, main > header')
        || document.querySelector('.cartao') || document.body;
      destino.prepend(controle);
    }
    const toggle = document.createElement('cds-toggle');
    toggle.id = 'tema-interface';
    toggle.dataset.themeToggle = '';
    toggle.setAttribute('size', 'sm');
    toggle.setAttribute('label-text', 'Tema');
    toggle.setAttribute('label-a', 'Escuro');
    toggle.setAttribute('label-b', 'Claro');
    controle.appendChild(toggle);
    const aviso = document.createElement('p');
    aviso.id = 'theme-status';
    aviso.className = 'theme-status';
    aviso.setAttribute('role', 'status');
    controle.appendChild(aviso);
    customElements.whenDefined('cds-toggle').then(() => {
      sincronizar();
      toggle.addEventListener('cds-toggle-changed', evento => aplicar(evento.detail.toggled ? 'g100' : 'white', true));
    });
  });
})();
