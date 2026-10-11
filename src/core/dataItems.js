/**
 * Edits the measured data an obs_data document calibrates against: its data_items. Each is read as a row an editor's
 * form holds (readDataItem) and written back (buildDataItem), as CUFLynx's obs_data editor did (rowToItem, itemToRow):
 * a field the form leaves as it read it keeps the item's own keys, its spelling and the keys the form doesn't know of,
 * so an item read and written back is the same but for its legacy keys, which are written as their replacements. Each
 * edit gives a new document, keeping everything it doesn't touch; the protocol_info is never changed.
 */
import { DATA_ITEM_VOCABULARY } from './dataItemVocabulary.js'
import { isMapping } from './protocolShapes.js'
import { LEGACY_KEYS, readOperation } from './predictionValidation.js'

// How a file may spell "no marker", as CA reads a plot_type.
const NO_PLOT_SPELLINGS = ['None', 'none', 'NONE', 'null', 'Null']
// The keys circulatory_autogen requires of every data item, written whether or not they changed. A unit an item lacks
// stays missing until one is given, so CA's error for it stays, rather than a unit of '' it accepts.
const REQUIRED_FIELDS = ['name', 'dataType', 'operands']
// The indices CA reads as integers: pandas makes a column of them floats, which CA refuses, unless every item has one.
const INDEX_KEYS = ['experiment_idx', 'subexperiment_idx']

/**
 * Copies JSON, so edits never reach the one given.
 *
 * @param {*} value
 * @returns {*}
 */
const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

/**
 * Whether two JSON values are the same.
 *
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
const isSame = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Reads a data item as a row for an editor's form. Legacy keys (`variable`, `name_for_plotting`) are read as their
 * replacements; a field the item doesn't set is CA's default, or empty where CA's default depends on the others.
 *
 * @param {Object} item - A data item, as obs_data has it.
 * @returns {{name: string, dataType: string, operands: string[], unit: string, operation: string, operationKwargs:
 *   Object, value: number|number[]|null, std: number|number[]|null, obsDt: number|null, probDistParams: Object|null,
 *   weight: number|null, experiment: number, subexperiment: number, costType: string, costKwargs: Object, plotType:
 *   string|null, plotColor: string, traceName: string, itemName: string, source: string, comment: string,
 *   isValueEditable: boolean, original: Object}} `operation` and `costType` are '' for none (CA's default cost);
 *   `plotType` is null for none set (CA's default for the data type) and '' for no marker; `traceName` and `itemName`
 *   are '' for CA's defaults; `source` is '' for a dict of files, which it keeps. `isValueEditable` is false for a
 *   frequency, or a series read from files.
 */
export function readDataItem(item) {
  const entry = isMapping(item) ? item : {}
  const dataType = entry.data_type === 'timeseries' ? 'series' : typeof entry.data_type === 'string' ? entry.data_type : 'constant'
  const plotType = entry.plot_type == null ? null : NO_PLOT_SPELLINGS.includes(entry.plot_type) ? '' : entry.plot_type === 'timeseries' ? 'series' : String(entry.plot_type)
  const isFromFiles = dataType === 'series' && entry.value == null && !!(entry.value_path || entry.vm_path || entry.im_path || isMapping(entry.source))
  const text = (value) => (typeof value === 'string' ? value : '')
  return {
    name: String(entry.data_item_name ?? entry.variable ?? ''),
    dataType,
    operands: Array.isArray(entry.operands) ? entry.operands.map(String) : [],
    unit: text(entry.unit),
    operation: String(readOperation(entry.operation) ?? ''),
    operationKwargs: isMapping(entry.operation_kwargs) ? copy(entry.operation_kwargs) : {},
    value: copy(entry.value) ?? null,
    std: copy(entry.std) ?? null,
    obsDt: entry.obs_dt ?? null,
    probDistParams: isMapping(entry.prob_dist_params) ? copy(entry.prob_dist_params) : null,
    weight: entry.weight ?? 1,
    experiment: entry.experiment_idx ?? 0,
    subexperiment: entry.subexperiment_idx ?? 0,
    costType: text(entry.cost_type),
    costKwargs: isMapping(entry.cost_kwargs) ? copy(entry.cost_kwargs) : {},
    plotType,
    plotColor: text(entry.plot_color),
    traceName: text(entry.trace_name_for_plotting ?? entry.name_for_plotting),
    itemName: text(entry.item_name_for_plotting),
    source: text(entry.source),
    comment: text(entry.comment),
    isValueEditable: dataType !== 'frequency' && !isFromFiles,
    original: isMapping(item) ? item : null,
  }
}

/**
 * A row for a new data item: a constant, the maximum of its variable, as CUFLynx's editor began one.
 *
 * @param {Object} [options]
 * @param {number} [options.experiment]
 * @param {number} [options.subexperiment]
 * @returns {Object} As readDataItem gives.
 */
export const createDataItem = ({ experiment = 0, subexperiment = 0 } = {}) => ({
  name: '',
  dataType: 'constant',
  operands: [],
  unit: 'dimensionless',
  operation: 'max',
  operationKwargs: {},
  value: 0,
  std: 1,
  obsDt: null,
  probDistParams: null,
  weight: 1,
  experiment,
  subexperiment,
  costType: '',
  costKwargs: {},
  plotType: 'horizontal',
  plotColor: '',
  traceName: '',
  itemName: '',
  source: '',
  comment: '',
  isValueEditable: true,
  original: null,
})

/**
 * Sets a key, or removes it for a value that is no value.
 *
 * @param {Object} item
 * @param {string} key
 * @param {*} value
 * @param {Function} [isNone]
 */
function setOrDelete(item, key, value, isNone = (entry) => entry == null || entry === '') {
  if (isNone(value)) delete item[key]
  else item[key] = copy(value)
}

const isEmptyMapping = (value) => !isMapping(value) || !Object.keys(value).length

// How each field of a row is written to its item.
const WRITERS = {
  name: (item, { name }) => {
    item.data_item_name = name
    delete item.variable
  },
  dataType: (item, { dataType }) => (item.data_type = dataType || 'constant'),
  // An operand cleared in the form is removed, not written as a nameless one.
  operands: (item, { operands }) => (item.operands = (operands ?? []).filter((operand) => operand)),
  unit: (item, { unit }) => (item.unit = unit ?? ''),
  operation: (item, { operation }) => setOrDelete(item, 'operation', operation),
  // An operation's keyword arguments mean nothing without it.
  operationKwargs: (item, { operation, operationKwargs }) => setOrDelete(item, 'operation_kwargs', operation ? operationKwargs : null, isEmptyMapping),
  value: (item, { value }) => setOrDelete(item, 'value', value),
  std: (item, { std }) => setOrDelete(item, 'std', std),
  obsDt: (item, { obsDt }) => setOrDelete(item, 'obs_dt', obsDt),
  probDistParams: (item, { probDistParams }) => setOrDelete(item, 'prob_dist_params', probDistParams, (value) => !isMapping(value)),
  weight: (item, { weight }) => setOrDelete(item, 'weight', weight),
  experiment: (item, { experiment }) => setOrDelete(item, 'experiment_idx', experiment),
  subexperiment: (item, { subexperiment }) => setOrDelete(item, 'subexperiment_idx', subexperiment),
  costType: (item, { costType }) => setOrDelete(item, 'cost_type', costType),
  // Kept with no cost_type, as CA gives them to its default cost func.
  costKwargs: (item, { costKwargs }) => setOrDelete(item, 'cost_kwargs', costKwargs, isEmptyMapping),
  plotType: (item, { plotType }) => setOrDelete(item, 'plot_type', plotType === '' ? 'None' : plotType),
  plotColor: (item, { plotColor }) => setOrDelete(item, 'plot_color', plotColor),
  traceName: (item, { traceName }) => {
    setOrDelete(item, 'trace_name_for_plotting', traceName)
    delete item.name_for_plotting
  },
  itemName: (item, { itemName }) => setOrDelete(item, 'item_name_for_plotting', itemName),
  // A dict of files is kept when the text is cleared.
  source: (item, { source }) => (source ? (item.source = source) : typeof item.source === 'string' && delete item.source),
  comment: (item, { comment }) => setOrDelete(item, 'comment', comment),
}
export const DATA_ITEM_FIELDS = Object.keys(WRITERS)
// The fields whose writing depends on another's: an operation's kwargs are dropped with it.
const DEPENDS_ON = { operationKwargs: 'operation' }

/**
 * Renames an item's legacy keys (`variable`, `name_for_plotting`) to their replacements, in their place, as CA rejects
 * an item with both spellings; one that has both keeps the replacement, which readDataItem reads.
 *
 * @param {Object} item
 * @returns {Object} A copy.
 */
function migrateLegacyKeys(item) {
  return Object.fromEntries(
    Object.entries(item).flatMap(([key, value]) => {
      if (!Object.hasOwn(LEGACY_KEYS, key)) return [[key, value]]
      return Object.hasOwn(item, LEGACY_KEYS[key]) ? [] : [[LEGACY_KEYS[key], value]]
    })
  )
}

/**
 * Writes a row as a data item. The item it was read from keeps what the row leaves as it read it, and every key the
 * row doesn't know of, its legacy keys renamed; the keys CA requires are always written. A new item is written whole.
 *
 * @param {Object} row - As readDataItem gives, changed.
 * @returns {Object}
 */
export function buildDataItem(row) {
  const original = isMapping(row.original) ? row.original : null
  const before = original ? readDataItem(original) : null
  const item = original ? migrateLegacyKeys(copy(original)) : {}
  const keyOf = { name: 'data_item_name', dataType: 'data_type', operands: 'operands' }
  for (const [field, write] of Object.entries(WRITERS)) {
    const isUnchanged = before && isSame(before[field], row[field]) && (!DEPENDS_ON[field] || isSame(before[DEPENDS_ON[field]], row[DEPENDS_ON[field]]))
    const isRequired = REQUIRED_FIELDS.includes(field) && !Object.hasOwn(item, keyOf[field])
    if (isUnchanged && !isRequired) continue
    write(item, { ...readDataItem(null), ...row })
  }
  return item
}

/**
 * Lists a document's data items: its data_items (or the legacy data_item), or the bare list it is.
 *
 * @param {Object|Array|null} document
 * @returns {Array}
 */
const listItems = (document) => (Array.isArray(document) ? document : isMapping(document) ? (document.data_items ?? document.data_item ?? []) : [])

/**
 * Lists a document's data items as rows, each with its place.
 *
 * @param {Object|Array|null} document
 * @returns {Array<Object>} As readDataItem gives, with `index`, its place in data_items.
 */
export const listDataItems = (document) => (Array.isArray(listItems(document)) ? listItems(document) : []).map((item, index) => ({ ...readDataItem(item), index }))

/**
 * Whether a row holds a data item, as CUFLynx's editor lists them: a constant of one value, with no operation or one the
 * vocabulary has. A series, a frequency, a distribution, or an operation of the user's own is kept as it is.
 *
 * @param {Object} row - From listDataItems.
 * @param {Object} [vocabulary] - As DATA_ITEM_VOCABULARY.
 * @returns {boolean}
 */
export const isRowDataItem = (row, vocabulary = DATA_ITEM_VOCABULARY) =>
  row.dataType === 'constant' &&
  (!row.operation || vocabulary.operations.some(({ name }) => name === row.operation)) &&
  !Array.isArray(row.value) &&
  !Array.isArray(row.std) &&
  !row.probDistParams

/**
 * Gives every data item an experiment_idx and subexperiment_idx when any has one: CA reads a column some items lack
 * as floats, and refuses it.
 *
 * @param {Array} items - Changed in place.
 */
function fillIndices(items) {
  for (const key of INDEX_KEYS) {
    if (!items.some((item) => isMapping(item) && item[key] != null)) continue
    for (const item of items) if (isMapping(item) && item[key] == null) item[key] = 0
  }
}

/**
 * Applies an edit to a copy of a document's data items, then fills in their indices (fillIndices).
 *
 * @param {Object|Array|null} document
 * @param {Function} edit - Called with the copy of the items, to change in place.
 * @returns {Object|Array} A bare list stays one; an object keeps the key it had them under.
 */
function editItems(document, edit) {
  if (Array.isArray(document)) {
    const items = copy(document)
    edit(items)
    fillIndices(items)
    return items
  }
  const edited = isMapping(document) ? { ...document } : {}
  const key = !Object.hasOwn(edited, 'data_items') && Array.isArray(edited.data_item) ? 'data_item' : 'data_items'
  const items = Array.isArray(edited[key]) ? copy(edited[key]) : []
  edit(items)
  fillIndices(items)
  edited[key] = items
  return edited
}

/**
 * Adds a data item after the others.
 *
 * @param {Object|Array|null} document
 * @param {Object} row - As createDataItem gives, filled in.
 * @returns {Object|Array}
 */
export const addDataItem = (document, row) => editItems(document, (items) => items.push(buildDataItem({ ...row, original: null })))

/**
 * Changes a data item. A renamed one is renamed in the other data items' operation_kwargs that named it, when no other
 * item had its name. (A prediction item can name only prediction items.)
 *
 * @param {Object|Array} document
 * @param {number} index - Its place in data_items.
 * @param {Object} change - Any of a row's fields; the rest stay as they are.
 * @returns {Object|Array} The document given, when there is no such item.
 */
export function updateDataItem(document, index, change) {
  const current = listItems(document)?.[index]
  if (!isMapping(current)) return document
  const row = { ...readDataItem(current), ...change, original: current }
  const before = readDataItem(current).name
  return editItems(document, (items) => {
    items[index] = buildDataItem(row)
    const isUnique = !items.some((item) => isMapping(item) && String(item.data_item_name ?? item.variable ?? '') === before)
    if (row.name === before || !before || !isUnique) return
    for (const item of items) {
      if (!isMapping(item) || !isMapping(item.operation_kwargs)) continue
      for (const [key, value] of Object.entries(item.operation_kwargs)) if (value === before) item.operation_kwargs[key] = row.name
    }
  })
}

/**
 * Removes a data item.
 *
 * @param {Object|Array} document
 * @param {number} index - Its place in data_items.
 * @returns {Object|Array} The document given, when there is no such item.
 */
export function removeDataItem(document, index) {
  const items = listItems(document)
  if (!Array.isArray(items) || index < 0 || index >= items.length) return document
  return editItems(document, (edited) => edited.splice(index, 1))
}
