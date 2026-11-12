import { Component, type ReactNode } from 'react'
import { Button, Callout, Flex, Text } from '@radix-ui/themes'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { ehFalhaDeCarregamento } from './utils/falhas'

type Props = { children: ReactNode }
type Estado = { erro: Error | null }

/** Limite de erro de uma tela: um defeito em um componente não derruba o resto do aplicativo.
 *  Distingue duas situações:
 *  - arquivo da tela não baixou (versão nova publicada): só recarregar a página resolve;
 *  - erro ao montar/desenhar a tela: "Tentar novamente" refaz a tela sem perder a sessão. */
export default class LimiteDeErro extends Component<Props, Estado> {
  state: Estado = { erro: null }

  static getDerivedStateFromError(erro: unknown): Estado {
    return { erro: erro instanceof Error ? erro : new Error(String(erro)) }
  }

  componentDidCatch(erro: Error, info: { componentStack?: string | null }) {
    console.error('Erro na tela:', erro, info.componentStack)
  }

  private tentarNovamente = () => this.setState({ erro: null })

  render() {
    const { erro } = this.state
    if (!erro) return this.props.children

    if (ehFalhaDeCarregamento(erro)) {
      return (
        <Callout.Root color="red" role="alert">
          <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
          <Callout.Text>
            <Flex direction="column" gap="2" align="start">
              <span>Não foi possível carregar esta tela. O sistema pode ter sido atualizado.</span>
              <Button size="1" onClick={() => window.location.reload()}><RefreshCw size={13} aria-hidden="true" />Recarregar a página</Button>
            </Flex>
          </Callout.Text>
        </Callout.Root>
      )
    }
    return (
      <Callout.Root color="red" role="alert">
        <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
        <Callout.Text>
          <Flex direction="column" gap="2" align="start">
            <strong>Esta tela encontrou um erro inesperado.</strong>
            <span>O restante do sistema continua funcionando. Nada que você já salvou foi perdido.</span>
            <Flex gap="2" wrap="wrap">
              <Button size="1" onClick={this.tentarNovamente}><RefreshCw size={13} aria-hidden="true" />Tentar novamente</Button>
              <Button size="1" variant="soft" color="gray" onClick={() => { window.location.hash = '/inicio'; this.tentarNovamente() }}>Ir para o início</Button>
            </Flex>
            {erro.message && <Text size="1" color="gray">Detalhe técnico: {erro.message.slice(0, 200)}</Text>}
          </Flex>
        </Callout.Text>
      </Callout.Root>
    )
  }
}
