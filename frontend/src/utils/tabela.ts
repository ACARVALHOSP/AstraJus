export function traduzirTabela(messageId: string, args?: { totalSelected?: number; totalCount?: number }): string {
  switch (messageId) {
    case 'carbon.table.batch.cancel':
      return 'Cancelar'
    case 'carbon.table.batch.items.selected':
      return `${args?.totalSelected ?? 0} selecionados`
    case 'carbon.table.batch.item.selected':
      return `${args?.totalSelected ?? 0} selecionado`
    case 'carbon.table.batch.selectAll':
      return `Selecionar todos (${args?.totalCount ?? 0})`
    default:
      return ''
  }
}
