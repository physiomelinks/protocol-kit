/**
 * Checks an obs_data document's prediction_items as circulatory_autogen #536 does on reading it (PrimitiveParsers.py),
 * in the same order and with the same messages, then the ranges of the operations it takes.
 */
import { formatPythonList, formatPythonRepr, formatPythonStr, getPythonTypeName } from './pythonFormat.js'
import { isMapping } from './protocolShapes.js'

const LIST = "(<class 'list'>, <class 'tuple'>, <class 'numpy.ndarray'>)"
const STRING = "(<class 'str'>,)"
const INTEGER = "(<class 'int'>, <class 'numpy.integer'>)"
const NUMBER = "(<class 'int'>, <class 'float'>, <class 'numpy.integer'>, <class 'numpy.floating'>"
const isString = (value) => typeof value === 'string'
// Python's bool is an int.
const isInteger = (value) => typeof value === 'boolean' || Number.isInteger(value)
const isNumber = (value) => typeof value === 'boolean' || typeof value === 'number'
// CA's prediction item schema: each key's allowed types, as CA prints them, and its default, if any. In CA's order.
const SCHEMA = {
  data_item_name: { types: STRING, isAllowed: isString, isRequired: true },
  operands: { types: LIST, isAllowed: Array.isArray, isRequired: true },
  unit: { types: STRING, isAllowed: isString, isRequired: true },
  trace_name_for_plotting: { types: STRING, isAllowed: isString, fallback: (entry) => formatPythonStr(entry.operands?.length ? entry.operands[0] : '') || formatPythonStr(entry.data_item_name ?? '') },
  item_name_for_plotting: { types: STRING, isAllowed: isString, fallback: (entry) => formatPythonStr(entry.trace_name_for_plotting ?? '') },
  experiment_idx: { types: INTEGER, isAllowed: isInteger, fallback: () => 0 },
  data_type: { types: STRING, isAllowed: isString, isOptional: true },
  value: { types: `${NUMBER}, ${LIST.slice(1)}`, isAllowed: (value) => isNumber(value) || Array.isArray(value), isOptional: true },
  std: { types: `${NUMBER}, ${LIST.slice(1)}`, isAllowed: (value) => isNumber(value) || Array.isArray(value), isOptional: true },
  obs_dt: { types: `${NUMBER})`, isAllowed: isNumber, isOptional: true },
  operation: { types: STRING, isAllowed: isString, isOptional: true },
  operation_kwargs: { types: "(<class 'dict'>,)", isAllowed: isMapping, isOptional: true },
  subexperiment_idx: { types: INTEGER, isAllowed: isInteger, isOptional: true },
}
export const PREDICTION_ITEM_KEYS = Object.keys(SCHEMA)
// Keys superseded by circulatory_autogen #466, and the key that now carries each.
export const LEGACY_KEYS = { variable: 'data_item_name', name_for_plotting: 'trace_name_for_plotting' }
export const LEGACY_ADVICE = {
  variable:
    "'variable' is deprecated: use 'data_item_name' for the item's identity -- it must be unique, and it is what an " +
    "operation_kwargs reference to another item resolves against -- and 'operands' for the model variable the item " +
    "reduces. The old fallback, where a null 'operation' took its operand from 'variable', has been removed.",
  name_for_plotting:
    "'name_for_plotting' is deprecated: it named two different things. Use 'trace_name_for_plotting' for the axis " +
    "label of the trace, and 'item_name_for_plotting' for the item's own label (in sensitivity tables and the like), " +
    "which defaults to '<trace_name_for_plotting> (<operation>)'.",
}
// How an obs_data file may spell "no operation".
export const NO_OPERATION_SPELLINGS = ['', 'None', 'none', 'Null', 'null', 'nan']
// What needs circulatory_autogen #536: released libcuflynx (0.7.3) and CUFLynx refuse these keys.
const NEEDS_536 = ['operation', 'operation_kwargs', 'subexperiment_idx']

/**
 * Names a value's class as Python prints `type(value)`.
 *
 * @param {*} value
 * @returns {string}
 */
const formatPythonClass = (value) => `<class '${getPythonTypeName(value)}'>`

/**
 * Reads an item's operation as CA does: none for any of its spellings of none.
 *
 * @param {*} operation
 * @returns {*} The operation, or null.
 */
export const readOperation = (operation) => (operation == null || NO_OPERATION_SPELLINGS.includes(String(operation).trim()) ? null : operation)

/**
 * Brings an item's legacy keys up to date, as CA's migrate_legacy_obs_item_keys does for prediction_items: a
 * `variable` names the item, and an item without operands records the variable it is named after.
 *
 * @param {Object} entry
 * @param {number} index
 * @returns {Object} A copy.
 * @throws {Error} When it sets a legacy key and its replacement both.
 */
function migrateLegacyKeys(entry, index) {
  const migrated = { ...entry }
  for (const [old, current] of Object.entries(LEGACY_KEYS)) {
    if (!Object.hasOwn(migrated, old)) continue
    if (Object.hasOwn(migrated, current)) {
      throw new Error(`prediction_items[${index}] sets both '${old}' and its replacement '${current}'. Remove '${old}'. ${LEGACY_ADVICE[old]}`)
    }
    migrated[current] = migrated[old]
    delete migrated[old]
  }
  const hasOperands = Array.isArray(migrated.operands) ? migrated.operands.length > 0 : !!migrated.operands
  if (Object.hasOwn(migrated, 'data_item_name') && !hasOperands) migrated.operands = [migrated.data_item_name]
  return migrated
}

/**
 * Names the group an item is plotted in, as CA defaults its item_name_for_plotting: legacy keys migrated, its
 * item_name_for_plotting, else its trace_name_for_plotting, else its first operand, else its data_item_name.
 *
 * @param {Object} item - A prediction item, as obs_data has it.
 * @returns {string} '' when it names none.
 */
export function nameItemForPlotting(item) {
  let entry
  try {
    entry = migrateLegacyKeys(isMapping(item) ? item : {}, 0)
  } catch {
    entry = { ...item }
  }
  const traceName = entry.trace_name_for_plotting ?? SCHEMA.trace_name_for_plotting.fallback(entry)
  return formatPythonStr(entry.item_name_for_plotting ?? traceName)
}

/**
 * Checks the shape of an item's data: a constant's value and std are single numbers, a series' value a list, its std
 * one number or one per value, and it has an obs_dt. Ported from CA's check_value_shape.
 *
 * @param {string} where - How CA names the item.
 * @param {Object} entry
 * @returns {string|null} CA's error, or null.
 */
export function checkValueShape(where, { data_type: dataType, value, std, obs_dt: obsDt }) {
  if (dataType === 'constant') {
    if (Array.isArray(value)) {
      return `${where} is data_type 'constant', so its value must be a single number, not a list of ${value.length}. A list of values over time is data_type 'series' (with obs_dt).`
    }
    if (Array.isArray(std)) return `${where} is data_type 'constant', so its std must be a single number, not a list.`
  } else if (dataType === 'series') {
    if (value == null) return null
    if (!Array.isArray(value)) {
      return `${where} is data_type 'series', so its value must be a list of samples (k * obs_dt apart), not the single number ${formatPythonRepr(value)}. A single number is data_type 'constant'.`
    }
    if (Array.isArray(std) && std.length !== 1 && std.length !== value.length) {
      return `${where} is a series of ${value.length} values but has ${std.length} stds; give one std per value, or a single number.`
    }
    if (obsDt == null) return `${where} is data_type 'series', so it needs obs_dt: the spacing of its samples in seconds.`
  }
  return null
}

/**
 * Checks an item's held-out std as a data item's: one finite positive number for a constant; for a series, one such
 * number, for every point, or one per point. Ported from CA's _held_out_std.
 *
 * @param {string} where - How CA names the item.
 * @param {Object} entry - With a value and a std, its shape checked.
 * @returns {{error: string|null, std: number|number[]|null}} CA's error, or the std as CA reads it: a number for a
 *   constant, one per point for a series.
 */
function readHeldOutStd(where, { data_type: dataType, value, std }) {
  let stds
  if (dataType === 'constant') {
    if (Array.isArray(std)) return { error: `${where}: a constant's 'std' is one number, got a list.`, std: null }
    stds = [Number(std)]
  } else {
    const points = Array.isArray(value) ? value.flat(Infinity).length : 1
    stds = (Array.isArray(std) ? std.flat(Infinity) : [std]).map(Number)
    if (stds.length === 1) stds = Array(points).fill(stds[0])
    else if (stds.length !== points) {
      return { error: `${where}: 'std' has ${stds.length} entries but the series has ${points} points; give one number or one per point.`, std: null }
    }
  }
  if (!stds.every((entry) => Number.isFinite(entry) && entry > 0)) {
    return { error: `${where}: every 'std' entry must be finite and > 0, got ${formatPythonRepr(std)}.`, std: null }
  }
  return { error: null, std: dataType === 'constant' ? stds[0] : stds }
}

/**
 * Reads one prediction item as CA does: legacy keys migrated, the schema checked and defaults filled in, then its
 * experiment and sub-experiment, its data and its operation.
 *
 * @param {*} rawEntry
 * @param {number} index - Its place in prediction_items.
 * @param {Array} simTimes - The protocol_info's, one list of sub-experiment lengths per experiment.
 * @returns {{error: string|null, entry: Object|null}} CA's error, or the item as CA reads it, with `operation` null
 *   for none and `subexperiment_idx` the one it records over.
 */
export function readPredictionItem(rawEntry, index, simTimes) {
  if (!isMapping(rawEntry)) return { error: `prediction_items[${index}] must be a dict, got ${formatPythonClass(rawEntry)}`, entry: null }
  let entry
  try {
    entry = migrateLegacyKeys(rawEntry, index)
  } catch (error) {
    return { error: error.message, entry: null }
  }
  const unknown = Object.keys(entry).filter((key) => !Object.hasOwn(SCHEMA, key)).sort()
  if (unknown.length) return { error: `Unknown keys in prediction_items[${index}] not in schema: ${formatPythonList(unknown)}`, entry: null }

  const missingRequired = []
  const typeErrors = []
  for (const [key, rules] of Object.entries(SCHEMA)) {
    if (entry[key] == null) {
      if (rules.isRequired) {
        missingRequired.push(key)
        continue
      }
      entry[key] = rules.fallback ? rules.fallback(entry) : null
    }
    if (rules.isOptional && entry[key] == null) continue
    if (!rules.isAllowed(entry[key])) typeErrors.push(`prediction_items[${index}]['${key}']: expected ${rules.types}, got ${formatPythonClass(entry[key])}`)
  }
  if (missingRequired.length) return { error: `Missing required keys in prediction_items[${index}]: ${formatPythonList(missingRequired.sort())}`, entry: null }
  if (typeErrors.length) return { error: `Invalid prediction_items value types:\n${typeErrors.join('\n')}`, entry: null }

  const where = `prediction_items[${index}] ('${entry.data_item_name}')`
  const experiments = simTimes?.length ? simTimes : [[null]]
  const experiment = Number(entry.experiment_idx)
  if (!(experiment >= 0 && experiment < experiments.length)) {
    return { error: `${where}: experiment_idx ${experiment} is not an experiment of protocol_info, which has ${experiments.length}.`, entry: null }
  }
  const subs = experiments[experiment]?.length ?? 0
  const sub = entry.subexperiment_idx == null ? subs - 1 : Number(entry.subexperiment_idx)
  if (!(sub >= 0 && sub < subs)) {
    return { error: `${where}: subexperiment_idx ${sub} is not a sub-experiment of experiment ${experiment}, which has ${subs}.`, entry: null }
  }
  if (entry.value != null && entry.data_type == null) return { error: `${where} has a value, so it needs data_type 'constant' or 'series'.`, entry: null }
  if (entry.data_type != null && entry.data_type !== 'constant' && entry.data_type !== 'series') {
    return { error: `${where}: data_type must be 'constant' or 'series', got ${formatPythonRepr(entry.data_type)}.`, entry: null }
  }
  const shapeError = checkValueShape(where, entry)
  if (shapeError) return { error: shapeError, entry: null }
  if (entry.value != null && entry.std != null) {
    const { error, std } = readHeldOutStd(where, entry)
    if (error) return { error, entry: null }
    entry.std = std
  }
  const operation = readOperation(entry.operation)
  const kwargs = entry.operation_kwargs ?? {}
  if (Object.keys(kwargs).length && operation == null) {
    return {
      error: `${where} has operation_kwargs but no operation. operation_kwargs are the keyword arguments of the operation func; name the operation, or drop operation_kwargs.`,
      entry: null,
    }
  }
  return { error: null, entry: { ...entry, operation, operation_kwargs: { ...kwargs }, subexperiment_idx: sub } }
}

/**
 * Checks that no two items, data or prediction, share a data_item_name. Ported from CA's check_data_item_names_unique.
 *
 * @param {string[]} dataNames
 * @param {string[]} predictionNames
 * @returns {string|null} CA's error, or null.
 */
export function checkItemNamesUnique(dataNames, predictionNames) {
  const counts = new Map()
  const count = (names, list) => names.forEach((name) => counts.set(String(name), [...(counts.get(String(name)) ?? []), list]))
  count(dataNames, 'data_items')
  count(predictionNames, 'prediction_items')
  const repeated = [...counts].filter(([, lists]) => lists.length > 1).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  if (!repeated.length) return null
  const detail = repeated.map(([name, lists]) => `${formatPythonRepr(name)} x${lists.length} (in ${[...new Set(lists)].sort().join(', ')})`).join('; ')
  return (
    `Duplicate 'data_item_name' in obs_data: ${detail}. Each item needs its own name: an operation_kwargs reference to ` +
    "a repeated one silently resolves to whichever item was evaluated last. The plotting label 'trace_name_for_plotting' may repeat."
  )
}

/**
 * Checks the items prediction items' operation_kwargs name: only earlier prediction items, with an operation, and not
 * series. Ported from CA's check_prediction_operation_references.
 *
 * @param {string[]} dataNames
 * @param {Array<Object>} entries - The prediction items as readPredictionItem reads them.
 * @returns {Array<{index: number, error: string}>} CA's error for each item that has one; CA stops at the first.
 */
export function checkOperationReferences(dataNames, entries) {
  const data = new Set(dataNames.map(String))
  const names = entries.map((entry) => String(entry.data_item_name))
  const errors = []
  entries.forEach((entry, index) => {
    for (const [key, value] of Object.entries(entry.operation_kwargs ?? {})) {
      if (typeof value !== 'string') continue
      const prefix = `prediction_items[${index}] ('${names[index]}'): operation_kwargs ${formatPythonRepr(key)} references`
      let error = null
      if (data.has(value)) {
        error = `${prefix} data_item ${formatPythonRepr(value)}. A prediction item's operation_kwargs may reference earlier prediction_items only.`
      } else if (names.slice(index).includes(value)) {
        error =
          `${prefix} prediction item ${formatPythonRepr(value)}, which is not earlier in prediction_items. References are resolved in order; ` +
          `move ${formatPythonRepr(value)} before '${names[index]}'.`
      } else if (names.slice(0, index).includes(value)) {
        const target = entries[names.indexOf(value)]
        if (target.operation == null || target.data_type === 'series') {
          const what = target.operation == null ? 'has no operation' : 'is a series'
          error =
            `${prefix} prediction item ${formatPythonRepr(value)}, which ${what}. A reference must name an earlier prediction item with an ` +
            "operation that gives one number (data_type 'constant', or no data_type and an operation such as 'max' or 'mean'): only those " +
            'have a value in every analysis.'
        }
      }
      if (error) {
        errors.push({ index, error })
        break
      }
    }
  })
  return errors
}

/**
 * Lists the names of a document's data items, as CA names them.
 *
 * @param {Object} document
 * @returns {string[]}
 */
const listDataNames = (document) => (Array.isArray(document?.data_items) ? document.data_items : []).filter(isMapping).map((item) => item.data_item_name ?? item.variable).filter((name) => name != null)

/**
 * Reads each of an obs_data document's prediction_items as CA does, before it checks them against each other and the
 * data items: every item's legacy keys, then each item.
 *
 * @param {Object} document - With the protocol_info whose sim_times the items refer to.
 * @returns {{error: string|null, entries: Array<Object>}} CA's first error, or the items as readPredictionItem reads
 *   them.
 */
export function readPredictionEntries(document) {
  const items = document?.prediction_items ?? []
  if (!Array.isArray(items)) return { error: `prediction_items must be a list of dict entries, got ${formatPythonClass(items)}`, entries: [] }
  const simTimes = document?.protocol_info?.sim_times
  // CA brings every item's legacy keys up to date before reading any.
  for (const [index, item] of items.entries()) {
    try {
      if (isMapping(item)) migrateLegacyKeys(item, index)
    } catch (error) {
      return { error: error.message, entries: [] }
    }
  }
  const entries = []
  for (const [index, item] of items.entries()) {
    const { error, entry } = readPredictionItem(item, index, simTimes)
    if (error) return { error, entries: [] }
    entries.push(entry)
  }
  return { error: null, entries }
}

/**
 * Reads an obs_data document's prediction_items as CA does: each item, then that names are unique across data and
 * prediction items, then the items operation_kwargs name. Stops at the first error, as CA does.
 *
 * @param {Object} document - With the protocol_info whose sim_times the items refer to.
 * @returns {{error: string|null, predictionInfo: Object|null}} CA's error, or its prediction_info: a list per key
 *   (`data_item_names`, `operands`, `units`, `experiment_idxs`, `subexperiment_idxs`, `operations`, ...).
 */
export function readPredictionItemsAsCircAutogen(document) {
  const { error: readError, entries } = readPredictionEntries(document)
  if (readError) return { error: readError, predictionInfo: null }
  const dataNames = listDataNames(document)
  const error = checkItemNamesUnique(dataNames, entries.map((entry) => entry.data_item_name)) ?? checkOperationReferences(dataNames, entries)[0]?.error
  if (error) return { error, predictionInfo: null }
  const column = (key) => entries.map((entry) => entry[key])
  return {
    error: null,
    predictionInfo: {
      operands: column('operands'),
      units: column('unit'),
      data_item_names: column('data_item_name'),
      trace_names_for_plotting: column('trace_name_for_plotting'),
      item_names_for_plotting: column('item_name_for_plotting'),
      experiment_idxs: column('experiment_idx'),
      subexperiment_idxs: column('subexperiment_idx'),
      data_types: column('data_type'),
      values: column('value'),
      stds: column('std'),
      obs_dts: column('obs_dt'),
      operations: column('operation'),
      operation_kwargs: column('operation_kwargs'),
    },
  }
}

/**
 * Whether an operation reduces a window of its sub-experiment, given as `start_frac` and `end_frac`.
 *
 * @param {string|null} operation
 * @returns {boolean}
 */
export const isRangeOperation = (operation) => typeof operation === 'string' && operation.endsWith('_in_range')

/**
 * Checks the window an `*_in_range` operation reduces. CA takes the samples from `int(start_frac * (n - 1))` up to,
 * not including, `int(end_frac * (n - 1))`, of the n = int(duration / dt) + 1 its sub-experiment records, so the
 * window must hold one at least.
 *
 * @param {Object} kwargs - The item's operation_kwargs; CA's defaults are 0 and 1.
 * @param {Object} [options]
 * @param {number} [options.duration] - The sub-experiment's length, in seconds.
 * @param {number} [options.dt] - The time between recorded samples. Without it, and the duration, only the fractions
 *   are checked.
 * @returns {string|null} What's wrong, or null.
 */
export function checkOperationRange(kwargs, { duration, dt } = {}) {
  const start = kwargs?.start_frac ?? 0
  const end = kwargs?.end_frac ?? 1
  if (typeof start !== 'number' || typeof end !== 'number' || !(start >= 0 && start < end && end <= 1)) {
    return `The range must run from a start_frac to a later end_frac, both from 0 to 1; it is ${formatPythonRepr(start)} to ${formatPythonRepr(end)}.`
  }
  if (!(duration > 0 && dt > 0)) return null
  const samples = Math.trunc(duration / dt) + 1
  if (Math.trunc(start * (samples - 1)) < Math.trunc(end * (samples - 1))) return null
  return (
    `The range ${start} to ${end} of ${duration} s takes no samples: at ${dt} s apart it records ${samples}, and the range takes ` +
    'those from int(start_frac * (n - 1)) up to, not including, int(end_frac * (n - 1)). Widen it.'
  )
}

/**
 * Lists the prediction items that need circulatory_autogen #536: those with an operation, its keyword arguments or
 * a sub-experiment.
 *
 * @param {Object} document
 * @returns {string[]} A warning naming them, or none.
 */
export function findPredictionItemLimits(document) {
  const items = Array.isArray(document?.prediction_items) ? document.prediction_items : []
  const names = items.filter((item) => isMapping(item) && NEEDS_536.some((key) => Object.hasOwn(item, key))).map((item) => item.data_item_name ?? '(unnamed)')
  if (!names.length) return []
  return [
    `${names.length === 1 ? 'A prediction item uses' : `${names.length} prediction items use`} an operation or a sub-experiment (${names.join(', ')}), ` +
      'so it needs circulatory_autogen with #536; released libcuflynx 0.7.3 and current CUFLynx reject this file.',
  ]
}

/**
 * Checks a document's prediction items for the editor: each as CA reads it, names unique across data and prediction
 * items, the items operation_kwargs name, and each range an `*_in_range` operation reduces. Unlike CA, it goes on
 * after an error, so each item's are known.
 *
 * @param {Object} document
 * @param {Object} [options]
 * @param {number} [options.dt] - The time between recorded samples, to check that each range takes some.
 * @returns {{errors: string[], warnings: string[], itemErrors: string[][]}} `itemErrors` has each item's own, by place.
 */
export function validatePredictionItems(document, { dt } = {}) {
  const items = document?.prediction_items ?? []
  if (!Array.isArray(items)) return { errors: [`prediction_items must be a list of dict entries, got ${formatPythonClass(items)}`], warnings: [], itemErrors: [] }
  const simTimes = document?.protocol_info?.sim_times
  const itemErrors = items.map(() => [])
  const read = items.map((item, index) => {
    const { error, entry } = readPredictionItem(item, index, simTimes)
    if (error) itemErrors[index].push(error)
    return entry
  })
  const dataNames = listDataNames(document)
  const names = items.map((item, index) => read[index]?.data_item_name ?? (isMapping(item) ? item.data_item_name : null)).filter((name) => name != null)
  const errors = []
  const nameError = checkItemNamesUnique(dataNames, names)
  if (nameError) errors.push(nameError)
  // The references of the items read; the others name nothing CA could reach.
  const entries = read.map((entry, index) => entry ?? { data_item_name: items[index]?.data_item_name, operation: null, operation_kwargs: {} })
  for (const { index, error } of checkOperationReferences(dataNames, entries)) if (read[index]) itemErrors[index].push(error)
  read.forEach((entry, index) => {
    if (!entry || !isRangeOperation(entry.operation)) return
    const duration = simTimes?.[Number(entry.experiment_idx)]?.[entry.subexperiment_idx]
    const error = checkOperationRange(entry.operation_kwargs, { duration, dt })
    if (error) itemErrors[index].push(`prediction_items[${index}] ('${entry.data_item_name}'): ${error}`)
  })
  return { errors: [...itemErrors.flat(), ...errors], warnings: findPredictionItemLimits(document), itemErrors }
}
