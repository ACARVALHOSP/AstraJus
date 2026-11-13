"""Contrato que um módulo usa para se declarar ao núcleo do AstraJus."""


def ferramenta(fn):
    """Marca uma função assíncrona do módulo como ferramenta MCP.

    O núcleo registra a função no servidor MCP só ao carregar o módulo e a protege: com o módulo
    desativado no gerenciador, a chamada devolve um erro claro em vez de executar."""
    fn._ferramenta_modulo = True
    return fn
