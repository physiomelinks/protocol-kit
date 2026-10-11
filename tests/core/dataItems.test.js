import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { addDataItem, buildDataItem, createDataItem, isRowDataItem, listDataItems, readDataItem, removeDataItem, updateDataItem } from '../../src/core/dataItems.js'
import { readObsDataOptions } from '../../src/core/dataItemVocabulary.js'
import { readDataItemsAsCircAutogen } from '../../src/core/dataItemValidation.js'
import { removeSubExperiment } from '../../src/core/protocolEditing.js'

const RESOURCES = join(__dirname, '../resources')
const readFixture = (fileName) => JSON.parse(readFileSync(join(RESOURCES, fileName), 'utf8'))
const listItems = (document) => (Array.isArray(document) ? document : document.data_items)

const PEAK = { data_item_name: 'V_peak', data_type: 'constant', unit: 'mV', operands: ['membrane/V'], operation: 'max', value: 20, std: 1.5 }
const DOCUMENT = {
  protocol_info: { pre_times: [0, 0], sim_times: [[1, 2], [3]], params_to_change: {} },
  prediction_items: [{ data_item_name: 'V_trace', operands: ['membrane/V'], unit: 'mV' }],
  data_items: [PEAK, { data_item_name: 'V_series', data_type: 'series', unit: 'mV', operands: ['membrane/V'], value: [1, 2, 3], std: 0.5, obs_dt: 0.1 }],
}

describe('readDataItem and buildDataItem', () => {
  it.each(['3compartment_obs_data.json', 'Lotka_Volterra_forced_multi_trace_obs_data.json', 'NKE_pump_obs_data.json', 'SN_simple_obs_data.json', 'br-1977_obs_data.json'])(
    'writes back every item of %s as it read it',
    (fileName) => {
      for (const item of listItems(readFixture(fileName))) expect(buildDataItem(readDataItem(item))).toEqual(item)
    }
  )

  it('reads a pre-#466 item and writes back only the current keys, in their place', () => {
    const row = readDataItem({ variable: 'a', name_for_plotting: 'A_{max}', data_type: 'constant', unit: 'u', operation: 'max', operands: ['m/x'], value: 1, std: 0.1 })
    expect(row).toMatchObject({ name: 'a', traceName: 'A_{max}' })
    const item = buildDataItem(row)
    expect(Object.keys(item)).toEqual(['data_item_name', 'trace_name_for_plotting', 'data_type', 'unit', 'operation', 'operands', 'value', 'std'])
    expect(buildDataItem({ ...row, name: 'b' }).data_item_name).toBe('b')
  })

  it('leaves out a unit the item lacks until one is given, as CA refuses it', () => {
    const { unit, ...item } = PEAK
    const row = readDataItem(item)
    expect(row.unit).toBe('')
    expect(buildDataItem({ ...row, comment: 'peak' })).toEqual({ ...item, comment: 'peak' })
    expect(buildDataItem({ ...row, unit })).toEqual({ ...item, unit })
  })

  it('keeps keys it does not know of, and the spelling of a field left alone', () => {
    const item = { ...PEAK, data_type: 'timeseries', plot_type: 'none', species: 'rat', operation: 'None' }
    const row = readDataItem(item)
    expect(row).toMatchObject({ dataType: 'series', plotType: '', operation: '' })
    expect(buildDataItem(row)).toEqual(item)
    expect(buildDataItem({ ...row, value: 21 })).toEqual({ ...item, value: 21 })
  })

  it("reads what an item doesn't set as CA's default, or empty", () => {
    expect(readDataItem({ data_item_name: 'x', value: 1, std: 1 })).toMatchObject({
      dataType: 'constant',
      operands: [],
      operation: '',
      weight: 1,
      experiment: 0,
      subexperiment: 0,
      costType: '',
      plotType: null,
      traceName: '',
      itemName: '',
      isValueEditable: true,
    })
  })

  it('round-trips the operation and its kwargs, and drops them with it', () => {
    const row = readDataItem({ ...PEAK, operation: 'max_in_range', operation_kwargs: { start_frac: 0.1, end_frac: 0.9 } })
    expect(row.operationKwargs).toEqual({ start_frac: 0.1, end_frac: 0.9 })
    expect(buildDataItem({ ...row, operationKwargs: { start_frac: 0.2, end_frac: 0.9 } }).operation_kwargs).toEqual({ start_frac: 0.2, end_frac: 0.9 })
    expect('operation_kwargs' in buildDataItem({ ...row, operationKwargs: {} })).toBe(false)
    const cleared = buildDataItem({ ...row, operation: '' })
    expect('operation' in cleared || 'operation_kwargs' in cleared).toBe(false)
  })

  it('round-trips the cost and its kwargs, keeping the kwargs with the default cost', () => {
    const row = readDataItem({ ...PEAK, cost_type: 'gaussian_MLE_robust', cost_kwargs: { p_outlier: 0.1 } })
    expect(row).toMatchObject({ costType: 'gaussian_MLE_robust', costKwargs: { p_outlier: 0.1 } })
    const item = buildDataItem({ ...row, costType: '' })
    expect('cost_type' in item).toBe(false)
    expect(item.cost_kwargs).toEqual({ p_outlier: 0.1 })
    expect('cost_kwargs' in buildDataItem({ ...row, costKwargs: {} })).toBe(false)
  })

  it('writes value, std, weight and obs_dt, and a series of values', () => {
    const row = readDataItem(DOCUMENT.data_items[1])
    expect(row).toMatchObject({ dataType: 'series', value: [1, 2, 3], std: 0.5, obsDt: 0.1 })
    expect(buildDataItem({ ...row, value: [4, 5], std: [1, 2], obsDt: 0.2, weight: 3 })).toEqual({ ...DOCUMENT.data_items[1], value: [4, 5], std: [1, 2], obs_dt: 0.2, weight: 3 })
  })

  it('writes no marker as None, and drops the plot type for the default', () => {
    const row = readDataItem({ ...PEAK, plot_type: 'vertical' })
    expect(buildDataItem({ ...row, plotType: '' }).plot_type).toBe('None')
    expect('plot_type' in buildDataItem({ ...row, plotType: null })).toBe(false)
  })

  it('round-trips the labels, colour, source and comment, and drops them when cleared', () => {
    const item = { ...PEAK, trace_name_for_plotting: 'V', item_name_for_plotting: 'V peak', plot_color: 'tab:red', source: 'Smith 2020', comment: 'noisy' }
    const row = readDataItem(item)
    expect(row).toMatchObject({ traceName: 'V', itemName: 'V peak', plotColor: 'tab:red', source: 'Smith 2020', comment: 'noisy' })
    expect(buildDataItem({ ...row, traceName: '', itemName: '', plotColor: '', source: '', comment: '' })).toEqual(PEAK)
  })

  it('never clobbers a source of files', () => {
    const item = { ...PEAK, source: { value_path: 'x.npy' } }
    const row = readDataItem(item)
    expect(row.source).toBe('')
    expect(buildDataItem({ ...row, comment: 'x' }).source).toEqual({ value_path: 'x.npy' })
  })

  it("doesn't offer the value of a frequency, or of a series read from files", () => {
    expect(readDataItem({ ...PEAK, data_type: 'frequency' }).isValueEditable).toBe(false)
    expect(readDataItem({ data_item_name: 's', data_type: 'series', t_path: 't.npy', value_path: 'v.npy' }).isValueEditable).toBe(false)
  })

  it('drops an operand cleared in the form', () => {
    expect(buildDataItem({ ...createDataItem(), name: 'x', operands: ['a/x', '', 'b/y'] }).operands).toEqual(['a/x', 'b/y'])
  })

  it('begins a new item as a constant, the maximum of its variable', () => {
    expect(createDataItem({ experiment: 1 })).toMatchObject({ dataType: 'constant', operation: 'max', value: 0, std: 1, weight: 1, experiment: 1, unit: 'dimensionless', plotType: 'horizontal' })
  })
})

describe('listDataItems', () => {
  it('lists the items of a document, of a legacy data_item, or of a bare list, each with its place', () => {
    expect(listDataItems(DOCUMENT).map(({ name, index }) => [name, index])).toEqual([
      ['V_peak', 0],
      ['V_series', 1],
    ])
    expect(listDataItems({ data_item: [PEAK] })).toHaveLength(1)
    expect(listDataItems([PEAK])[0].name).toBe('V_peak')
    expect(listDataItems(null)).toEqual([])
  })
})

describe('isRowDataItem', () => {
  it("lists a constant of one value as a row, with no operation or one the vocabulary has, and keeps the others", () => {
    const rows = listDataItems([
      { data_item_name: 'a', data_type: 'constant', operands: ['m/V'], operation: 'max', value: 1, std: 1 },
      { data_item_name: 'b', data_type: 'constant', operands: ['m/V'], value: 1, std: 1 },
      { data_item_name: 'c', data_type: 'series', operands: ['m/V'], value: [1, 2], std: 1, obs_dt: 0.1 },
      { data_item_name: 'd', data_type: 'frequency', operands: ['m/V'], value: [1, 2], std: [1, 1], frequencies: [1, 2] },
      { data_item_name: 'e', data_type: 'constant', operands: ['m/V'], operation: 'my_op', value: 1, std: 1 },
    ])
    expect(rows.map((row) => isRowDataItem(row))).toEqual([true, true, false, false, false])
    expect(isRowDataItem(rows[4], readObsDataOptions({ operations: ['my_op'] }))).toBe(true)
  })
})

describe('addDataItem, updateDataItem and removeDataItem', () => {
  it('adds an item CA reads, changing nothing else', () => {
    const before = JSON.stringify(DOCUMENT)
    const edited = addDataItem(DOCUMENT, { ...createDataItem(), name: 'V_min', operands: ['membrane/V'], operation: 'min', value: -80, unit: 'mV' })
    expect(JSON.stringify(DOCUMENT)).toBe(before)
    expect(edited.data_items.at(-1)).toEqual({
      data_item_name: 'V_min',
      data_type: 'constant',
      operands: ['membrane/V'],
      unit: 'mV',
      operation: 'min',
      value: -80,
      std: 1,
      weight: 1,
      experiment_idx: 0,
      subexperiment_idx: 0,
      plot_type: 'horizontal',
    })
    expect(edited.protocol_info).toBe(DOCUMENT.protocol_info)
    expect(edited.prediction_items).toBe(DOCUMENT.prediction_items)
    expect(readDataItemsAsCircAutogen(edited).error).toBeNull()
  })

  it('gives every item the indices one has, as CA refuses a column of them some lack', () => {
    const edited = updateDataItem(DOCUMENT, 0, { experiment: 1 })
    expect(edited.data_items.map((item) => item.experiment_idx)).toEqual([1, 0])
    expect(readDataItemsAsCircAutogen(edited).error).toBeNull()
  })

  it('renames an item where the other data items name it', () => {
    const edited = updateDataItem(
      { ...DOCUMENT, data_items: [...DOCUMENT.data_items, { ...PEAK, data_item_name: 'ratio', operands: [], operation: 'calculate_two_observable_difference', operation_kwargs: { subtract_from: 'V_peak', subtract_this: 'V_series' } }] },
      0,
      { name: 'V_max' }
    )
    expect(edited.data_items[2].operation_kwargs).toEqual({ subtract_from: 'V_max', subtract_this: 'V_series' })
    expect(edited.prediction_items).toBe(DOCUMENT.prediction_items)
  })

  it("doesn't rename references to a name another item still has", () => {
    const referring = { ...PEAK, data_item_name: 'ratio', operands: [], operation: 'calculate_two_observable_difference', operation_kwargs: { subtract_from: 'V_peak', subtract_this: 'V_peak' } }
    const edited = updateDataItem({ ...DOCUMENT, data_items: [PEAK, PEAK, referring] }, 0, { name: 'V_max' })
    expect(edited.data_items[2].operation_kwargs.subtract_from).toBe('V_peak')
  })

  it('keeps a bare list a bare list, and a legacy data_item its key', () => {
    expect(updateDataItem([PEAK], 0, { value: 1 })).toEqual([{ ...PEAK, value: 1 }])
    expect(removeDataItem({ data_item: [PEAK, PEAK] }, 1)).toEqual({ data_item: [PEAK] })
  })

  it('removes an item, and gives the document back for no such item', () => {
    expect(removeDataItem(DOCUMENT, 0).data_items).toEqual([DOCUMENT.data_items[1]])
    expect(removeDataItem(DOCUMENT, 5)).toBe(DOCUMENT)
    expect(updateDataItem(DOCUMENT, 5, { value: 1 })).toBe(DOCUMENT)
  })

  it('are renumbered with the protocol: removing a sub-experiment removes the items in it and moves those after it', () => {
    const document = updateDataItem(addDataItem(DOCUMENT, { ...createDataItem(), name: 'late', operands: ['membrane/V'], subexperiment: 1 }), 0, { subexperiment: 0 })
    const removed = removeSubExperiment(document, 0, 0)
    expect(listDataItems(removed).map(({ name, experiment, subexperiment }) => [name, experiment, subexperiment])).toEqual([['late', 0, 0]])
  })
})
