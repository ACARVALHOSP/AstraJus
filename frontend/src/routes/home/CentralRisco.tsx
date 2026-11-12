import { Badge, Button, Flex, Heading, Text } from '@radix-ui/themes'
import { CheckCircle2 } from 'lucide-react'
import type { Destino, Nivel, Risco } from './risco'

const ROTULO: Record<Nivel, { texto: string; cor: 'red' | 'amber' | 'gray' }> = {
  critico: { texto: 'Crítico', cor: 'red' },
  atencao: { texto: 'Atenção', cor: 'amber' },
  info: { texto: 'Informativo', cor: 'gray' },
}

type Props = {
  riscos: Risco[]
  /** Alguma fonte falhou ou não pôde ser consultada: não afirmamos que está tudo em ordem. */
  incompleto: boolean
  onIr: (destino: Destino) => void
}

/** Lista única do que exige atenção, do mais grave ao menos grave. */
export default function CentralRisco({ riscos, incompleto, onIr }: Props) {
  return (
    <section aria-labelledby="esc-risco" className="risco">
      <Heading as="h2" size="3" id="esc-risco" mb="2">Central de risco</Heading>
      {riscos.length === 0 ? (
        incompleto ? (
          <Text as="p" size="2" color="gray" role="status">Não foi possível verificar tudo agora. Use Atualizar para tentar de novo.</Text>
        ) : (
          <div className="home-atencao home-atencao--ok" role="status">
            <CheckCircle2 size={18} aria-hidden="true" />
            <span><strong>Nada exige atenção agora.</strong> Prazos, audiências, publicações, tarefas e rotinas automáticas estão em ordem.</span>
          </div>
        )
      ) : (
        <ul className="risco-lista">
          {riscos.map(r => (
            <li key={r.id} className={`risco-item risco-item--${r.nivel}`}>
              <Badge color={ROTULO[r.nivel].cor} variant="soft" className="risco-nivel">{ROTULO[r.nivel].texto}</Badge>
              <div className="risco-texto">
                <Text as="p" size="2" weight="medium">{r.titulo}</Text>
                <Text as="p" size="2" color="gray">{r.detalhe}</Text>
              </div>
              <Flex align="center"><Button size="1" variant="soft" color={r.nivel === 'critico' ? 'red' : 'gray'} onClick={() => onIr(r.destino)}>{r.acao}</Button></Flex>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
