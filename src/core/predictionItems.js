/**
 * Edits an obs_data document's prediction_items one item at a time, as CUFLynx's obs_data editor does: each read as a
 * row (readPredictionItemRow) and written back (buildPredictionItem). A field the row leaves as it read it keeps the
 * item's own keys, so an item read and written back is the same, held-out data (value, std, data_type, obs_dt) and
 * keys the row doesn't know of included, but for its legacy keys, written as their replacements. Each edit gives a new
 * document, keeping everything it doesn't touch.
 */
import { isMapping } from './protocolShapes.js'
import { renamePlotGroup } from './predictionPlots.js'
import { LEGACY_KEYS, nameItemForPlotting, readOperation } from './predictionValidation.js'

// The keys of held-out data, which make an item validation data.
const DATA_KEYS = ['value', 'std', 'data_type', 'obs_dt']
// The fields whose keys circulatory_autogen requires of every prediction item, written whether or not they changed.
const REQUIRED_KEYS = { name: 'data_item_name', operands: 'operands', unit: 'unit' }

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
 * Whether a prediction item holds held-out data to validate against.
 *
 * @param {Object} item
 * @returns {boolean}
 */
export const isValidationData = (item) => DATA_KEYS.some((key) => item?.[key] != null)

/**
 * Reads a prediction item as a row for an editor, as CUFLynx's predToRow does: legacy keys read as their
 * replacements, and an item without operands records the variable it is named after.
 *
 * @param {Object} item - A prediction item, as obs_data has it.
 * @returns {{name: string, operands: string[], unit: string, traceName: string, itemName: string, experiment: number,
 *   subexperiment: number|null, operation: string, operationKwargs: Object, isValidationData: boolean,
 *   original: Object|null}} `subexperiment` is null for the experiment's last; `operation` '' for none; `traceName`
 *   and `itemName` '' for CA's defaults.
 */
export function readPredictionItemRow(item) {
  const entry = isMapping(item) ? item : {}
  const name = String(entry.data_item_name ?? entry.variable ?? '')
  const text = (value) => (typeof value === 'string' ? value : '')
  return {
    name,
    operands: Array.isArray(entry.operands) ? entry.operands.map(String) : entry.variable != null ? [String(entry.variable)] : [],
    unit: text(entry.unit),
    traceName: text(entry.trace_name_for_plotting ?? entry.name_for_plotting),
    itemName: text(entry.item_name_for_plotting),
    experiment: entry.experiment_idx ?? 0,
    subexperiment: entry.subexperiment_idx ?? null,
    operation: String(readOperation(entry.operation) ?? ''),
    operationKwargs: isMapping(entry.operation_kwargs) ? copy(entry.operation_kwargs) : {},
    isValidationData: isValidationData(entry),
    original: isMapping(item) ? item : null,
  }
}

/**
 * A row for a new prediction item, as CUFLynx's editor begins one: the trace of a variable yet to be picked.
 *
 * @param {Object} [options]
 * @param {number} [options.experiment]
 * @returns {Object} As readPredictionItemRow gives.
 */
export const createPredictionItem = ({ experiment = 0 } = {}) => ({
  name: '',
  operands: [],
  unit: 'dimensionless',
  traceName: '',
  itemName: '',
  experiment,
  subexperiment: null,
  operation: '',
  operationKwargs: {},
  isValidationData: false,
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

// How each field of a row is written to its item, in the order a new item has its keys.
const WRITERS = {
  name: (item, { name }) => {
    item.data_item_name = name
    delete item.variable
  },
  // An operand cleared is removed, not written as a nameless one.
  operands: (item, { operands }) => (item.operands = (operands ?? []).filter((operand) => operand)),
  unit: (item, { unit }) => (item.unit = unit ?? ''),
  operation: (item, { operation }) => setOrDelete(item, 'operation', operation),
  // An operation's keyword arguments mean nothing without it.
  operationKwargs: (item, { operation, operationKwargs }) => setOrDelete(item, 'operation_kwargs', operation ? operationKwargs : null, isEmptyMapping),
  experiment: (item, { experiment }) => setOrDelete(item, 'experiment_idx', experiment),
  subexperiment: (item, { subexperiment }) => setOrDelete(item, 'subexperiment_idx', subexperiment),
  itemName: (item, { itemName }) => setOrDelete(item, 'item_name_for_plotting', itemName),
  traceName: (item, { traceName }) => {
    setOrDelete(item, 'trace_name_for_plotting', traceName)
    delete item.name_for_plotting
  },
}
export const PREDICTION_ITEM_FIELDS = Object.keys(WRITERS)
// The fields whose writing depends on another's: an operation's kwargs are dropped with it.
const DEPENDS_ON = { operationKwargs: 'operation' }

/**
 * Renames an item's legacy keys to their replacements, in their place; one that has both keeps the replacement.
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
 * Writes a row as a prediction item. The item it was read from keeps what the row leaves as it read it, and every key
 * the row doesn't know of; the keys CA requires are always written. A new item is written whole.
 *
 * @param {Object} row - As readPredictionItemRow gives, changed.
 * @returns {Object}
 */
export function buildPredictionItem(row) {
  const original = isMapping(row.original) ? row.original : null
  const before = original ? readPredictionItemRow(original) : null
  const item = original ? migrateLegacyKeys(copy(original)) : {}
  const full = { ...createPredictionItem(), ...row }
  for (const [field, write] of Object.entries(WRITERS)) {
    const isUnchanged = before && isSame(before[field], full[field]) && (!DEPENDS_ON[field] || isSame(before[DEPENDS_ON[field]], full[DEPENDS_ON[field]]))
    const isRequired = Object.hasOwn(REQUIRED_KEYS, field) && !Object.hasOwn(item, REQUIRED_KEYS[field])
    if (isUnchanged && !isRequired) continue
    write(item, full)
  }
  return item
}

/**
 * Lists a document's prediction items, as it has them.
 *
 * @param {Object|Array|null} document
 * @returns {Array}
 */
const listItems = (document) => (isMapping(document) && Array.isArray(document.prediction_items) ? document.prediction_items : [])

/**
 * Lists a document's prediction items as rows, each with its place.
 *
 * @param {Object|Array|null} document
 * @returns {Array<Object>} As readPredictionItemRow gives, with `index`, its place in prediction_items.
 */
export const listPredictionItems = (document) => listItems(document).map((item, index) => ({ ...readPredictionItemRow(item), index }))

/**
 * Finds a name no data or prediction item has, as CA requires: the one given, else it with `_2`, `_3`...
 *
 * @param {Object|Array|null} document
 * @param {string} base
 * @param {number|null} [except] - A prediction item's place, whose own name doesn't count.
 * @returns {string}
 */
export function findFreeItemName(document, base, except = null) {
  const names = (items) => (Array.isArray(items) ? items : []).map((item) => (isMapping(item) ? (item.data_item_name ?? item.variable) : null))
  const dataItems = Array.isArray(document) ? document : isMapping(document) ? document.data_items : []
  const predictions = names(listItems(document)).filter((_, index) => index !== except)
  const taken = new Set([...names(dataItems), ...predictions].filter((name) => name != null).map(String))
  let name = base
  for (let suffix = 2; taken.has(name); suffix++) name = `${base}_${suffix}`
  return name
}

/**
 * Makes a document an object that can hold prediction items: a bare list of data items becomes its data_items.
 *
 * @param {Object|Array|null} document
 * @returns {Object} A copy.
 */
const ensureObject = (document) => (Array.isArray(document) ? { data_items: copy(document) } : copy(document ?? {}))

/**
 * Names a row left unnamed after its variable, apart from every other item, as CUFLynx's editor seeds it.
 *
 * @param {Object} document
 * @param {Object} row
 * @param {number|null} except - The row's own place.
 * @returns {Object} The row, named.
 */
function seedName(document, row, except) {
  const variable = (row.operands ?? []).find((operand) => operand)
  return row.name || !variable ? row : { ...row, name: findFreeItemName(document, variable, except) }
}

/**
 * Adds a prediction item after the others. One left unnamed is named after its variable, apart from the others.
 *
 * @param {Object|Array|null} document
 * @param {Object} row - As createPredictionItem gives, filled in.
 * @returns {Object}
 */
export function addPredictionItem(document, row) {
  const edited = ensureObject(document)
  edited.prediction_items = [...listItems(edited), buildPredictionItem({ ...seedName(edited, row, null), original: null })]
  return edited
}

/**
 * Changes a prediction item. One left unnamed is named after its variable, apart from the others. A renamed one is
 * renamed in the other prediction items' operation_kwargs that named it, when no other item had its name; prediction
 * plots follow a group it was the last of (its item_name_for_plotting, as CA defaults it).
 *
 * @param {Object} document
 * @param {number} index - Its place in prediction_items.
 * @param {Object} change - Any of a row's fields; the rest stay as they are.
 * @returns {Object} The document given, when there is no such item.
 */
export function updatePredictionItem(document, index, change) {
  const current = listItems(document)[index]
  if (!isMapping(current)) return document
  const edited = ensureObject(document)
  const row = seedName(edited, { ...readPredictionItemRow(current), ...change, original: current }, index)
  const before = readPredictionItemRow(current).name
  const group = nameItemForPlotting(current)
  const items = edited.prediction_items
  items[index] = buildPredictionItem(row)
  const isUnique = !items.some((item) => isMapping(item) && String(item.data_item_name ?? item.variable ?? '') === before)
  if (row.name !== before && before && isUnique) {
    for (const item of items) {
      if (!isMapping(item) || !isMapping(item.operation_kwargs)) continue
      for (const [key, value] of Object.entries(item.operation_kwargs)) if (value === before) item.operation_kwargs[key] = row.name
    }
  }
  const renamed = nameItemForPlotting(items[index])
  if (renamed !== group && !items.some((item) => isMapping(item) && nameItemForPlotting(item) === group)) renamePlotGroup(edited, group, renamed)
  return edited
}

/**
 * Removes a prediction item.
 *
 * @param {Object} document
 * @param {number} index - Its place in prediction_items.
 * @returns {Object} The document given, when there is no such item.
 */
export function removePredictionItem(document, index) {
  if (!(index >= 0 && index < listItems(document).length)) return document
  const edited = ensureObject(document)
  edited.prediction_items.splice(index, 1)
  return edited
}
