/**
 * Checks an obs_data document's data_items as circulatory_autogen #536 does on reading it (PrimitiveParsers.py), in the
 * same order and with the same messages, its pandas frame's quirks included; then, for an editor, what CA checks only
 * when it runs: operation_kwargs and cost_kwargs against its funcs, and references to other items.
 */
import { DATA_ITEM_VOCABULARY, DATA_TYPES, DEFAULT_COST_TYPE, RESERVED_COST_KWARGS, RESERVED_OPERATION_KWARGS } from './dataItemVocabulary.js'
import { LEGACY_ADVICE, LEGACY_KEYS, NO_OPERATION_SPELLINGS, checkItemNamesUnique, checkOperationReferences, checkValueShape, readOperation, readPredictionEntries } from './predictionValidation.js'
import { formatPythonFloat, formatPythonList, formatPythonRepr, formatPythonStr, getPythonTypeName } from './pythonFormat.js'
import { isMapping } from './protocolShapes.js'

// A key an item doesn't have: pandas' NaN, where an item's null is None.
const ABSENT = Symbol('absent')
const STRING = "(<class 'str'>,)"
const LIST = "(<class 'list'>, <class 'tuple'>, <class 'numpy.ndarray'>)"
const DICT = "(<class 'dict'>,)"
const INTEGER = "(<class 'int'>, <class 'numpy.integer'>)"
const NUMBER = "(<class 'int'>, <class 'float'>, <class 'numpy.integer'>, <class 'numpy.floating'>)"
const NUMBER_OR_ARRAY = "(<class 'int'>, <class 'float'>, <class 'numpy.integer'>, <class 'numpy.floating'>, <class 'list'>, <class 'numpy.ndarray'>)"
const LIST_OR_NUMBER = "(<class 'list'>, <class 'tuple'>, <class 'numpy.ndarray'>, <class 'int'>, <class 'float'>, <class 'numpy.integer'>, <class 'numpy.floating'>)"
const isString = (value) => typeof value === 'string'
const isNumber = (value) => typeof value === 'boolean' || typeof value === 'number'
const isNumberOrArray = (value) => isNumber(value) || Array.isArray(value)
const REQUIRED = 'required'
// CA's data_item schema: each key's allowed types, as CA prints them, and its default. In CA's order, which is the
// order defaults are filled in, each from the columns before it.
const SCHEMA = {
  data_item_name: { types: STRING, isAllowed: isString, fallback: REQUIRED },
  data_type: { types: STRING, isAllowed: isString, fallback: REQUIRED },
  unit: { types: STRING, isAllowed: isString, fallback: REQUIRED },
  weight: { types: NUMBER_OR_ARRAY, isAllowed: isNumberOrArray, fallback: () => 1 },
  operands: { types: LIST, isAllowed: Array.isArray, fallback: REQUIRED },
  operation: { types: STRING, isAllowed: isString, fallback: () => null },
  trace_name_for_plotting: { types: STRING, isAllowed: isString, fallback: (row) => defaultTraceName(row) },
  item_name_for_plotting: { types: STRING, isAllowed: isString, fallback: (row) => defaultItemName(row.trace_name_for_plotting, row.operation) },
  operation_kwargs: { types: DICT, isAllowed: isMapping, fallback: () => ({}) },
  cost_kwargs: { types: DICT, isAllowed: isMapping, fallback: () => ({}) },
  value: { types: NUMBER_OR_ARRAY, isAllowed: isNumberOrArray, fallback: () => NaN },
  std: { types: NUMBER_OR_ARRAY, isAllowed: isNumberOrArray, fallback: () => NaN },
  experiment_idx: { types: INTEGER, isAllowed: (value) => typeof value === 'boolean' || Number.isInteger(value), isInteger: true, fallback: () => 0 },
  subexperiment_idx: { types: INTEGER, isAllowed: (value) => typeof value === 'boolean' || Number.isInteger(value), isInteger: true, fallback: () => 0 },
  plot_type: { types: STRING, isAllowed: isString, fallback: () => null },
  plot_color: { types: STRING, isAllowed: isString, fallback: () => null },
  comment: { types: STRING, isAllowed: isString, fallback: () => null },
  cost_type: { types: STRING, isAllowed: isString, fallback: () => DEFAULT_COST_TYPE },
  obs_type: { types: STRING, isAllowed: isString, fallback: () => null },
  frequencies: { types: LIST_OR_NUMBER, isAllowed: isNumberOrArray, fallback: () => null },
  phase_weight: { types: NUMBER_OR_ARRAY, isAllowed: isNumberOrArray, fallback: (row) => row.weight },
  phase: { types: LIST_OR_NUMBER, isAllowed: isNumberOrArray, fallback: () => null },
  prob_dist_params: { types: DICT, isAllowed: isMapping, fallback: () => null },
  obs_dt: { types: NUMBER, isAllowed: isNumber, fallback: () => null },
  dt: { types: NUMBER, isAllowed: isNumber, fallback: () => null },
  sample_rate: { types: NUMBER, isAllowed: isNumber, fallback: () => null },
  species: { types: STRING, isAllowed: isString, fallback: () => null },
  location: { types: STRING, isAllowed: isString, fallback: () => null },
  source: { types: "(<class 'str'>, <class 'dict'>)", isAllowed: (value) => isString(value) || isMapping(value), fallback: () => null },
  t_path: { types: STRING, isAllowed: isString, fallback: () => null },
  value_path: { types: STRING, isAllowed: isString, fallback: () => null },
}
export const DATA_ITEM_KEYS = Object.keys(SCHEMA)
// What the port reads of each item, as CA's frame has it.
const READ_KEYS = [
  'data_item_name',
  'data_type',
  'unit',
  'weight',
  'operands',
  'operation',
  'trace_name_for_plotting',
  'item_name_for_plotting',
  'operation_kwargs',
  'cost_kwargs',
  'value',
  'std',
  'experiment_idx',
  'subexperiment_idx',
  'plot_type',
  'plot_color',
  'cost_type',
  'obs_dt',
  'prob_dist_params',
  'source',
  'comment',
]
const DISTRIBUTION_COSTS = '(kernel_density_estimation, multimodal_gaussian, poisson_MLE)'

/**
 * Whether a cell is missing, as CA's _is_missing_scalar has it: None, NaN, or a key the item doesn't have.
 *
 * @param {*} value
 * @returns {boolean}
 */
const isMissing = (value) => value === ABSENT || value == null || Number.isNaN(value)

/**
 * Formats a cell as Python's `str` of it: a missing key as NaN.
 *
 * @param {*} value
 * @returns {string}
 */
const formatCell = (value) => (value === ABSENT ? 'nan' : formatPythonStr(value))

/**
 * Gives a cell as JSON has it: a missing one as null.
 *
 * @param {*} value
 * @returns {*}
 */
const readCell = (value) => (isMissing(value) ? null : value)

/**
 * Names a value's class as Python prints `type(value)`.
 *
 * @param {*} value
 * @returns {string}
 */
const formatPythonClass = (value) => `<class '${getPythonTypeName(value)}'>`

/**
 * The trace an item is drawn from, by default: its first operand, else its name. Ported from CA's
 * default_trace_names_for_plotting.
 *
 * @param {Object} row
 * @returns {string}
 */
function defaultTraceName(row) {
  if (!('data_item_name' in row)) return ''
  const first = Array.isArray(row.operands) && row.operands.length ? formatPythonStr(row.operands[0]) : ''
  return first || formatCell(row.data_item_name)
}

/**
 * An item's label, by default: its trace's name, and its operation when it has one. Ported from CA's
 * default_item_name_for_plotting.
 *
 * @param {*} traceName
 * @param {*} operation
 * @returns {string}
 */
function defaultItemName(traceName, operation) {
  const trace = isMissing(traceName) ? '' : formatCell(traceName)
  if (isMissing(operation) || NO_OPERATION_SPELLINGS.includes(formatCell(operation).trim())) return trace
  return `${trace} (${formatCell(operation)})`
}

/**
 * Brings a data item's legacy keys up to date, as CA's migrate_legacy_obs_item_keys does for data_items.
 *
 * @param {Object} item
 * @param {number} index
 * @returns {Object} A copy.
 * @throws {Error} When it sets a legacy key and its replacement both.
 */
function migrateLegacyKeys(item, index) {
  const migrated = { ...item }
  for (const [old, current] of Object.entries(LEGACY_KEYS)) {
    if (!Object.hasOwn(migrated, old)) continue
    if (Object.hasOwn(migrated, current)) throw new Error(`data_items[${index}] sets both '${old}' and its replacement '${current}'. Remove '${old}'. ${LEGACY_ADVICE[old]}`)
    migrated[current] = migrated[old]
    delete migrated[old]
  }
  return migrated
}

/**
 * Reads a series' std as CA's _normalize_series_std does: one finite positive number, or one per sample, given as a
 * number or a list.
 *
 * @param {Object} item - A series with its value.
 * @returns {{error: string|null, std: number[]|null}}
 */
function readSeriesStd(item) {
  const name = formatPythonRepr(item.data_item_name ?? '<unknown>')
  const fail = (message) => ({ error: `Series data item ${name}${message}`, std: null })
  if (!('std' in item) || isMissing(item.std)) {
    return fail(" requires 'std' in the JSON (one positive scalar applied to all samples, or a vector with the same length as the series).")
  }
  const count = Array.isArray(item.value) ? item.value.length : 0
  if (count < 1) return fail(": cannot set 'std' without series 'value' or loaded .npy data.")
  const raw = item.std
  if (isNumber(raw)) {
    const std = Number(raw)
    if (!(std > 0 && Number.isFinite(std))) return fail(`: scalar 'std' must be finite and > 0, got ${formatPythonRepr(raw)}.`)
    return { error: null, std: Array(count).fill(std) }
  }
  if (Array.isArray(raw)) {
    const flat = raw.flat(Infinity)
    const text = flat.find((entry) => typeof entry === 'string' || isMapping(entry))
    if (text !== undefined) return { error: isString(text) ? `could not convert string to float: ${formatPythonRepr(text)}` : 'float() argument must be a string or a real number, not \'dict\'', std: null }
    const stds = flat.map((entry) => (entry == null ? NaN : Number(entry)))
    if (stds.length === 1) {
      if (!(stds[0] > 0 && Number.isFinite(stds[0]))) return fail(`: scalar 'std' must be finite and > 0, got ${formatPythonFloat(stds[0])}.`)
      return { error: null, std: Array(count).fill(stds[0]) }
    }
    if (stds.length !== count) return fail(`: 'std' length (${stds.length}) does not match series length (${count}).`)
    if (!stds.every((std) => std > 0 && Number.isFinite(std))) return fail(": every 'std' entry must be finite and > 0.")
    return { error: null, std: stds }
  }
  return fail(`: 'std' must be a scalar or list, got ${getPythonTypeName(raw)}.`)
}

/**
 * Prepares series as CA's _hydrate_series_data_items does: `timeseries` read as series, legacy paths moved to
 * `value_path` and `t_path`, a series' value checked to be a list and its std expanded to one per sample. A series whose
 * values are in files, which the port can't read, keeps its std as it is.
 *
 * @param {Object} item
 * @param {number} index - Its place in data_items.
 * @returns {{error: string|null, item: Object|null}}
 */
function hydrateItem(item, index) {
  const hydrated = JSON.parse(JSON.stringify(item))
  if (hydrated.data_type === 'timeseries') hydrated.data_type = 'series'
  if (hydrated.plot_type === 'timeseries') hydrated.plot_type = 'series'
  if (hydrated.data_type !== 'series') return { error: null, item: hydrated }
  const shapeError = checkValueShape(`data_items[${index}] ('${formatCell(hydrated.data_item_name ?? '<unknown>')}')`, { data_type: 'series', value: hydrated.value ?? null, std: null, obs_dt: 1 })
  if (shapeError) return { error: shapeError, item: null }
  // Legacy: the value's file named by voltage or current, or in a source dict.
  const pickPath = (voltage, current) => (/I_tot/.test(String(hydrated.data_item_name ?? '')) ? current || voltage : voltage || current)
  let tPath = hydrated.t_path
  let valuePath = hydrated.value_path
  if (valuePath == null) {
    const { vm_path: voltage, im_path: current } = hydrated
    delete hydrated.vm_path
    delete hydrated.im_path
    if (voltage || current) {
      valuePath = pickPath(voltage, current)
      if (valuePath) hydrated.value_path = valuePath
    }
  }
  if (isMapping(hydrated.source)) {
    const source = hydrated.source
    const take = (key) => {
      const value = source[key] ?? null
      delete source[key]
      return value
    }
    if (tPath == null) {
      tPath = take('t_path')
      if (tPath) hydrated.t_path = tPath
    }
    if (valuePath == null) {
      let path = take('value_path')
      if (path == null) path = pickPath(take('vm_path'), take('im_path'))
      if (path) hydrated.value_path = valuePath = path
    }
    if (source.description && Object.keys(source).length === 1) hydrated.source = source.description
    else if (!Object.keys(source).length) delete hydrated.source
  }
  const hasValue = 'value' in hydrated && !isMissing(hydrated.value) && (!Array.isArray(hydrated.value) || hydrated.value.length > 0)
  if (hasValue && (tPath || valuePath)) {
    return {
      error:
        `Series data item ${formatPythonRepr(hydrated.data_item_name ?? '<unknown>')} specifies both embedded 'value' and 't_path'/'value_path' (.npy files). ` +
        "Use one source only: either embed 'value' in the JSON or provide 't_path' and 'value_path', not both.",
      item: null,
    }
  }
  if (!hasValue && tPath && valuePath && isMissing(hydrated.value ?? null)) return { error: null, item: hydrated }
  const { error, std } = readSeriesStd(hydrated)
  if (error) return { error, item: null }
  hydrated.std = std
  return { error: null, item: hydrated }
}

/**
 * Builds a column of CA's frame as pandas does from the items: a key an item hasn't is NaN, and a column of numbers
 * with any missing, or any not whole, is of floats.
 *
 * @param {Array<Object>} items
 * @param {string} key
 * @returns {{cells: Array, isFloat: boolean}}
 */
function buildColumn(items, key) {
  const cells = items.map((item) => (Object.hasOwn(item, key) ? item[key] : ABSENT))
  const present = cells.filter((cell) => cell !== ABSENT && cell != null)
  const isNumeric = present.length > 0 && present.every((cell) => typeof cell === 'number')
  const isFloat = isNumeric && (present.length < cells.length || present.some((cell) => !Number.isInteger(cell)))
  return { cells: isNumeric ? cells.map((cell) => (cell === ABSENT || cell == null ? NaN : cell)) : cells, isFloat }
}

/**
 * Reads data items as CA's parser builds and checks its frame of them: unknown keys, then each column's default and
 * types, then data types, ground truths, the type errors found, and each item's value's shape.
 *
 * @param {Array<Object>} items - Migrated and hydrated.
 * @param {number[]} places - Each item's place in data_items, for messages.
 * @returns {{error: string|null, rows: Array<Object>}}
 */
function readFrame(items, places) {
  const fail = (error) => ({ error, rows: [] })
  const unknown = [...new Set(items.flatMap((item) => Object.keys(item)).filter((key) => !Object.hasOwn(SCHEMA, key)))].sort()
  if (unknown.length) return fail(`Unknown data_item keys not in schema: ${formatPythonList(unknown)}`)
  if (!items.length) return { error: null, rows: [] }

  const rows = items.map(() => ({}))
  const isFloatColumn = {}
  const missingRequired = []
  const typeErrors = []
  for (const [key, rules] of Object.entries(SCHEMA)) {
    const isPresent = items.some((item) => Object.hasOwn(item, key))
    if (!isPresent && rules.fallback === REQUIRED) {
      missingRequired.push(key)
      continue
    }
    const { cells, isFloat } = isPresent ? buildColumn(items, key) : { cells: items.map(() => ABSENT), isFloat: false }
    isFloatColumn[key] = isFloat
    cells.forEach((cell, row) => {
      // A whole number filled into a column of floats is a float.
      rows[row][key] = isMissing(cell) && rules.fallback !== REQUIRED ? rules.fallback(rows[row]) : cell
    })
    rows.forEach((row, index) => {
      const cell = row[key]
      if (isMissing(cell)) return
      if (isFloat || !rules.isAllowed(cell)) {
        const isAllowedFloat = isFloat && rules.isAllowed(1.5)
        if (!isAllowedFloat) typeErrors.push(`row ${places[index]}, column '${key}': expected ${rules.types}, got ${isFloat ? "<class 'float'>" : formatPythonClass(cell)}`)
      }
    })
  }
  if (missingRequired.length) {
    let hint = ''
    if (missingRequired.includes('data_item_name')) hint += ` ${LEGACY_ADVICE.variable}`
    if (missingRequired.includes('operands')) hint += " Every data_item states the model variable(s) it reduces in 'operands', as a list."
    return fail(`Missing required data_item keys: ${formatPythonList(missingRequired.sort())}.${hint}`)
  }
  const badTypes = [...new Set(rows.map((row) => formatCell(row.data_type)))].filter((type) => !DATA_TYPES.includes(type)).sort()
  if (badTypes.includes('prob_dist')) {
    return fail(
      'data_type "prob_dist" has been removed (issue #421). It described the ground truth rather than the data: the feature is an ordinary scalar, ' +
        'and comparing it against a distribution is the cost function\'s job. Write "data_type": "constant" with a cost_type that scores against a ' +
        `distribution (kernel_density_estimation, multimodal_gaussian, poisson_MLE), keep the item's "prob_dist_params", and drop its now-unread "value" and "std".`
    )
  }
  if (badTypes.length) return fail(`Unknown data_item data_type(s) ${formatPythonList(badTypes)}. Valid data_types: ${formatPythonList(DATA_TYPES)}.`)
  const noGroundTruth = rows.flatMap((row) => {
    if (!isMissing(row.prob_dist_params)) return []
    const absent = ['value', 'std'].filter((key) => isMissing(row[key]))
    return absent.length ? [`'${formatCell(row.data_item_name)}' (cost_type '${formatCell(row.cost_type)}') is missing ${absent.join(' and ')}`] : []
  })
  if (noGroundTruth.length) {
    return fail(
      "Every data_item needs a ground truth to be scored against: either 'value' and 'std', or 'prob_dist_params' for a cost that compares " +
        `against a distribution ${DISTRIBUTION_COSTS}. ${noGroundTruth.join('; ')}`
    )
  }
  if (typeErrors.length) return fail(`Invalid data_item value types:\n${typeErrors.join('\n')}`)
  for (const [index, row] of rows.entries()) {
    const read = (key) => (isMissing(row[key]) ? null : row[key])
    const shapeError = checkValueShape(`data_items[${places[index]}] ('${formatCell(row.data_item_name)}')`, {
      data_type: read('data_type'),
      value: read('value'),
      std: read('std'),
      obs_dt: read('obs_dt'),
    })
    if (shapeError) return fail(shapeError)
  }
  return { error: null, rows: rows.map((row) => Object.fromEntries(READ_KEYS.map((key) => [key, readCell(row[key])]))) }
}

/**
 * Reads data items as CA does before checking them against prediction items: legacy keys migrated, series prepared,
 * then their frame.
 *
 * @param {Array} items
 * @param {Object} [options]
 * @param {number[]} [options.places] - Each item's place in data_items; by default its own.
 * @param {boolean} [options.isBareList] - A document of data items alone, whose series CA doesn't prepare.
 * @param {Function} [options.beforeFrame] - What CA reads between the series and the frame (the prediction items):
 *   gives an error, or null.
 * @returns {{error: string|null, rows: Array<Object>}}
 */
function readItems(items, { places = items.map((_, index) => index), isBareList = false, beforeFrame = () => null } = {}) {
  const fail = (error) => ({ error, rows: [] })
  const badEntry = items.findIndex((item) => !isMapping(item))
  if (badEntry >= 0) return fail(`data_items[${places[badEntry]}] must be a dict, got ${formatPythonClass(items[badEntry])}`)
  let migrated
  try {
    migrated = items.map((item, index) => migrateLegacyKeys(item, places[index]))
  } catch (error) {
    return fail(error.message)
  }
  const hydrated = []
  for (const [index, item] of migrated.entries()) {
    if (isBareList) {
      hydrated.push(item)
      continue
    }
    const { error, item: ready } = hydrateItem(item, places[index])
    if (error) return fail(error)
    hydrated.push(ready)
  }
  const error = beforeFrame()
  if (error) return fail(error)
  return readFrame(hydrated, places)
}

/**
 * Lists a document's data items, as CA reads them: its data_items, else data_item, or the list it is.
 *
 * @param {Object|Array} document
 * @returns {Array|null} Null when it has none.
 */
const listRawItems = (document) => (Array.isArray(document) ? document : isMapping(document) ? (document.data_items ?? document.data_item ?? null) : null)

/**
 * Reads an obs_data document's data_items as CA's parser does (the protocol_info aside, which readAsCircAutogen
 * checks): legacy keys migrated, series prepared, the prediction items read, then the frame of data items, its defaults
 * filled and its types, data types, ground truths and shapes checked; then that names are unique across data and
 * prediction items, and the items prediction items' operation_kwargs name. Stops at the first error, as CA does.
 *
 * @param {Object|Array} document
 * @returns {{error: string|null, dataItems: Array<Object>|null}} CA's error, or each data item as its frame has it:
 *   data_item_name, data_type, unit, weight, operands, operation, the labels, operation_kwargs, cost_kwargs, value, std,
 *   experiment_idx, subexperiment_idx, plot_type, plot_color, cost_type, obs_dt, prob_dist_params, source and comment,
 *   defaults filled in and a series' std one per sample.
 */
export function readDataItemsAsCircAutogen(document) {
  const items = listRawItems(document)
  const isBareList = Array.isArray(document)
  let predictionEntries = []
  const readPredictions = () => {
    if (isBareList || !isMapping(document) || !('prediction_items' in document)) return null
    const { error, entries } = readPredictionEntries(document)
    predictionEntries = entries
    return error
  }
  let rows = []
  if (Array.isArray(items)) {
    const read = readItems(items, { isBareList, beforeFrame: readPredictions })
    if (read.error) return { error: read.error, dataItems: null }
    rows = read.rows
  } else {
    const error = readPredictions()
    if (error) return { error, dataItems: null }
  }
  const dataNames = rows.map((row) => formatPythonStr(row.data_item_name ?? NaN))
  const error = checkItemNamesUnique(dataNames, predictionEntries.map((entry) => entry.data_item_name)) ?? checkOperationReferences(dataNames, predictionEntries)[0]?.error
  if (error) return { error, dataItems: null }
  return { error: null, dataItems: rows }
}

/**
 * Finds the words in a list close to one, as Python's difflib.get_close_matches does.
 *
 * @param {string} word
 * @param {string[]} possibilities
 * @param {number} [count]
 * @param {number} [cutoff]
 * @returns {string[]} The closest first.
 */
export function findCloseMatches(word, possibilities, count = 3, cutoff = 0.6) {
  const scored = possibilities.map((possibility) => [measureSimilarity(possibility, word), possibility]).filter(([score]) => score >= cutoff)
  scored.sort(([scoreA, a], [scoreB, b]) => scoreB - scoreA || (a < b ? 1 : a > b ? -1 : 0))
  return scored.slice(0, count).map(([, possibility]) => possibility)
}

/**
 * Measures how alike two strings are as difflib's SequenceMatcher.ratio does: twice the characters of their matching
 * blocks over their lengths.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function measureSimilarity(a, b) {
  const total = a.length + b.length
  if (!total) return 1
  const positions = new Map()
  ;[...b].forEach((character, index) => positions.set(character, [...(positions.get(character) ?? []), index]))
  // The longest block in a[aLow:aHigh] and b[bLow:bHigh], the earliest of the longest.
  const findLongest = (aLow, aHigh, bLow, bHigh) => {
    let best = [aLow, bLow, 0]
    let lengths = new Map()
    for (let i = aLow; i < aHigh; i++) {
      const next = new Map()
      for (const j of positions.get(a[i]) ?? []) {
        if (j < bLow) continue
        if (j >= bHigh) break
        const size = (lengths.get(j - 1) ?? 0) + 1
        next.set(j, size)
        if (size > best[2]) best = [i - size + 1, j - size + 1, size]
      }
      lengths = next
    }
    return best
  }
  let matched = 0
  const queue = [[0, a.length, 0, b.length]]
  while (queue.length) {
    const [aLow, aHigh, bLow, bHigh] = queue.pop()
    const [i, j, size] = findLongest(aLow, aHigh, bLow, bHigh)
    if (!size) continue
    matched += size
    if (aLow < i && bLow < j) queue.push([aLow, i, bLow, j])
    if (i + size < aHigh && j + size < bHigh) queue.push([i + size, aHigh, j + size, bHigh])
  }
  return (2 * matched) / total
}

/**
 * Finds an operation or cost func in a vocabulary.
 *
 * @param {Array<Object>} list
 * @param {*} name
 * @returns {Object|undefined}
 */
const findByName = (list, name) => (Array.isArray(list) ? list.find((entry) => entry.name === name) : undefined)

/**
 * Checks a data item's operation_kwargs against its operation, as CA's check_operation_kwargs does.
 *
 * @param {Object} kwargs
 * @param {string} operation
 * @param {Object} [options]
 * @param {string} [options.name] - The item's data_item_name.
 * @param {number} [options.operandCount] - How many operands it gives the operation.
 * @param {Object} [options.vocabulary] - The operations CA has; one it hasn't isn't checked.
 * @returns {string|null} CA's error, or null.
 */
export function checkOperationKwargs(kwargs, operation, { name = null, operandCount = 0, vocabulary = DATA_ITEM_VOCABULARY } = {}) {
  const spec = findByName(vocabulary.operations, operation)
  if (!spec || !isMapping(kwargs)) return null
  const where = name ? `data_item '${name}'` : 'a data_item'
  const accepted = [...new Set([...spec.operands, ...spec.kwargs.map(({ name: kwarg }) => kwarg)])]
  const filled = spec.operands.slice(0, operandCount)
  for (const key of Object.keys(kwargs)) {
    if (RESERVED_OPERATION_KWARGS.includes(key)) {
      return `Invalid 'operation_kwargs' key '${key}' in ${where}: '${key}' is set by circulatory_autogen when it calls the operation func '${operation}' and must not be given in obs_data.json. Remove it from 'operation_kwargs'.`
    }
    if (filled.includes(key)) {
      return (
        `Invalid 'operation_kwargs' key '${key}' in ${where}: the operation func '${operation}' already receives '${key}' positionally from the data_item's ` +
        `'operands' (operands fill ${formatPythonList(filled)}). Remove '${key}' from 'operation_kwargs', or remove the corresponding entry from 'operands'.`
      )
    }
    if (spec.acceptsAny || accepted.includes(key)) continue
    const suggestions = findCloseMatches(key, accepted)
    const hint = suggestions.length ? ` Did you mean ${suggestions.map(formatPythonRepr).join(' or ')}?` : ''
    return (
      `Invalid 'operation_kwargs' key '${key}' in ${where}: the operation func '${operation}' has no keyword argument '${key}'.${hint} Accepted keyword arguments ` +
      `are: ${formatPythonList([...accepted].sort())}. Fix the key in the data_item's 'operation_kwargs' in obs_data.json, or add '${key}' as a keyword argument of '${operation}'.`
    )
  }
  return null
}

/**
 * Checks a data item's cost_kwargs against its cost func, as CA's check_cost_kwargs does.
 *
 * @param {Object} kwargs
 * @param {string} costType
 * @param {Object} [options]
 * @param {string} [options.name] - The item's data_item_name.
 * @param {Object} [options.vocabulary] - The cost funcs CA has; one it hasn't isn't checked.
 * @returns {string|null} CA's error, or null.
 */
export function checkCostKwargs(kwargs, costType, { name = null, vocabulary = DATA_ITEM_VOCABULARY } = {}) {
  const spec = findByName(vocabulary.costTypes, costType) ?? findByName(DATA_ITEM_VOCABULARY.costTypes, costType)
  if (!spec || !isMapping(kwargs)) return null
  const where = name ? `data_item '${name}'` : 'a data_item'
  const accepted = [...new Set([...spec.positional, ...spec.kwargs.map(({ name: kwarg }) => kwarg)])]
  for (const key of Object.keys(kwargs)) {
    if (RESERVED_COST_KWARGS.includes(key)) {
      return `Invalid 'cost_kwargs' key '${key}' in ${where}: '${key}' is supplied by circulatory_autogen from the obs data and must not be set here. Set the data_item's own '${key}' field instead.`
    }
    if (spec.acceptsAny) continue
    if (spec.positional.includes(key)) {
      return `Invalid 'cost_kwargs' key '${key}' in ${where}: '${key}' is filled positionally by cost func '${costType}' (it receives the model output and the ground truth), so it cannot also be given as a keyword.`
    }
    if (!accepted.includes(key)) return `Invalid 'cost_kwargs' key '${key}' in ${where}: cost func '${costType}' has no parameter '${key}'. Accepted: ${formatPythonList([...accepted].sort())}.`
  }
  return null
}

/**
 * Checks the items data items' operation_kwargs name, as CA resolves them as it runs: each sub-experiment in turn, in
 * order, and the items of each in order, an item with an operation recording its value under its name. A reference to
 * an item with no value yet fails, as CA's resolve_operation_kwargs does.
 *
 * @param {Array<Object>} items - The data items.
 * @returns {Array<{index: number, error: string}>} CA's error for each item that has one.
 */
export function checkDataItemReferences(items) {
  const entries = items.map((item) => (isMapping(item) ? item : {}))
  const names = entries.map((item) => item.data_item_name ?? item.variable)
  const segment = (item) => [Number(item.experiment_idx ?? 0), Number(item.subexperiment_idx ?? 0)]
  const isEarlier = (from, to) => {
    const [[fromExperiment, fromSub], [toExperiment, toSub]] = [segment(entries[from]), segment(entries[to])]
    return toExperiment < fromExperiment || (toExperiment === fromExperiment && (toSub < fromSub || (toSub === fromSub && to < from)))
  }
  const errors = []
  entries.forEach((item, index) => {
    if (readOperation(item.operation) == null || !isMapping(item.operation_kwargs)) return
    for (const [key, value] of Object.entries(item.operation_kwargs)) {
      if (typeof value !== 'string') continue
      const targets = names.flatMap((name, place) => (name === value ? [place] : []))
      if (!targets.length) continue
      const isComputed = targets.some((target) => readOperation(entries[target].operation) != null && entries[target].data_type !== 'frequency' && isEarlier(index, target))
      if (isComputed) continue
      const name = names[index]
      errors.push({
        index,
        error:
          `${name ? `data_item ${formatPythonRepr(name)}` : 'a data_item'}: 'operation_kwargs' key ${formatPythonRepr(key)} references data_item ${formatPythonRepr(value)}, ` +
          "which has not been computed yet. References are resolved in order, so the item referenced must come earlier in 'data_items' -- and, when it " +
          'belongs to another experiment or sub-experiment, that segment must be earlier too (experiments in order, sub-experiments within each). ' +
          `Move ${formatPythonRepr(value)} before ${formatPythonRepr(name)}.`,
      })
      break
    }
  })
  return errors
}

/**
 * Checks a document's data items for an editor: each as CA reads it alone, then what CA checks only as it runs (its
 * operation and cost kwargs, the items it names, and that it is in an experiment and sub-experiment of the protocol,
 * as CA otherwise leaves it out of the cost); then what CA finds of them together: names unique across data and
 * prediction items, and anything else its reading of them all refuses, such as an experiment_idx on some items but not
 * others. Unlike CA, it goes on after an error, so each item's are known.
 *
 * @param {Object|Array} document
 * @param {Object} [options]
 * @param {Object} [options.vocabulary] - The operations and cost funcs CA has, as DATA_ITEM_VOCABULARY.
 * @returns {{errors: string[], warnings: string[], itemErrors: string[][], itemWarnings: string[][], sharedErrors:
 *   string[]}} `itemErrors` and `itemWarnings` have each item's own, by place; `errors` all of them.
 */
export function validateDataItems(document, { vocabulary = DATA_ITEM_VOCABULARY } = {}) {
  const items = listRawItems(document)
  if (items == null) return { errors: [], warnings: [], itemErrors: [], itemWarnings: [], sharedErrors: [] }
  if (!Array.isArray(items)) {
    const error = `data_items must be a list of dict entries, got ${formatPythonClass(items)}`
    return { errors: [error], warnings: [], itemErrors: [], itemWarnings: [], sharedErrors: [error] }
  }
  const isBareList = Array.isArray(document)
  const simTimes = isMapping(document) && Array.isArray(document.protocol_info?.sim_times) ? document.protocol_info.sim_times : null
  const operations = new Set((vocabulary.operations ?? []).map(({ name }) => name))
  const costTypes = new Set((vocabulary.costTypes ?? []).map(({ name }) => name))
  const itemErrors = items.map(() => [])
  const itemWarnings = items.map(() => [])
  let isEachRead = true
  items.forEach((item, index) => {
    const { error, rows } = readItems([item], { places: [index], isBareList })
    if (error) {
      itemErrors[index].push(error)
      isEachRead = false
    }
    if (!isMapping(item)) return
    const name = item.data_item_name ?? item.variable
    const where = `data_items[${index}] ('${formatCell(name ?? '<unknown>')}')`
    const experiment = item.experiment_idx ?? 0
    const sub = item.subexperiment_idx ?? 0
    if (simTimes && Number.isInteger(experiment) && Number.isInteger(sub)) {
      if (!(experiment >= 0 && experiment < simTimes.length)) itemErrors[index].push(`${where}: experiment_idx ${experiment} is not an experiment of protocol_info, which has ${simTimes.length}.`)
      else {
        const subs = Array.isArray(simTimes[experiment]) ? simTimes[experiment].length : 0
        if (!(sub >= 0 && sub < subs)) itemErrors[index].push(`${where}: subexperiment_idx ${sub} is not a sub-experiment of experiment ${experiment}, which has ${subs}.`)
      }
    }
    const operation = readOperation(item.operation)
    const kwargs = isMapping(item.operation_kwargs) ? item.operation_kwargs : {}
    if (operation != null && typeof operation === 'string') {
      if (!operations.has(operation)) itemWarnings[index].push(`${where}: circulatory_autogen has no operation ${formatPythonRepr(operation)} of its own; it needs an operation func of that name.`)
      const operandCount = Array.isArray(item.operands) ? item.operands.filter((operand) => operand).length : 0
      const kwargsError = checkOperationKwargs(kwargs, operation, { name: name == null ? null : formatPythonStr(name), operandCount, vocabulary })
      if (kwargsError) itemErrors[index].push(kwargsError)
    } else if (Object.keys(kwargs).length) {
      itemWarnings[index].push(`${where} has operation_kwargs but no operation, so circulatory_autogen doesn't use them. Name the operation, or drop operation_kwargs.`)
    }
    const costType = typeof item.cost_type === 'string' && item.cost_type ? item.cost_type : (vocabulary.defaultCostType ?? DEFAULT_COST_TYPE)
    if (typeof item.cost_type === 'string' && item.cost_type && !costTypes.has(costType)) {
      itemWarnings[index].push(`${where}: circulatory_autogen has no cost func ${formatPythonRepr(costType)} of its own; it needs a cost func of that name.`)
    }
    const costError = checkCostKwargs(item.cost_kwargs, costType, { name: name == null ? null : formatPythonStr(name), vocabulary })
    if (costError) itemErrors[index].push(costError)
    // A constant's std divides its error, so must be above 0, unless its cost scores it against a distribution.
    const costSpec = findByName(vocabulary.costTypes, costType) ?? findByName(DATA_ITEM_VOCABULARY.costTypes, costType)
    const row = rows[0]
    if (row && row.data_type === 'constant' && costSpec?.groundTruth !== 'distribution' && typeof row.std === 'number' && !(row.std > 0 && Number.isFinite(row.std))) {
      itemErrors[index].push(`${where}: every 'std' entry must be finite and > 0, got ${formatPythonRepr(row.std)}.`)
    }
  })
  for (const { index, error } of checkDataItemReferences(items)) itemErrors[index].push(error)

  const sharedErrors = []
  const { error: wholeError } = readDataItemsAsCircAutogen(document)
  const predictionNames = isMapping(document) && Array.isArray(document.prediction_items) ? document.prediction_items.filter(isMapping).map((item) => item.data_item_name ?? item.variable).filter((name) => name != null) : []
  const dataNames = items.filter(isMapping).map((item) => item.data_item_name ?? item.variable).filter((name) => name != null).map(String)
  const nameError = checkItemNamesUnique(dataNames, predictionNames)
  if (nameError) sharedErrors.push(nameError)
  // What CA refuses of the items together that it reads of each alone; the prediction items section shows the prediction items'.
  const isOfPredictions = wholeError?.startsWith('prediction_items') || wholeError?.startsWith("Duplicate 'data_item_name'")
  if (wholeError && isEachRead && !isOfPredictions) sharedErrors.push(wholeError)
  return { errors: [...itemErrors.flat(), ...sharedErrors], warnings: itemWarnings.flat(), itemErrors, itemWarnings, sharedErrors }
}
