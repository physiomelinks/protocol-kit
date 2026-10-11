import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'

import { PREDICTION_ITEM_COLUMN_PRESETS, PredictionItemsSection, resolvePredictionItemColumns } from '../../src/editor/index.js'
import VariableCell from '../../src/editor/VariableCell.vue'

const RESOURCES = join(__dirname, '../resources')
const readFixture = (fileName) => JSON.parse(readFileSync(join(RESOURCES, fileName), 'utf8'))

const VARIABLES = [
  { name: 'membrane/V', label: 'Membrane voltage', unit: 'mV', kind: 'variable' },
  { name: 'i_Na/i_Na', unit: 'uA_per_cm2', kind: 'variable' },
]

let wrapper
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

/**
 * Mounts the section on a document.
 *
 * @param {Object} obsData
 * @param {Object} [props]
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountSection(obsData, props = {}) {
  wrapper = mount(PredictionItemsSection, { props: { document: obsData, variables: VARIABLES, ...props }, global: { plugins: [PrimeVue] }, attachTo: globalThis.document.body })
  return wrapper
}

const lastDocument = () => wrapper.emitted('update:document').at(-1)[0]
const rows = () => wrapper.findAll('[data-testid="od-prediction-row"]')

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

describe('resolvePredictionItemColumns', () => {
  it('reads a preset or a list of keys; both apps edit every column', () => {
    expect(resolvePredictionItemColumns('phlynx')).toEqual(PREDICTION_ITEM_COLUMN_PRESETS.cuflynx.columns)
    expect(resolvePredictionItemColumns(['operation', 'variable'])).toEqual(['variable', 'operation'])
  })
})

describe('PredictionItemsSection', () => {
  it('lists a row per item, as CUFLynx heads them, held-out data marked obs', () => {
    const document = readFixture('prediction_items_536_obs_data.json')
    mountSection(document)
    expect(wrapper.find('h3').text()).toBe('prediction_items')
    expect(wrapper.findAll('.od-head span').map((head) => head.text())).toEqual(['variable', 'unit', 'trace label', 'exp', 'sub', 'operation', ''])
    expect(rows()).toHaveLength(document.prediction_items.length)
    const [trace, holding, peak] = rows()
    expect(trace.find('.od-value').text()).toBe('membrane/V')
    expect(trace.find('[aria-label="sub"]').element.value).toBe('last')
    expect(trace.find('[aria-label="operation"]').element.value).toBe('')
    expect(trace.findAll('[aria-label="operation"] option')[0].text()).toBe('(none)')
    expect(holding.find('[aria-label="sub"]').element.value).toBe('0')
    expect(peak.find('[aria-label="operation"]').element.value).toBe('min_in_range')
    expect(rows().map((row) => row.find('.od-chip').exists())).toEqual([false, false, false, false, false, true])
    // It warns of what needs CA #536.
    expect(wrapper.find('.od-warn').text()).toContain('prediction items use an operation or a sub-experiment')
  })

  it('edits one item in its place, keeping the others and its held-out data', async () => {
    const document = readFixture('prediction_items_536_obs_data.json')
    mountSection(document)
    await change(rows()[5], 'unit', 'nA')
    expect(lastDocument().prediction_items[5]).toEqual({ ...document.prediction_items[5], unit: 'nA' })
    expect(lastDocument().prediction_items.slice(0, 5)).toEqual(document.prediction_items.slice(0, 5))
    await change(rows()[0], 'sub', '0')
    expect(lastDocument().prediction_items[0].subexperiment_idx).toBe(0)
    await change(rows()[1], 'sub', 'last')
    expect(lastDocument().prediction_items[1]).not.toHaveProperty('subexperiment_idx')
  })

  it("shows a range's start_frac and end_frac in its details, with its name and item label", async () => {
    mountSection(readFixture('prediction_items_536_obs_data.json'))
    await rows()[2].find('[aria-label="details"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[2]])
    expect(rows()[2].find('[aria-label="name"]').element.value).toBe('I_peak_e0')
    expect(rows()[2].find('[aria-label="item label"]').element.value).toBe('I_peak')
    expect(rows()[2].find('[aria-label="end_frac"]').element.value).toBe('0.2')
    await change(rows()[2], 'end_frac', '0.1')
    expect(lastDocument().prediction_items[2].operation_kwargs).toEqual({ start_frac: 0, end_frac: 0.1 })
  })

  it('changes the operation, dropping the kwargs it does not take', async () => {
    mountSection(readFixture('prediction_items_536_obs_data.json'))
    await change(rows()[2], 'operation', 'max')
    expect(lastDocument().prediction_items[2]).toMatchObject({ operation: 'max' })
    expect(lastDocument().prediction_items[2]).not.toHaveProperty('operation_kwargs')
  })

  it('tints an item CA refuses and says why, and a range that takes no samples at the dt given', () => {
    const document = readFixture('prediction_items_536_obs_data.json')
    document.prediction_items[2].operation_kwargs = { start_frac: 0, end_frac: 0.00001 }
    mountSection(document, { dt: 0.01 })
    expect(rows()[2].classes()).toContain('od-invalid')
    expect(rows()[2].find('.od-error').text()).toMatch(/^The range 0 to 0.00001 of 200 s takes no samples/)
  })

  it('adds an item, named after the variable picked, its unit the variable\'s', async () => {
    const document = readFixture('prediction_items_536_obs_data.json')
    mountSection(document)
    await wrapper.findAll('button').find((button) => button.text() === 'Add prediction').trigger('click')
    expect(lastDocument().prediction_items.at(-1)).toEqual({ data_item_name: '', operands: [], unit: 'dimensionless', experiment_idx: 0 })
    await wrapper.setProps({ document: lastDocument() })
    wrapper.findAllComponents(VariableCell).at(-1).vm.$emit('update:modelValue', 'membrane/V')
    expect(lastDocument().prediction_items.at(-1)).toEqual({ data_item_name: 'membrane/V', operands: ['membrane/V'], unit: 'mV', experiment_idx: 0 })
  })

  it('removes an item', async () => {
    const document = readFixture('prediction_items_536_obs_data.json')
    mountSection(document)
    await rows()[0].find('[aria-label="remove"]').trigger('click')
    expect(lastDocument().prediction_items).toEqual(document.prediction_items.slice(1))
  })

  it('keeps the selection on its item when a row above it is removed', async () => {
    mountSection(readFixture('prediction_items_536_obs_data.json'), { selected: 2 })
    await rows()[0].find('[aria-label="remove"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[1]])
    await wrapper.setProps({ selected: 1 })
    await rows()[1].find('[aria-label="remove"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[1], [null]])
  })

  it('says whether the details under a chevron are open', async () => {
    mountSection(readFixture('prediction_items_536_obs_data.json'))
    const chevron = () => rows()[0].find('[aria-label="details"]')
    expect(chevron().attributes('aria-expanded')).toBe('false')
    await chevron().trigger('click')
    expect(chevron().attributes('aria-expanded')).toBe('true')
    expect(rows()[0].find('.od-detail').attributes('id')).toBe(chevron().attributes('aria-controls'))
  })

  it('lists them read-only when the host says so, and says there are none', () => {
    mountSection(readFixture('prediction_items_536_obs_data.json'), { readOnly: true })
    expect(wrapper.find('input, select').exists()).toBe(false)
    expect(rows()[0].findAll('.od-cell').map((cell) => cell.text())).toEqual(['membrane/V', 'mV', '—', '0', '(last)', '(none)'])
    wrapper.unmount()
    mountSection({ protocol_info: { pre_times: [0], sim_times: [[1]], params_to_change: {} } })
    expect(wrapper.find('.od-empty').text()).toBe('No prediction_items. Add one below.')
  })
})
