"""Serviços do núcleo que os módulos podem usar (cliente HTTP, erros, JSON, log...).

Os módulos importam `nucleo` daqui em vez de importar `server` (que pode estar rodando como
`__main__` e geraria uma segunda cópia). O servidor liga o proxy ao próprio módulo na partida;
cada atributo é resolvido na hora do uso, então testes que trocam uma função do servidor
continuam valendo."""


class _Nucleo:
    _alvo = None

    def vincular(self, alvo) -> None:
        self._alvo = alvo

    def __getattr__(self, nome):
        if self._alvo is None:
            raise RuntimeError("O núcleo ainda não foi vinculado aos módulos.")
        return getattr(self._alvo, nome)


nucleo = _Nucleo()
