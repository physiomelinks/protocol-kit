import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseObsData, serialiseObsData } from '../../src/core/obsDataDocument.js'
import {
  addPredictionItem,
  buildPredictionItem,
  createPredictionItem,
  findFreeItemName,
  isValidationData,
  listPredictionItems,
  readPredictionItemRow,
  removePredictionItem,
  updatePredictionItem,
} from '../../src/core/predictionItems.js'
import { addSubExperiment, findObservationsAt, moveExperiment, removeExperiment, removeSubExperiment } from '../../src/core/protocolEditing.js'
import { readPredictionItemsAsCircAutogen, validatePredictionItems } from '../../src/core/predictionValidation.js'

const RESOURCES = join(__dirname, '../resources')
const readText = (fileName) => readFileSync(join(RESOURCES, fileName), 'utf8')
const readFixture = (fileName) => JSON.parse(readText(fileName))

const DOCUMENT = {
  protocol_info: { pre_times: [0, 0, 0], sim_times: [[1, 2], [3, 4], [5]], params_to_change: {}, experiment_labels: ['Control', 'Half g_Na', ' Wash-out!'] },
  data_items: [{ data_item_name: 'V_rest', data_type: 'constant', unit: 'mV', operands: ['membrane/V'], value: -80, std: 1 }],
}
// An output as protocol-kit 0.2 to 0.4 wrote it: one item per experiment, sharing item_name_for_plotting.
const peak = (name, experiment) => ({
  data_item_name: name,
  operands: ['i_Na/i_Na'],
  unit: 'uA_per_cm2',
  operation: 'min_in_range',
  operation_kwargs: { start_frac: 0, end_frac: 0.2 },
  experiment_idx: experiment,
  subexperiment_idx: 1,
  item_name_for_plotting: 'I_peak',
  trace_name_for_plotting: 'Sodium current',
})
const OUTPUTS_DOCUMENT = {
  ...DOCUMENT,
  prediction_items: [
    peak('I_peak_Control', 0),
    peak('I_peak_Half_g_Na', 1),
    { data_item_name: 'V_rest_2', operands: ['membrane/V'], unit: 'mV', experiment_idx: 2, item_name_for_plotting: 'V_rest' },
    { data_item_name: 'I_late', operands: ['i_Na/i_Na'], unit: 'uA_per_cm2', operation: 'max', experiment_idx: 1, data_type: 'constant', value: -0.5, std: 0.1 },
  ],
}

/**
 * Lists a document's prediction items as `[name, experiment, sub-experiment]`.
 *
 * @param {Object} document
 * @returns {Array}
 */
const placesOf = (document) => document.prediction_items.map((item) => [item.data_item_name, item.experiment_idx, item.subexperiment_idx])

describe('readPredictionItemRow', () => {
  it("reads an item as CUFLynx's row: its variable, unit, labels, experiment and sub-experiment, and operation", () => {
    expect(readPredictionItemRow(peak('I_peak_Control', 0))).toEqual({
      name: 'I_peak_Control',
      operands: ['i_Na/i_Na'],
      unit: 'uA_per_cm2',
      traceName: 'Sodium current',
      itemName: 'I_peak',
      experiment: 0,
      subexperiment: 1,
      operation: 'min_in_range',
      operationKwargs: { start_frac: 0, end_frac: 0.2 },
      isValidationData: false,
      original: peak('I_peak_Control', 0),
    })
  })

  it('reads the last sub-experiment as null, no operation as empty, legacy keys as their replacements, and held-out data', () => {
    const row = readPredictionItemRow({ variable: 'membrane/V', name_for_plotting: 'Voltage', unit: 'mV', operation: 'None', value: [1, 2], std: 0.5 })
    expect(row).toMatchObject({ name: 'membrane/V', operands: ['membrane/V'], traceName: 'Voltage', experiment: 0, subexperiment: null, operation: '', isValidationData: true })
    expect(isValidationData({ data_type: 'series' })).toBe(true)
    expect(isValidationData({ data_item_name: 'a' })).toBe(false)
  })
})

describe('buildPredictionItem', () => {
  it('writes a new item whole, in the order CA #536 reads it, with no kwargs for none or an operation spelled as none', () => {
    const item = buildPredictionItem({ ...createPredictionItem({ experiment: 1 }), name: 'I_peak', operands: ['i_Na/i_Na', ''], unit: 'uA_per_cm2', subexperiment: 1, operation: 'max', itemName: 'Peak', traceName: 'I_Na' })
    expect(item).toEqual({ data_item_name: 'I_peak', operands: ['i_Na/i_Na'], unit: 'uA_per_cm2', operation: 'max', experiment_idx: 1, subexperiment_idx: 1, item_name_for_plotting: 'Peak', trace_name_for_plotting: 'I_Na' })
    expect(Object.keys(item)).toEqual(['data_item_name', 'operands', 'unit', 'operation', 'experiment_idx', 'subexperiment_idx', 'item_name_for_plotting', 'trace_name_for_plotting'])
    const trace = buildPredictionItem({ ...createPredictionItem(), name: 'V', operands: ['m/V'], operationKwargs: { start_frac: 0 } })
    expect(trace).toEqual({ data_item_name: 'V', operands: ['m/V'], unit: 'dimensionless', experiment_idx: 0 })
  })

  it('writes an item read back as it was, held-out data and keys it does not know of included', () => {
    const item = { ...peak('I_late', 1), data_type: 'constant', value: -0.5, std: 0.1, x_note: 'kept' }
    expect(buildPredictionItem(readPredictionItemRow(item))).toEqual(item)
    expect(JSON.stringify(buildPredictionItem({ ...readPredictionItemRow(item), unit: 'nA' }))).toBe(JSON.stringify({ ...item, unit: 'nA' }))
  })

  it('writes legacy keys as their replacements, in their place, and the operands CA requires', () => {
    const item = buildPredictionItem(readPredictionItemRow({ variable: 'membrane/V', unit: 'mV', name_for_plotting: 'Voltage' }))
    expect(item).toEqual({ data_item_name: 'membrane/V', unit: 'mV', trace_name_for_plotting: 'Voltage', operands: ['membrane/V'] })
  })

  it('drops the kwargs with the operation, and the sub-experiment for the last', () => {
    const item = buildPredictionItem({ ...readPredictionItemRow(peak('a', 0)), operation: '', subexperiment: null })
    expect(item).not.toHaveProperty('operation')
    expect(item).not.toHaveProperty('operation_kwargs')
    expect(item).not.toHaveProperty('subexperiment_idx')
  })
})

describe('findFreeItemName', () => {
  it('gives a name no data or prediction item has, with _2, _3...', () => {
    const document = { ...DOCUMENT, prediction_items: [{ data_item_name: 'V' }, { data_item_name: 'V_2' }] }
    expect(findFreeItemName(document, 'I')).toBe('I')
    expect(findFreeItemName(document, 'V')).toBe('V_3')
    expect(findFreeItemName(document, 'V_rest')).toBe('V_rest_2')
    // An item's own name is free for it.
    expect(findFreeItemName(document, 'V_2', 1)).toBe('V_2')
    expect(findFreeItemName([{ data_item_name: 'a' }], 'a')).toBe('a_2')
  })
})

describe('addPredictionItem', () => {
  it('adds an item after the others, leaving the document given and the rest as they were', () => {
    const before = JSON.stringify(OUTPUTS_DOCUMENT)
    const edited = addPredictionItem(OUTPUTS_DOCUMENT, { ...createPredictionItem(), name: 'V', operands: ['membrane/V'], unit: 'mV' })
    expect(JSON.stringify(OUTPUTS_DOCUMENT)).toBe(before)
    expect(edited.prediction_items.slice(0, 4)).toEqual(OUTPUTS_DOCUMENT.prediction_items)
    expect(edited.prediction_items[4]).toEqual({ data_item_name: 'V', operands: ['membrane/V'], unit: 'mV', experiment_idx: 0 })
    expect(readPredictionItemsAsCircAutogen(edited).error).toBeNull()
  })

  it('names an unnamed item after its variable, apart from every other item, as CA requires', () => {
    let edited = addPredictionItem(DOCUMENT, { ...createPredictionItem(), operands: ['membrane/V'] })
    edited = addPredictionItem(edited, { ...createPredictionItem(), operands: ['membrane/V'] })
    expect(edited.prediction_items.map((item) => item.data_item_name)).toEqual(['membrane/V', 'membrane/V_2'])
    // Without a variable it stays unnamed, for CA's error to say so.
    expect(addPredictionItem(null, createPredictionItem()).prediction_items).toEqual([{ data_item_name: '', operands: [], unit: 'dimensionless', experiment_idx: 0 }])
  })

  it('makes a bare list of data items the data_items of a document', () => {
    expect(addPredictionItem([{ data_item_name: 'a' }], { ...createPredictionItem(), operands: ['m/V'] })).toEqual({
      data_items: [{ data_item_name: 'a' }],
      prediction_items: [{ data_item_name: 'm/V', operands: ['m/V'], unit: 'dimensionless', experiment_idx: 0 }],
    })
  })
})

describe('updatePredictionItem', () => {
  it('changes one item in its place, keeping its held-out data and other keys', () => {
    const edited = updatePredictionItem(OUTPUTS_DOCUMENT, 3, { operation: 'min', experiment: 2 })
    expect(edited.prediction_items[3]).toEqual({ ...OUTPUTS_DOCUMENT.prediction_items[3], operation: 'min', experiment_idx: 2 })
    expect(edited.prediction_items.slice(0, 3)).toEqual(OUTPUTS_DOCUMENT.prediction_items.slice(0, 3))
    expect(updatePredictionItem(OUTPUTS_DOCUMENT, 9, { unit: 'x' })).toBe(OUTPUTS_DOCUMENT)
  })

  it("renames it in the other items' kwargs, unless another item keeps the name", () => {
    const document = {
      ...DOCUMENT,
      prediction_items: [
        { data_item_name: 'f', operands: ['f/f'], unit: '1', operation: 'mean' },
        { data_item_name: 'V_late', operands: ['m/V'], unit: 'mV', operation: 'max_in_range', operation_kwargs: { start_frac: 'f', end_frac: 1 } },
      ],
    }
    expect(updatePredictionItem(document, 0, { name: 'f_late' }).prediction_items[1].operation_kwargs).toEqual({ start_frac: 'f_late', end_frac: 1 })
    const shared = { ...document, prediction_items: [...document.prediction_items, { data_item_name: 'f', operands: ['g/g'], unit: '1' }] }
    expect(updatePredictionItem(shared, 0, { name: 'f_late' }).prediction_items[1].operation_kwargs.start_frac).toBe('f')
  })

  it('names an item left unnamed after its variable, apart from the others', () => {
    const document = { ...DOCUMENT, prediction_items: [{ data_item_name: '', operands: [], unit: 'mV' }, { data_item_name: 'membrane/V', operands: ['membrane/V'], unit: 'mV' }] }
    expect(updatePredictionItem(document, 0, { operands: ['membrane/V'] }).prediction_items[0].data_item_name).toBe('membrane/V_2')
    expect(updatePredictionItem(document, 1, { name: '' }).prediction_items[1].data_item_name).toBe('membrane/V')
  })
})

describe('removePredictionItem', () => {
  it('removes one item, and nothing for a place with none', () => {
    expect(placesOf(removePredictionItem(OUTPUTS_DOCUMENT, 1))).toEqual([
      ['I_peak_Control', 0, 1],
      ['V_rest_2', 2, undefined],
      ['I_late', 1, undefined],
    ])
    expect(removePredictionItem(OUTPUTS_DOCUMENT, 4)).toBe(OUTPUTS_DOCUMENT)
    expect(removePredictionItem(OUTPUTS_DOCUMENT, -1)).toBe(OUTPUTS_DOCUMENT)
  })
})

describe('documents written by the Outputs of protocol-kit 0.2 to 0.4', () => {
  it.each([
    ['an output in two experiments, a trace and validation data', OUTPUTS_DOCUMENT],
    ['prediction_items_536_obs_data.json', readFixture('prediction_items_536_obs_data.json')],
  ])('%s: one row per item, saved back unchanged', (_, document) => {
    const rows = listPredictionItems(document)
    expect(rows.map(({ index, name }) => [index, name])).toEqual(document.prediction_items.map((item, index) => [index, item.data_item_name]))
    let saved = document
    for (const row of rows) saved = updatePredictionItem(saved, row.index, {})
    expect(serialiseObsData(saved)).toEqual(serialiseObsData(document))
  })

  it('saves the fixture back byte for byte', () => {
    const text = readText('prediction_items_536_obs_data.json')
    let { document } = parseObsData(text)
    for (const row of listPredictionItems(document)) document = updatePredictionItem(document, row.index, { ...row })
    expect(new TextDecoder().decode(serialiseObsData(document))).toBe(text)
  })

  it('edits one item of an output alone, the others keeping its definition', () => {
    const edited = updatePredictionItem(OUTPUTS_DOCUMENT, 1, { operationKwargs: { start_frac: 0.1, end_frac: 0.3 } })
    expect(edited.prediction_items[0]).toEqual(OUTPUTS_DOCUMENT.prediction_items[0])
    expect(edited.prediction_items[1].operation_kwargs).toEqual({ start_frac: 0.1, end_frac: 0.3 })
  })
})

describe('prediction items through edits of the protocol', () => {
  it('move with their experiments, and go with a removed one, renumbered', () => {
    expect(placesOf(moveExperiment(OUTPUTS_DOCUMENT, 0, 2))).toEqual([
      ['I_peak_Control', 2, 1],
      ['I_peak_Half_g_Na', 0, 1],
      ['V_rest_2', 1, undefined],
      ['I_late', 0, undefined],
    ])
    expect(findObservationsAt(OUTPUTS_DOCUMENT, 1)).toEqual(['I_peak_Half_g_Na', 'I_late'])
    expect(placesOf(removeExperiment(OUTPUTS_DOCUMENT, 1))).toEqual([
      ['I_peak_Control', 0, 1],
      ['V_rest_2', 1, undefined],
    ])
  })

  it('go with a removed sub-experiment, and those over the last follow it', () => {
    expect(placesOf(removeSubExperiment(OUTPUTS_DOCUMENT, 0, 1))).toEqual([
      ['I_peak_Half_g_Na', 1, 1],
      ['V_rest_2', 2, undefined],
      ['I_late', 1, undefined],
    ])
    const shifted = removeSubExperiment(OUTPUTS_DOCUMENT, 1, 0)
    expect(placesOf(shifted)[1]).toEqual(['I_peak_Half_g_Na', 1, 0])
    expect(validatePredictionItems(shifted).errors).toEqual([])
    expect(placesOf(addSubExperiment(OUTPUTS_DOCUMENT, 0))).toEqual(placesOf(OUTPUTS_DOCUMENT))
  })
})

describe('prediction items in a CUFLynx file', () => {
  it('leave its protocol_info and data items as they were, byte for byte', () => {
    const document = readFixture('br-1977_obs_data.json')
    let edited = addPredictionItem(document, { ...createPredictionItem(), operands: ['membrane/V'], unit: 'mV', operation: 'max' })
    edited = updatePredictionItem(edited, 0, { operation: 'max_in_range', operationKwargs: { start_frac: 0.5, end_frac: 1 } })
    for (const key of Object.keys(document)) expect(JSON.stringify(edited[key])).toBe(JSON.stringify(document[key]))
    expect(Object.keys(edited)).toEqual([...Object.keys(document), 'prediction_items'])
    expect(JSON.stringify(removePredictionItem(edited, 0).protocol_info)).toBe(JSON.stringify(document.protocol_info))
  })
})
