import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'

import { readObsDataOptions } from '../../src/core/dataItemVocabulary.js'
import { DATA_ITEM_COLUMN_PRESETS, DataItemsSection, resolveDataItemColumns } from '../../src/editor/index.js'
import VariableCell from '../../src/editor/VariableCell.vue'

const VARIABLES = [
  { name: 'membrane/V', label: 'Membrane voltage', unit: 'mV', kind: 'variable' },
  { name: 'i_Na/i_Na', unit: 'uA_per_cm2', kind: 'variable' },
]
const PEAK = { data_item_name: 'V_peak', data_type: 'constant', unit: 'mV', operands: ['membrane/V'], operation: 'max', value: 20, std: 1.5, experiment_idx: 1, subexperiment_idx: 0 }
const PERIOD = { data_item_name: 'period', data_type: 'constant', unit: 's', operands: ['time', 'membrane/V'], operation: 'first_peak_time', value: 0.2, std: 0.01, experiment_idx: 0, subexperiment_idx: 1 }
const SERIES = { data_item_name: 'V_series', data_type: 'series', unit: 'mV', operands: ['membrane/V'], value: [1, 2, 3], std: 0.5, obs_dt: 0.1, experiment_idx: 0, subexperiment_idx: 1 }
const DOCUMENT = {
  protocol_info: { pre_times: [0, 0], sim_times: [[1, 2], [3]], params_to_change: {} },
  data_items: [PEAK, SERIES, PERIOD],
}

let wrapper
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

/**
 * Mounts the section on a document.
 *
 * @param {Object|Array} obsData
 * @param {Object} [props]
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountSection(obsData, props = {}) {
  wrapper = mount(DataItemsSection, { props: { document: obsData, variables: VARIABLES, ...props }, global: { plugins: [PrimeVue] }, attachTo: globalThis.document.body })
  return wrapper
}

const lastDocument = () => wrapper.emitted('update:document').at(-1)[0]
const rows = () => wrapper.findAll('[data-testid="od-data-row"]')

/**
 * Changes a native field of a row, by its label.
 *
 * @param {import('@vue/test-utils').DOMWrapper} row
 * @param {string} label
 * @param {string} value
 */
async function change(row, label, value) {
  const field = row.find(`[aria-label="${label}"]`)
  await field.setValue(value)
  await field.trigger('change')
}

describe('resolveDataItemColumns', () => {
  it("reads a preset or a list of keys, in the editor's order", () => {
    expect(resolveDataItemColumns('cuflynx')).toEqual(DATA_ITEM_COLUMN_PRESETS.cuflynx.columns)
    expect(resolveDataItemColumns('phlynx')).not.toEqual(expect.arrayContaining(['weight']))
    expect(resolveDataItemColumns('phlynx').filter((key) => ['weight', 'cost', 'differentiable'].includes(key))).toEqual([])
    expect(resolveDataItemColumns(['unit', 'name', 'nonsense'])).toEqual(['name', 'unit'])
    expect(resolveDataItemColumns('unknown')).toEqual(DATA_ITEM_COLUMN_PRESETS.cuflynx.columns)
  })
})

describe("DataItemsSection, CUFLynx's preset", () => {
  it("heads its rows as CUFLynx does, each a constant's fields, and counts the items it keeps as they are", () => {
    mountSection(DOCUMENT)
    expect(wrapper.find('h3').text()).toBe('data_items')
    expect(wrapper.findAll('.od-head span').map((head) => head.text())).toEqual(['name', 'value', 'std', 'operation', 'exp', 'sub', ''])
    expect(rows()).toHaveLength(2)
    const [peak] = rows()
    expect(peak.find('[aria-label="name"]').element.value).toBe('V_peak')
    expect(peak.find('[aria-label="value"]').element.value).toBe('20')
    expect(peak.find('[aria-label="operation"]').element.value).toBe('max')
    expect(peak.find('[aria-label="exp"]').element.value).toBe('1')
    expect(wrapper.find('[data-testid="od-preserved"]').text()).toBe('1 non-editable item(s) (series / frequency / custom operation) will be preserved unchanged.')
  })

  it('edits a field of a row in place, as its item', async () => {
    mountSection(DOCUMENT)
    await change(rows()[0], 'name', 'V_max')
    expect(lastDocument().data_items[0]).toEqual({ ...PEAK, data_item_name: 'V_max' })
    await change(rows()[0], 'std', '')
    expect(lastDocument().data_items[0]).not.toHaveProperty('std')
    // The items it doesn't show stay where they were.
    expect(lastDocument().data_items.slice(1)).toEqual([SERIES, PERIOD])
  })

  it("keeps the sub-experiment within the experiment's", async () => {
    mountSection(DOCUMENT)
    await change(rows()[1], 'exp', '1')
    expect(lastDocument().data_items[2]).toMatchObject({ experiment_idx: 1, subexperiment_idx: 0 })
  })

  it('tints and warns of an operation CA cannot differentiate, and tints what CA refuses, saying why', () => {
    mountSection({ ...DOCUMENT, data_items: [PEAK, { ...PERIOD, std: 0 }] })
    const [peak, period] = rows()
    expect(peak.classes()).not.toContain('od-non-diff')
    expect(period.classes()).toEqual(expect.arrayContaining(['od-non-diff', 'od-invalid']))
    expect(period.find('[data-testid="od-nondiff-warn"]').text()).toContain('Operation “first_peak_time” is not differentiable')
    expect(period.find('.od-error').exists()).toBe(true)
  })

  it('opens the details under the chevron, selecting the row, and closes them', async () => {
    mountSection(DOCUMENT)
    await rows()[1].find('[aria-label="details"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[2]])
    const labels = rows()[1].findAll('.od-detail > label, .od-detail > .od-field').map((label) => label.element.firstChild.textContent.trim())
    expect(labels.slice(0, 6)).toEqual(['operands', 'trace label', 'unit', 'weight', 'cost_type', 'plot_type'])
    expect(rows()[1].findAll('.od-operand-name').map((name) => name.text())).toEqual(['t', 'V'])
    expect(rows()[1].find('[aria-label="spike_min_thresh"]').exists()).toBe(true)
    expect(rows()[1].find('[aria-label="source"]').exists()).toBe(true)
    await rows()[1].find('[aria-label="details"]').trigger('click')
    expect(rows()[1].find('.od-detail').exists()).toBe(false)
  })

  it('says whether the details under a chevron are open, and which they are', async () => {
    mountSection(DOCUMENT)
    const chevron = () => rows()[0].find('[aria-label="details"]')
    expect(chevron().attributes('aria-expanded')).toBe('false')
    expect(chevron().attributes('aria-controls')).toBeUndefined()
    await chevron().trigger('click')
    expect(chevron().attributes('aria-expanded')).toBe('true')
    expect(rows()[0].find('.od-detail').attributes('id')).toBe(chevron().attributes('aria-controls'))
  })

  it('adds an operand slot at the first click, for an operation that takes any number', async () => {
    mountSection({ ...DOCUMENT, data_items: [{ ...PEAK, operands: [], operation: '' }] })
    await rows()[0].find('[aria-label="details"]').trigger('click')
    expect(rows()[0].findAll('.od-operand')).toHaveLength(1)
    await rows()[0].findAll('button').find((button) => button.text() === 'operand').trigger('click')
    expect(rows()[0].findAll('.od-operand')).toHaveLength(2)
    wrapper.findAllComponents(VariableCell).at(1).vm.$emit('update:modelValue', 'i_Na/i_Na')
    expect(lastDocument().data_items[0].operands).toEqual(['i_Na/i_Na'])
  })

  it('keeps the selection on its item when a row above it is removed', async () => {
    mountSection(DOCUMENT, { selected: 2 })
    await rows()[0].find('[aria-label="remove"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[1]])
    await wrapper.setProps({ selected: 0 })
    await rows()[1].find('[aria-label="remove"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[1]])
    await rows()[0].find('[aria-label="remove"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[1], [null]])
  })

  it("selects a row when it is clicked, as the host's highlight follows", async () => {
    mountSection(DOCUMENT, { selected: 0 })
    expect(rows()[0].classes()).toContain('od-selected')
    await rows()[1].find('.od-main').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[2]])
    expect(rows()[1].find('.od-detail').exists()).toBe(true)
  })

  it('changes the operation, fitting the operands to it and dropping kwargs it does not take', async () => {
    mountSection({ ...DOCUMENT, data_items: [{ ...PEAK, operation: 'max_in_range', operation_kwargs: { start_frac: 0.5 } }] })
    await change(rows()[0], 'operation', 'division')
    expect(lastDocument().data_items[0]).toMatchObject({ operation: 'division', operands: ['membrane/V'] })
    expect(lastDocument().data_items[0]).not.toHaveProperty('operation_kwargs')
  })

  it('picks an operand, naming an unnamed item after it, and edits kwargs and the cost', async () => {
    mountSection({ ...DOCUMENT, data_items: [{ ...PEAK, data_item_name: '', operands: [], operation: 'max_in_range' }] })
    await rows()[0].find('[aria-label="details"]').trigger('click')
    wrapper.findComponent(VariableCell).vm.$emit('update:modelValue', 'i_Na/i_Na')
    expect(lastDocument().data_items[0]).toMatchObject({ data_item_name: 'i_Na/i_Na', operands: ['i_Na/i_Na'] })
    await change(rows()[0], 'end_frac', '0.5')
    expect(lastDocument().data_items[0].operation_kwargs).toEqual({ end_frac: 0.5 })
    await change(rows()[0], 'cost_type', 'gaussian_MLE_robust')
    expect(lastDocument().data_items[0].cost_type).toBe('gaussian_MLE_robust')
  })

  it("names the default cost, and offers the host's vocabulary", async () => {
    const vocabulary = readObsDataOptions({ operations: ['', 'max', 'my_op'], default_cost_type: 'MSE', cost_types: ['MSE', 'AE'] })
    mountSection({ ...DOCUMENT, data_items: [PEAK, { ...PEAK, data_item_name: 'mine', operation: 'my_op' }] }, { vocabulary })
    expect(rows()).toHaveLength(2)
    expect(rows()[0].findAll('[aria-label="operation"] option').map((option) => option.text())).toEqual(['(none)', 'max', 'my_op'])
    await rows()[0].find('[aria-label="details"]').trigger('click')
    expect(rows()[0].findAll('[aria-label="cost_type"] option').map((option) => option.text())).toEqual(['(default — MSE)', 'MSE — AD', 'AE — AD'])
  })

  it('adds an item as CUFLynx begins one, and removes one', async () => {
    mountSection(DOCUMENT)
    await wrapper.findAll('button').find((button) => button.text() === 'Add data item').trigger('click')
    expect(lastDocument().data_items[3]).toMatchObject({ data_type: 'constant', operation: 'max', value: 0, std: 1, plot_type: 'horizontal' })
    expect(wrapper.emitted('select').at(-1)).toEqual([3])
    await rows()[0].find('[aria-label="remove"]').trigger('click')
    expect(lastDocument().data_items).toEqual([SERIES, PERIOD])
  })

  it("says there are none, as CUFLynx's dialog does, and keeps a data-only list one", async () => {
    mountSection([])
    expect(wrapper.find('.od-empty').text()).toBe('No editable data_items. Add one below.')
    await wrapper.findAll('button').find((button) => button.text() === 'Add data item').trigger('click')
    expect(Array.isArray(lastDocument())).toBe(true)
  })
})

describe("DataItemsSection, PhLynx's preset", () => {
  it('lists the items read-only, without what a calibration needs of them', async () => {
    mountSection(DOCUMENT, { columns: 'phlynx' })
    expect(wrapper.find('input, select, textarea').exists()).toBe(false)
    expect(rows()[0].findAll('.od-cell').map((cell) => cell.text())).toEqual(['V_peak', '20', '1.5', 'max', '1', '0'])
    expect(wrapper.findAll('button').map((button) => button.attributes('aria-label') ?? button.text())).toEqual(['details', 'details'])
    // first_peak_time is not differentiable, which a host that runs the protocol doesn't say.
    expect(rows()[1].classes()).not.toContain('od-non-diff')
    await rows()[1].find('[aria-label="details"]').trigger('click')
    const details = rows()[1].find('.od-detail').text()
    expect(details).toContain('operands')
    expect(details).toContain('time')
    expect(details).not.toContain('weight')
    expect(details).not.toContain('cost_type')
    expect(wrapper.find('[data-testid="od-preserved"]').exists()).toBe(true)
    expect(wrapper.emitted('update:document')).toBeUndefined()
  })

  it('tints the items CA refuses all the same, saying why, and names a plot_type of none', async () => {
    mountSection({ ...DOCUMENT, data_items: [{ ...PEAK, std: 0, plot_type: 'None' }, { ...PEAK, data_item_name: 'V_mean', value: null }, PERIOD] }, { columns: 'phlynx' })
    expect(rows().map((row) => row.classes('od-invalid'))).toEqual([true, true, false])
    expect(rows()[0].find('.od-error').exists()).toBe(true)
    await rows()[0].find('[aria-label="details"]').trigger('click')
    expect(rows()[0].find('.od-detail').text()).toContain('plot_type (none)')
  })

  it('edits when the host says so, and says there are none', () => {
    mountSection(DOCUMENT, { columns: 'phlynx', readOnly: false })
    expect(rows()[0].find('[aria-label="name"]').exists()).toBe(true)
    wrapper.unmount()
    mountSection({ protocol_info: DOCUMENT.protocol_info }, { columns: 'phlynx' })
    expect(wrapper.find('.od-empty').text()).toBe('No data_items.')
  })
})
