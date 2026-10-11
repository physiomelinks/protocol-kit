/**
 * Computes the features of a run, as circulatory_autogen #536 does: each prediction item (prediction_features.py) and
 * each constant data item (paramID's get_obs_output_dict) with an operation that gives one number, over the samples
 * its sub-experiment recorded.
 */
import { OperationError, applyOperation, sliceRange } from './operations.js'
import { isRangeOperation, readOperation, readPredictionItem } from './predictionValidation.js'
import { isMapping } from './protocolShapes.js'

/**
 * Reads an operand's samples in a sub-experiment. A constant, a number or one sample, is one sample, as libcuflynx's
 * Myokit helper gives a variable it doesn't log.
 *
 * @param {Object} segment - `{time, values}`.
 * @param {string} operand
 * @returns {ArrayLike<number>|null} Null when it wasn't recorded.
 */
function readOperand(segment, operand) {
  const values = segment.values?.[operand]
  if (typeof values === 'number') return [values]
  return values != null && typeof values.length === 'number' ? values : null
}

/**
 * Replaces the operation_kwargs values that name an earlier feature with its value, as CA resolves them.
 *
 * @param {Object} kwargs
 * @param {Map<string, number>} computed
 * @returns {Object}
 */
const resolveKwargs = (kwargs, computed) => Object.fromEntries(Object.entries(kwargs ?? {}).map(([key, value]) => [key, typeof value === 'string' && computed.has(value) ? computed.get(value) : value]))

/**
 * Whether an operation's range takes no samples: a mean over none is NaN, where a maximum or minimum raises.
 *
 * @param {string} operation
 * @param {ArrayLike<number>} values
 * @param {Object} kwargs
 * @param {Map<string, number>} computed - The features before it, by name, which a fraction may name.
 * @returns {boolean}
 */
function isEmptyRange(operation, values, kwargs, computed) {
  if (!isRangeOperation(operation)) return false
  try {
    return sliceRange(values, resolveKwargs(kwargs, computed)).length === 0
  } catch (error) {
    if (error instanceof OperationError) return false
    throw error
  }
}

/**
 * Computes a run's features: each prediction item with an operation that isn't a series, over its sub-experiment (its
 * subexperiment_idx, else its experiment's last), in the order of prediction_items, as CA's features_from_segments
 * does. An operation_kwargs value naming an earlier feature is its value.
 *
 * Each sub-experiment's samples are its own, as CA records them: from the one taken once its values are set, to its
 * end. A run that joins its sub-experiments into one trace must split them so.
 *
 * @param {Object} document - The obs_data document.
 * @param {Array<Array<{time?: ArrayLike<number>, values: Object<string, ArrayLike<number>|number>}|null>>}
 *   segmentsByExperiment - `[experiment][sub]`: each operand's samples, by its name in `operands`. A sub-experiment
 *   that wasn't run is left out, or null.
 * @returns {Array<{index: number, name: string, group: string, experiment: number, subexperiment: number,
 *   operation: string, unit: string, kwargs: Object, value: number, error: string|null}>} By place in
 *   prediction_items. `group` is the item_name_for_plotting, as CA defaults it. `kwargs` are its operation_kwargs,
 *   those naming an earlier feature as its value, for sliceRangeBounds. `value` is NaN, and `error` says why, where
 *   CA raises or the sub-experiment wasn't run (CA gives NaN); a mean over no samples is NaN, as numpy's, with an
 *   error.
 */
export function computeFeatures(document, segmentsByExperiment) {
  const items = Array.isArray(document?.prediction_items) ? document.prediction_items : []
  const simTimes = document?.protocol_info?.sim_times
  const itemNames = new Set(items.filter(isMapping).map((item) => String(item.data_item_name ?? item.variable)))
  const computed = new Map()
  const features = []
  items.forEach((item, index) => {
    if (!isMapping(item) || readOperation(item.operation) == null || item.data_type === 'series') return
    const { error: readError, entry } = readPredictionItem(item, index, simTimes)
    const name = String(entry?.data_item_name ?? item.data_item_name ?? item.variable ?? '')
    const feature = {
      index,
      name,
      group: entry?.item_name_for_plotting ?? '',
      experiment: Number(entry?.experiment_idx ?? item.experiment_idx ?? 0),
      subexperiment: entry?.subexperiment_idx ?? null,
      operation: readOperation(item.operation),
      unit: entry?.unit ?? item.unit ?? '',
      kwargs: resolveKwargs(entry?.operation_kwargs ?? item.operation_kwargs, computed),
      value: NaN,
      error: readError,
    }
    features.push(feature)
    if (!readError) computeFeature(feature, entry.operands, entry.operation_kwargs, segmentsByExperiment, { computed, itemNames })
  })
  return features
}

/**
 * Computes a feature over its sub-experiment's samples, recording its value for the features after it.
 *
 * @param {Object} feature - Its value and error set here.
 * @param {string[]} operandNames
 * @param {Object} kwargs - Its operation_kwargs, as written.
 * @param {Array<Array<Object|null>>} segmentsByExperiment
 * @param {Object} options
 * @param {Map<string, number>} options.computed - The features computed before it, by name.
 * @param {Set<string>} options.itemNames - The names it may refer to.
 * @param {string} [options.kind] - 'prediction item' or 'data item', for messages.
 */
function computeFeature(feature, operandNames, kwargs, segmentsByExperiment, { computed, itemNames, kind }) {
  const segment = segmentsByExperiment?.[feature.experiment]?.[feature.subexperiment]
  if (!segment) {
    feature.error = `Sub-experiment ${feature.subexperiment + 1} of experiment ${feature.experiment + 1} wasn't run.`
    return
  }
  const operands = operandNames.map((operand) => readOperand(segment, operand))
  const missing = operandNames.filter((_, position) => !operands[position])
  if (missing.length) {
    feature.error = `${missing.join(', ')} ${missing.length === 1 ? "wasn't" : "weren't"} recorded.`
    return
  }
  try {
    feature.value = applyOperation(feature.operation, operands, kwargs, { name: feature.name, computed, itemNames, kind })
  } catch (error) {
    if (!(error instanceof OperationError)) throw error
    feature.error = error.message
    return
  }
  if (Number.isNaN(feature.value) && isEmptyRange(feature.operation, operands[0], kwargs, computed)) feature.error = 'Its range takes no samples.'
  computed.set(feature.name, feature.value)
}

/**
 * Lists a document's data items: its data_items (or the legacy data_item), or the bare list it is.
 *
 * @param {Object|Array|null} document
 * @returns {Array}
 */
function listDataItems(document) {
  const items = Array.isArray(document) ? document : isMapping(document) ? (document.data_items ?? document.data_item) : null
  return Array.isArray(items) ? items : []
}

/**
 * Computes the features a run gives a document's data items, as circulatory_autogen #536 does when it scores them
 * (paramID's get_obs_output_dict): each constant item with an operation, over its sub-experiment (its
 * subexperiment_idx, else the first), its operands the variables in `operands`. CA visits the sub-experiments in
 * order, each experiment's in turn, and in each its items in the order of data_items, so an operation_kwargs value may
 * name an item computed before it there, or in an earlier sub-experiment.
 *
 * @param {Object|Array} document - The obs_data document, or a bare list of data items.
 * @param {Array<Array<Object|null>>} segmentsByExperiment - As computeFeatures takes them.
 * @returns {Array<{index: number, name: string, experiment: number, subexperiment: number, operation: string,
 *   unit: string, kwargs: Object, value: number, error: string|null}>} By place in data_items, as computeFeatures
 *   gives them. An item whose operation the kit doesn't compute has its error.
 */
export function computeDataItemFeatures(document, segmentsByExperiment) {
  const items = listDataItems(document)
  const itemNames = new Set(items.filter(isMapping).map((item) => String(item.data_item_name ?? item.variable)))
  const features = items.flatMap((item, index) => {
    const dataType = isMapping(item) ? (item.data_type ?? 'constant') : null
    const operation = isMapping(item) ? readOperation(item.operation) : null
    if (dataType !== 'constant' || operation == null) return []
    return [
      {
        index,
        name: String(item.data_item_name ?? item.variable ?? ''),
        experiment: Number(item.experiment_idx ?? 0),
        subexperiment: Number(item.subexperiment_idx ?? 0),
        operation,
        unit: typeof item.unit === 'string' ? item.unit : '',
        kwargs: {},
        value: NaN,
        error: null,
      },
    ]
  })
  const computed = new Map()
  const order = [...features].sort((a, b) => a.experiment - b.experiment || a.subexperiment - b.subexperiment || a.index - b.index)
  for (const feature of order) {
    const item = items[feature.index]
    const kwargs = isMapping(item.operation_kwargs) ? item.operation_kwargs : {}
    feature.kwargs = resolveKwargs(kwargs, computed)
    const operands = Array.isArray(item.operands) ? item.operands.map(String) : []
    computeFeature(feature, operands, kwargs, segmentsByExperiment, { computed, itemNames, kind: 'data item' })
  }
  return features
}
