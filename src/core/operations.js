/**
 * Computes the operations a feature can take as circulatory_autogen's own funcs do (operation_funcs.py,
 * operation_funcs_user.py, numpy's math backend): the same samples, the same NaNs and errors, and means summed in
 * numpy's order, so each value is the one CA gives, to the last bit.
 */
import { formatPythonRepr } from './pythonFormat.js'

// numpy's pairwise summation: below 8 values a plain sum, up to its block of 128 eight running sums, else halves.
const UNROLL = 8
const BLOCK = 128
// The keyword arguments circulatory_autogen supplies itself, which operation_kwargs may not set.
const RESERVED_KWARGS = ['series_output']

/** An operation that can't be computed, as CA raises; `pythonType` names the error CA raises. */
export class OperationError extends Error {
  /**
   * @param {string} message
   * @param {string} [pythonType] - 'ValueError' or 'TypeError'.
   */
  constructor(message, pythonType = 'ValueError') {
    super(message)
    this.name = 'OperationError'
    this.pythonType = pythonType
  }
}

/**
 * Sums values in numpy's order (pairwise_sum, loops_utils.h), so a mean rounds as numpy's does.
 *
 * @param {ArrayLike<number>} values
 * @param {number} [start]
 * @param {number} [count]
 * @returns {number}
 */
export function sumPairwise(values, start = 0, count = values.length - start) {
  if (count < UNROLL) {
    let sum = 0
    for (let index = 0; index < count; index++) sum += values[start + index]
    return sum
  }
  if (count <= BLOCK) {
    const sums = Array.from({ length: UNROLL }, (_, lane) => values[start + lane])
    let index = UNROLL
    for (; index < count - (count % UNROLL); index += UNROLL) {
      for (let lane = 0; lane < UNROLL; lane++) sums[lane] += values[start + index + lane]
    }
    let sum = sums[0] + sums[1] + (sums[2] + sums[3]) + (sums[4] + sums[5] + (sums[6] + sums[7]))
    for (; index < count; index++) sum += values[start + index]
    return sum
  }
  let half = Math.trunc(count / 2)
  half -= half % UNROLL
  return sumPairwise(values, start, half) + sumPairwise(values, start + half, count - half)
}

/**
 * The mean of values as np.mean gives it: NaN for none. numpy's sum starts from 0, so negative zeros sum to 0.
 *
 * @param {ArrayLike<number>} values
 * @returns {number}
 */
export const computeMean = (values) => (0 + sumPairwise(values)) / values.length

/**
 * Reduces values to their greatest or least as np.max and np.min do: NaN when any is, an error when there are none.
 *
 * @param {ArrayLike<number>} values
 * @param {boolean} isMax
 * @returns {number}
 * @throws {OperationError} For no values.
 */
function reduceExtreme(values, isMax) {
  if (!values.length) throw new OperationError(`zero-size array to reduction operation ${isMax ? 'maximum' : 'minimum'} which has no identity`)
  let extreme = values[0]
  for (let index = 1; index < values.length; index++) extreme = isMax ? Math.max(extreme, values[index]) : Math.min(extreme, values[index])
  return extreme
}

const computeMax = (values) => reduceExtreme(values, true)
const computeMin = (values) => reduceExtreme(values, false)
const computeMaxMinusMin = (values) => computeMax(values) - computeMin(values)

// Python's int() of a string in base 10: digits of any script, single underscores between them, a sign, and
// whitespace around.
const PYTHON_INT = /^\s*([+-]?)(\p{Nd}+(?:_\p{Nd}+)*)\s*$/u
const DIGIT = /\p{Nd}/u

/**
 * Reads a digit of any script as its value: Unicode places each script's 0 to 9 in a run of their own.
 *
 * @param {string} digit
 * @returns {number}
 */
function readDigit(digit) {
  const code = digit.codePointAt(0)
  let before = 0
  while (DIGIT.test(String.fromCodePoint(code - before - 1))) before++
  return before % 10
}

/**
 * Reads a string fraction as Python's `int(fraction * (n - 1))` does: the string repeated n - 1 times, then read as
 * an integer. Only digits survive the repeating: '0' gives 0, another the whole run's digits, past any end.
 *
 * @param {string} fraction
 * @param {number} last - n - 1.
 * @returns {number} ±Infinity for one past 15 digits, which a slice stops at the end anyway.
 * @throws {OperationError} With int()'s ValueError, its literal cut to 200 characters as CPython does.
 */
function readStringIndex(fraction, last) {
  const repeated = fraction.repeat(Math.max(last, 0))
  const match = PYTHON_INT.exec(repeated)
  if (!match) {
    const shown = fraction.repeat(Math.max(0, Math.min(last, Math.ceil(201 / Math.max(fraction.length, 1)))))
    throw new OperationError(`invalid literal for int() with base 10: ${formatPythonRepr(shown).slice(0, 200)}`)
  }
  const digits = Array.from(match[2].replaceAll('_', ''), readDigit).join('').replace(/^0+/, '')
  const sign = match[1] === '-' ? -1 : 1
  return digits.length > 15 ? sign * Infinity : sign * Number(digits || 0)
}

/**
 * Reads a fraction as Python's `int(fraction * (n - 1))`: truncated towards 0, a bool as 0 or 1, and a string
 * repeated, as Python multiplies one (readStringIndex).
 *
 * @param {*} fraction
 * @param {number} last - n - 1.
 * @returns {number}
 * @throws {OperationError} For a fraction that isn't a finite number or such a string, as int() raises.
 */
function readIndex(fraction, last) {
  if (typeof fraction === 'string') return readStringIndex(fraction, last)
  if (typeof fraction !== 'number' && typeof fraction !== 'boolean') {
    throw new OperationError(`The range's fraction must be a number, got ${formatPythonRepr(fraction ?? null)}.`, 'TypeError')
  }
  const product = Number(fraction) * last
  if (!Number.isFinite(product)) throw new OperationError(`cannot convert float ${Number.isNaN(product) ? 'NaN' : 'infinity'} to integer`)
  return Math.trunc(product)
}

/**
 * Finds the samples `x[int(start_frac * (n - 1)):int(end_frac * (n - 1))]` takes of n, as Python slices them: a
 * negative index counts from the end, and an index past either end stops there. A host draws a feature over them.
 *
 * @param {number} count - n.
 * @param {Object} [kwargs] - With start_frac and end_frac, as numbers or as an item's operation_kwargs has them; CA's
 *   defaults are 0 and 1.
 * @returns {{start: number, end: number}} The first sample's index, and the one after the last; equal when it takes
 *   none.
 * @throws {OperationError} For a fraction Python can't read as an index.
 */
export function sliceRangeBounds(count, { start_frac: startFrac = 0, end_frac: endFrac = 1 } = {}) {
  const clamp = (index) => Math.min(Math.max(index < 0 ? index + count : index, 0), count)
  const start = clamp(readIndex(startFrac, count - 1))
  const end = clamp(readIndex(endFrac, count - 1))
  return { start, end: Math.max(start, end) }
}

/**
 * Takes the samples `x[int(start_frac * (n - 1)):int(end_frac * (n - 1))]`, as sliceRangeBounds finds them.
 *
 * @param {ArrayLike<number>} values
 * @param {Object} kwargs - With start_frac and end_frac; CA's defaults are 0 and 1.
 * @returns {ArrayLike<number>}
 */
export function sliceRange(values, kwargs = {}) {
  const { start, end } = sliceRangeBounds(values.length, kwargs)
  return Array.prototype.slice.call(values, start, end)
}

/**
 * Makes an operation over a range from one over all of a series.
 *
 * @param {Function} reduce
 * @returns {Function}
 */
const inRange =
  (reduce) =>
  (values, kwargs = {}) =>
    reduce(sliceRange(values, kwargs))

/**
 * Reads a peak's least height as scipy's find_peaks takes `height`: none, or a number (a bool as 0 or 1). A list,
 * which numpy reads as each peak's own, isn't.
 *
 * @param {*} height
 * @returns {number|null}
 * @throws {OperationError} For another, which numpy can't compare with the heights, and a list.
 */
function readHeight(height) {
  if (height == null) return null
  if (typeof height === 'number' || typeof height === 'boolean') return Number(height)
  throw new OperationError(`spike_min_thresh must be a number, got ${formatPythonRepr(height)}.`, 'TypeError')
}

/**
 * Finds the first peak of values as scipy's find_peaks does: a sample above the one before, and above the one after
 * once past any run of equal samples, a run's peak its middle (rounded down); the first and last samples are never
 * peaks. Of those, the first at least as high as `least`.
 *
 * @param {ArrayLike<number>} values
 * @param {number|null} least
 * @returns {number} Its index, or -1 for none.
 */
function findFirstPeak(values, least) {
  const last = values.length - 1
  for (let index = 1; index < last; index++) {
    if (!(values[index - 1] < values[index])) continue
    let ahead = index + 1
    while (ahead < last && values[ahead] === values[index]) ahead++
    if (values[ahead] < values[index]) {
      const peak = Math.trunc((index + ahead - 1) / 2)
      if (least === null || least <= values[peak]) return peak
      index = ahead
    }
  }
  return -1
}

/**
 * The time of the first peak, as CA's first_peak_time gives it: of the sub-experiment's own time, so from the start
 * of its pre_time; its last time when there is no peak.
 *
 * @param {ArrayLike<number>} times
 * @param {ArrayLike<number>} values
 * @param {Object} [kwargs] - With spike_min_thresh, the least height of a peak.
 * @returns {number}
 * @throws {OperationError} For a peak past the times, or no times, as indexing them raises.
 */
function computeFirstPeakTime(times, values, { spike_min_thresh: height = null } = {}) {
  const peak = findFirstPeak(values, readHeight(height))
  const index = peak < 0 ? times.length - 1 : peak
  if (index < 0 || index >= times.length) throw new OperationError(`index ${peak < 0 ? -1 : index} is out of bounds for axis 0 with size ${times.length}`, 'IndexError')
  return times[index]
}

// The operations, by CA's names: each takes its operands' series and its keyword arguments, the operands it reads, by
// CA's names for them, and the keyword arguments it accepts.
const OPERATIONS = {
  max: { compute: computeMax, operands: ['x'], kwargs: [] },
  min: { compute: computeMin, operands: ['x'], kwargs: [] },
  mean: { compute: computeMean, operands: ['x'], kwargs: [] },
  max_minus_min: { compute: computeMaxMinusMin, operands: ['x'], kwargs: [] },
  max_in_range: { compute: inRange(computeMax), operands: ['x'], kwargs: ['start_frac', 'end_frac'] },
  min_in_range: { compute: inRange(computeMin), operands: ['x'], kwargs: ['start_frac', 'end_frac'] },
  mean_in_range: { compute: inRange(computeMean), operands: ['x'], kwargs: ['start_frac', 'end_frac'] },
  max_minus_min_in_range: { compute: inRange(computeMaxMinusMin), operands: ['x'], kwargs: ['start_frac', 'end_frac'] },
  first_peak_time: { compute: computeFirstPeakTime, operands: ['t', 'V'], kwargs: ['spike_min_thresh'] },
}
export const COMPUTED_OPERATIONS = Object.keys(OPERATIONS)

/**
 * Whether the kit computes an operation.
 *
 * @param {*} operation
 * @returns {boolean}
 */
export const isComputedOperation = (operation) => typeof operation === 'string' && Object.hasOwn(OPERATIONS, operation)

/**
 * Checks an item's operation_kwargs against its operation, as CA's check_operation_kwargs does.
 *
 * @param {string} operation
 * @param {Object} kwargs
 * @param {string} name - The item's data_item_name.
 * @param {number} count - The operands given, which fill its first arguments.
 * @throws {OperationError} With CA's message, but for its "Did you mean" hint.
 */
function checkKwargs(operation, kwargs, name, count) {
  const where = `data_item '${name}'`
  const { operands, kwargs: accepted } = OPERATIONS[operation]
  const filled = operands.slice(0, count)
  for (const key of Object.keys(kwargs)) {
    if (RESERVED_KWARGS.includes(key)) {
      throw new OperationError(
        `Invalid 'operation_kwargs' key '${key}' in ${where}: '${key}' is set by circulatory_autogen when it calls the operation func ` +
          `'${operation}' and must not be given in obs_data.json. Remove it from 'operation_kwargs'.`
      )
    }
    if (filled.includes(key)) {
      throw new OperationError(
        `Invalid 'operation_kwargs' key '${key}' in ${where}: the operation func '${operation}' already receives '${key}' positionally from the ` +
          `data_item's 'operands' (operands fill ${formatPythonRepr(filled)}). Remove '${key}' from 'operation_kwargs', or remove the corresponding entry from 'operands'.`
      )
    }
    if (!accepted.includes(key) && !operands.includes(key)) {
      throw new OperationError(
        `Invalid 'operation_kwargs' key '${key}' in ${where}: the operation func '${operation}' has no keyword argument '${key}'. ` +
          `Accepted keyword arguments are: ${formatPythonRepr([...accepted, ...operands].sort())}. Fix the key in the data_item's ` +
          `'operation_kwargs' in obs_data.json, or add '${key}' as a keyword argument of '${operation}'.`
      )
    }
  }
}

/**
 * Applies an operation to an item's operands, as CA's evaluate_feature does: its operation_kwargs checked, those that
 * name an earlier item replaced by its value, then the operation over its operands.
 *
 * @param {string} operation - One of COMPUTED_OPERATIONS.
 * @param {Array<ArrayLike<number>>} operands - Each operand's samples over the sub-experiment.
 * @param {Object} [kwargs] - The item's operation_kwargs.
 * @param {Object} [options]
 * @param {string} [options.name] - The item's data_item_name, for messages.
 * @param {Map<string, number>} [options.computed] - The values of the items computed before it, by name.
 * @param {Set<string>} [options.itemNames] - Every item's name: one not yet computed can't be used.
 * @param {string} [options.kind] - What the item is, for messages: 'prediction item' or 'data item'.
 * @returns {number}
 * @throws {OperationError} Where CA raises.
 */
export function applyOperation(operation, operands, kwargs = {}, { name = 'item', computed = new Map(), itemNames = new Set(), kind = 'prediction item' } = {}) {
  if (!isComputedOperation(operation)) throw new OperationError(`${kind} '${name}': operation ${formatPythonRepr(operation)} is not one protocol-kit computes.`)
  const raw = kwargs && typeof kwargs === 'object' && !Array.isArray(kwargs) ? kwargs : {}
  checkKwargs(operation, raw, name, operands.length)
  const resolved = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && computed.has(value)) resolved[key] = computed.get(value)
    else if (typeof value === 'string' && itemNames.has(value)) {
      throw new OperationError(
        `data_item '${name}': 'operation_kwargs' key '${key}' references data_item '${value}', which has not been computed yet. ` +
          `References are resolved in order, so the item referenced must come earlier in 'data_items'.`
      )
    } else resolved[key] = value
  }
  const count = OPERATIONS[operation].operands.length
  if (operands.length !== count) {
    throw new OperationError(`${kind} '${name}': ${operation} takes ${count === 1 ? 'one operand' : `${count} operands`}, got ${operands.length}.`, 'TypeError')
  }
  return OPERATIONS[operation].compute(...operands, resolved)
}
