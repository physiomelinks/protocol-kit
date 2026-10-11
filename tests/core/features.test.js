import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { computeDataItemFeatures, computeFeatures } from '../../src/core/features.js'
import { sliceRangeBounds } from '../../src/core/operations.js'

const RESOURCES = join(__dirname, '../resources')
// A run's features as circulatory_autogen computes them (scripts/generate_operation_vectors.py): its prediction items'
// by features_from_segments, its data items' as its cost loop does.
const { features: VECTORS, data_item_features: DATA_VECTORS } = JSON.parse(readFileSync(join(RESOURCES, 'operation-vectors.json'), 'utf8'))

/**
 * Reads a series as the vectors write it: float64 bytes, little-endian, in base64.
 *
 * @param {string} encoded
 * @returns {Float64Array}
 */
function decodeSeries(encoded) {
  const bytes = Buffer.from(encoded, 'base64')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Float64Array.from({ length: bytes.byteLength / 8 }, (_, index) => view.getFloat64(index * 8, true))
}

/**
 * Reads the vectors' segments as computeFeatures takes them.
 *
 * @param {Array<Array<Object>>} segments
 * @returns {Array<Array<{values: Object}>>}
 */
const readSegments = (segments) => segments.map((subs) => subs.map((segment) => ({ values: Object.fromEntries(Object.entries(segment).map(([name, encoded]) => [name, decodeSeries(encoded)])) })))
const SEGMENTS = readSegments(VECTORS.segments)
const DATA_SEGMENTS = readSegments(DATA_VECTORS.segments)

describe('computeFeatures', () => {
  it("gives CA's features of a run, to the bit, each over its own sub-experiment", () => {
    const features = computeFeatures(VECTORS.document, SEGMENTS)
    expect(features.map(({ name, experiment, subexperiment, value }) => ({ name, segment: [experiment, subexperiment], value }))).toEqual(VECTORS.features)
    expect(features.every(({ error }) => error === null)).toBe(true)
  })

  it("gives each feature's kwargs with the features they name as their values", () => {
    const features = computeFeatures(VECTORS.document, SEGMENTS)
    const late = features.find(({ name }) => name === 'V_late_max')
    expect(late.kwargs).toEqual({ start_frac: 0.4, end_frac: 1 })
    expect(features[0].kwargs).toEqual({ start_frac: 0, end_frac: 0.2 })
  })

  it('groups features as CA names them for plotting, with their units and places', () => {
    const [peak, , step, , hold] = computeFeatures(VECTORS.document, SEGMENTS)
    expect(peak).toMatchObject({ index: 1, name: 'I_peak_e0', group: 'I_peak', operation: 'min_in_range', unit: 'uA_per_cm2' })
    expect(step).toMatchObject({ group: 'V_step', experiment: 0, subexperiment: 1, value: -40 })
    // Without an item_name_for_plotting, the first operand.
    expect(hold.group).toBe('membrane/V')
  })

  it("takes a constant given as a number, and says what wasn't run or recorded", () => {
    const document = {
      protocol_info: { pre_times: [0, 0], sim_times: [[1], [1]], params_to_change: {} },
      prediction_items: [
        { data_item_name: 'g', operands: ['p/g'], unit: 'mS', operation: 'mean' },
        { data_item_name: 'V_max', operands: ['m/V'], unit: 'mV', operation: 'max' },
        { data_item_name: 'V_max_e1', operands: ['m/V'], unit: 'mV', operation: 'max', experiment_idx: 1 },
        { data_item_name: 'V_series', operands: ['m/V'], unit: 'mV', operation: 'max', data_type: 'series' },
      ],
    }
    const features = computeFeatures(document, [[{ values: { 'p/g': 0.12 } }]])
    expect(features.map(({ name, value, error }) => [name, value, error])).toEqual([
      ['g', 0.12, null],
      ['V_max', NaN, "m/V wasn't recorded."],
      ['V_max_e1', NaN, "Sub-experiment 1 of experiment 2 wasn't run."],
    ])
  })

  it("gives a mean over no samples as NaN, as numpy does, and a maximum over none CA's error", () => {
    const document = {
      protocol_info: { pre_times: [0], sim_times: [[1]], params_to_change: {} },
      prediction_items: [
        { data_item_name: 'a', operands: ['m/V'], unit: 'mV', operation: 'mean_in_range', operation_kwargs: { start_frac: 0, end_frac: 0.01 } },
        { data_item_name: 'b', operands: ['m/V'], unit: 'mV', operation: 'max_in_range', operation_kwargs: { start_frac: 0, end_frac: 0.01 } },
        { data_item_name: 'c', operands: ['m/V'], unit: 'mV', operation: 'max', experiment_idx: 3 },
      ],
    }
    const features = computeFeatures(document, [[{ values: { 'm/V': [1, 2, 3] } }]])
    expect(features.map(({ value, error }) => [value, error])).toEqual([
      [NaN, 'Its range takes no samples.'],
      [NaN, 'zero-size array to reduction operation maximum which has no identity'],
      [NaN, "prediction_items[2] ('c'): experiment_idx 3 is not an experiment of protocol_info, which has 1."],
    ])
  })
})

describe('computeDataItemFeatures', () => {
  it("gives CA's features of a run's data items, to the bit, each over its own sub-experiment", () => {
    const features = computeDataItemFeatures(DATA_VECTORS.document, DATA_SEGMENTS)
    expect(features.map(({ name, value }) => ({ name, value }))).toEqual(DATA_VECTORS.features)
    expect(features.every(({ error }) => error === null)).toBe(true)
  })

  it('resolves a reference to an item computed before it, in an earlier sub-experiment, for its bounds', () => {
    const features = computeDataItemFeatures(DATA_VECTORS.document, DATA_SEGMENTS)
    const late = features.find(({ name }) => name === 'V_peak_e1')
    expect(late).toMatchObject({ index: 6, experiment: 1, subexperiment: 0, operation: 'max_minus_min_in_range', unit: 'mV', kwargs: { start_frac: 0.4, end_frac: 0.9 } })
    expect(sliceRangeBounds(DATA_SEGMENTS[1][0].values['membrane/V'].length, late.kwargs)).toEqual({ start: 40, end: 90 })
  })

  it('takes the first sub-experiment by default, a bare list, and only constants with an operation', () => {
    const items = [
      { data_item_name: 'V_max', data_type: 'constant', unit: 'mV', operands: ['m/V'], operation: 'max', value: 1, std: 1 },
      { data_item_name: 'V_trace', data_type: 'series', unit: 'mV', operands: ['m/V'], value: [1, 2], std: 1, obs_dt: 1 },
      { data_item_name: 'V_raw', unit: 'mV', operands: ['m/V'], value: 1, std: 1 },
      { data_item_name: 'V_diff', unit: 'mV', operands: [], operation: 'calculate_two_observable_difference', value: 1, std: 1 },
    ]
    const features = computeDataItemFeatures(items, [[{ values: { 'm/V': [1, 3, 2] } }, { values: { 'm/V': [9] } }]])
    expect(features.map(({ name, subexperiment, value, error }) => [name, subexperiment, value, error])).toEqual([
      ['V_max', 0, 3, null],
      ['V_diff', 0, NaN, "data item 'V_diff': operation 'calculate_two_observable_difference' is not one protocol-kit computes."],
    ])
  })

  it('refuses a reference to an item computed after it, and says what was not run', () => {
    const document = {
      protocol_info: { pre_times: [0], sim_times: [[1, 1]], params_to_change: {} },
      data_items: [
        { data_item_name: 'late', unit: 'mV', operands: ['m/V'], operation: 'max_in_range', operation_kwargs: { start_frac: 'f' }, experiment_idx: 0, subexperiment_idx: 0 },
        { data_item_name: 'f', unit: '1', operands: ['f/f'], operation: 'mean', experiment_idx: 0, subexperiment_idx: 1 },
        { data_item_name: 'gone', unit: 'mV', operands: ['m/V'], operation: 'max', experiment_idx: 1, subexperiment_idx: 0 },
      ],
    }
    const features = computeDataItemFeatures(document, [[{ values: { 'm/V': [1, 2] } }, { values: { 'f/f': [0.5] } }]])
    expect(features.map(({ value, error }) => [value, error])).toEqual([
      [NaN, "data_item 'late': 'operation_kwargs' key 'start_frac' references data_item 'f', which has not been computed yet. References are resolved in order, so the item referenced must come earlier in 'data_items'."],
      [0.5, null],
      [NaN, "Sub-experiment 1 of experiment 2 wasn't run."],
    ])
  })
})
