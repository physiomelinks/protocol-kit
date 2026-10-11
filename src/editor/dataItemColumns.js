/**
 * The columns of a data item's row in the obs_data editor, as CUFLynx's dialog has them (the row, then the details a
 * chevron opens), and the presets a host picks from: every column, editable, for a calibration tool, or the data as
 * measured, read-only, for one that only runs the protocol.
 */

// Each column, in the order the editor shows them: those of the row, then those of its details. `differentiable`
// tints an item whose operation CA can't differentiate, and says why.
export const DATA_ITEM_COLUMNS = [
  { key: 'name', label: 'name', place: 'row' },
  { key: 'value', label: 'value', place: 'row' },
  { key: 'std', label: 'std', place: 'row' },
  { key: 'operation', label: 'operation', place: 'row' },
  { key: 'experiment', label: 'exp', place: 'row' },
  { key: 'subexperiment', label: 'sub', place: 'row' },
  { key: 'operands', label: 'operands', place: 'detail' },
  { key: 'traceName', label: 'trace label', place: 'detail' },
  { key: 'unit', label: 'unit', place: 'detail' },
  { key: 'weight', label: 'weight', place: 'detail' },
  { key: 'cost', label: 'cost_type', place: 'detail' },
  { key: 'plot', label: 'plot_type', place: 'detail' },
  { key: 'operationKwargs', label: 'operation kwargs', place: 'detail' },
  { key: 'source', label: 'source', place: 'detail' },
  { key: 'comment', label: 'comment', place: 'detail' },
  { key: 'differentiable', label: 'differentiable', place: 'flag' },
]
const KEYS = DATA_ITEM_COLUMNS.map(({ key }) => key)
// What a calibration needs of an item, which a host that only runs the protocol leaves out.
const CALIBRATION_KEYS = ['weight', 'cost', 'differentiable']

// 'cuflynx' for a host that calibrates, every column editable; 'phlynx' for one that runs the protocol, the data as
// measured, read-only.
export const DATA_ITEM_COLUMN_PRESETS = {
  cuflynx: { columns: KEYS, readOnly: false },
  phlynx: { columns: KEYS.filter((key) => !CALIBRATION_KEYS.includes(key)), readOnly: true },
}

/**
 * Reads the columns a host asks for: a preset's name, or a list of keys.
 *
 * @param {string|string[]} columns
 * @returns {string[]} The keys known, in the editor's order; a preset unknown is 'cuflynx'.
 */
export function resolveDataItemColumns(columns) {
  const asked = Array.isArray(columns) ? columns : (DATA_ITEM_COLUMN_PRESETS[columns] ?? DATA_ITEM_COLUMN_PRESETS.cuflynx).columns
  return KEYS.filter((key) => asked.includes(key))
}

/**
 * Whether a preset shows the data items read-only.
 *
 * @param {string|string[]} columns - A preset's name, or a list of keys, which is editable.
 * @returns {boolean}
 */
export const isReadOnlyPreset = (columns) => !Array.isArray(columns) && !!DATA_ITEM_COLUMN_PRESETS[columns]?.readOnly
