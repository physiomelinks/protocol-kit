/**
 * The columns of a prediction item's row in the obs_data editor, as CUFLynx's dialog has them (the row, then the
 * details a chevron opens), and the presets a host picks from. Both apps edit every one.
 */

// Each column, in the order the editor shows them: those of the row, then those of its details.
export const PREDICTION_ITEM_COLUMNS = [
  { key: 'variable', label: 'variable', place: 'row' },
  { key: 'unit', label: 'unit', place: 'row' },
  { key: 'traceName', label: 'trace label', place: 'row' },
  { key: 'experiment', label: 'exp', place: 'row' },
  { key: 'subexperiment', label: 'sub', place: 'row' },
  { key: 'operation', label: 'operation', place: 'row' },
  { key: 'name', label: 'name', place: 'detail' },
  { key: 'itemName', label: 'item label', place: 'detail' },
  { key: 'operationKwargs', label: 'operation kwargs', place: 'detail' },
]
const KEYS = PREDICTION_ITEM_COLUMNS.map(({ key }) => key)

export const PREDICTION_ITEM_COLUMN_PRESETS = {
  cuflynx: { columns: KEYS, readOnly: false },
  phlynx: { columns: KEYS, readOnly: false },
}

/**
 * Reads the columns a host asks for: a preset's name, or a list of keys.
 *
 * @param {string|string[]} columns
 * @returns {string[]} The keys known, in the editor's order; a preset unknown is 'cuflynx'.
 */
export function resolvePredictionItemColumns(columns) {
  const asked = Array.isArray(columns) ? columns : (PREDICTION_ITEM_COLUMN_PRESETS[columns] ?? PREDICTION_ITEM_COLUMN_PRESETS.cuflynx).columns
  return KEYS.filter((key) => asked.includes(key))
}
