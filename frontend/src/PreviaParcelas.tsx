import TabelaResponsiva from './TabelaResponsiva'
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@carbon/react'
import { formatarDataSimples, formatarMoeda } from './utils/formatadores'

type Parcela = { numero: number; vencimento: string; valor: number }

export default function PreviaParcelas({ parcelas, quantidade, descricao }: {
  parcelas: Parcela[]
  quantidade: number
  descricao?: string
}) {
  return (
    <div className="previa-parcelas">
      <TableContainer title="Prévia das parcelas" description={descricao}>
        <TabelaResponsiva principais={['Parcela', 'Vencimento', 'Valor']}><Table size="md" className="previa-parcelas-tabela" aria-label="Prévia das parcelas">
          <TableHead>
            <TableRow>
              <TableHeader scope="col">Parcela</TableHeader>
              <TableHeader scope="col">Vencimento</TableHeader>
              <TableHeader scope="col"><span className="previa-parcelas-valor-cabecalho">Valor</span></TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {parcelas.map((parcela) => (
              <TableRow key={parcela.numero}>
                <TableCell>{parcela.numero}/{quantidade}</TableCell>
                <TableCell className="previa-parcelas-data">{formatarDataSimples(parcela.vencimento)}</TableCell>
                <TableCell className="previa-parcelas-valor">{formatarMoeda(parcela.valor)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table></TabelaResponsiva>
      </TableContainer>
    </div>
  )
}
