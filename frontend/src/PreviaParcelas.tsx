import TabelaResponsiva from './TabelaResponsiva'
import { Text } from '@radix-ui/themes'
import { formatarDataSimples, formatarMoeda } from './utils/formatadores'

type Parcela = { numero: number; vencimento: string; valor: number }

export default function PreviaParcelas({ parcelas, quantidade, descricao }: {
  parcelas: Parcela[]
  quantidade: number
  descricao?: string
}) {
  return (
    <div className="previa-parcelas">
      <Text as="p" size="2" weight="bold">Prévia das parcelas</Text>
      {descricao && <Text as="p" size="2" color="gray">{descricao}</Text>}
      <TabelaResponsiva principais={['Parcela', 'Vencimento', 'Valor']}>
        <table className="previa-parcelas-tabela" aria-label="Prévia das parcelas">
          <thead>
            <tr>
              <th scope="col">Parcela</th>
              <th scope="col">Vencimento</th>
              <th scope="col"><span className="previa-parcelas-valor-cabecalho">Valor</span></th>
            </tr>
          </thead>
          <tbody>
            {parcelas.map((parcela) => (
              <tr key={parcela.numero}>
                <td>{parcela.numero}/{quantidade}</td>
                <td className="previa-parcelas-data">{formatarDataSimples(parcela.vencimento)}</td>
                <td className="previa-parcelas-valor">{formatarMoeda(parcela.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TabelaResponsiva>
    </div>
  )
}
