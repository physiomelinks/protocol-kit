import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataItemsSection, ObsDataEditor, PredictionItemsSection, PredictionPlotsSection, ProtocolInfoEditor } from '../../src/editor/index.js'

const RESOURCES = join(__dirname, '../resources')
const readFixture = (fileName) => JSON.parse(readFileSync(join(RESOURCES, fileName), 'utf8'))

const VARIABLES = [
  { name: 'membrane/V', unit: 'mV', kind: 'variable' },
  { name: 'membrane/V_clamp', unit: 'mV', kind: 'constant', value: -80 },
  { name: 'parameters/g_Na', unit: 'mS_per_cm2', kind: 'constant', value: 0.12 },
]
const DATA_ONLY = [{ data_item_name: 'V_rest', data_type: 'constant', unit: 'mV', operands: ['membrane/V'], operation: 'mean', value: -80, std: 1, experiment_idx: 0, subexperiment_idx: 0 }]

let wrapper
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

/**
 * Mounts the editor on a document, as a host would.
 *
 * @param {Object|Array|null} obsData
 * @param {Object} [props]
 * @param {Object} [slots]
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountEditor(obsData, props = {}, slots = {}) {
  wrapper = mount(ObsDataEditor, { props: { document: obsData, variables: VARIABLES, confirm: vi.fn(async () => true), ...props }, slots, global: { plugins: [PrimeVue] }, attachTo: globalThis.document.body })
  return wrapper
}

const headings = () => wrapper.findAll('h3.od-section').map((heading) => heading.text())
const lastDocument = () => wrapper.emitted('update:document').at(-1)[0]

describe('ObsDataEditor', () => {
  it("has a section for each of the document's keys, as CUFLynx's dialog does", () => {
    mountEditor(readFixture('prediction_items_536_obs_data.json'))
    expect(headings()).toEqual(['protocol_info', 'data_items', 'prediction_items', 'prediction_plots'])
    expect(wrapper.findComponent(ProtocolInfoEditor).exists()).toBe(true)
    expect(wrapper.findComponent(PredictionPlotsSection).exists()).toBe(true)
  })

  it.each([
    ['a bare list of data items', DATA_ONLY],
    ['an object without protocol_info', { data_items: DATA_ONLY }],
  ])('shows only protocol_info, offering to add it, and the data items of %s', async (_, document) => {
    mountEditor(document)
    expect(headings()).toEqual(['protocol_info', 'data_items'])
    expect(wrapper.findComponent(ProtocolInfoEditor).exists()).toBe(false)
    expect(wrapper.find('.od-hint').text()).toContain('This is a data-only obs_data with no protocol.')
    expect(wrapper.findAll('[data-testid="od-data-row"]')).toHaveLength(1)
    await wrapper.findAll('button').find((button) => button.text() === 'Add protocol_info').trigger('click')
    expect(lastDocument()).toEqual({ data_items: DATA_ONLY, protocol_info: { pre_times: [0], sim_times: [[1]], params_to_change: {} } })
  })

  it("shows a selected data item's experiment, its sub-experiment tinted", async () => {
    const document = readFixture('prediction_items_536_obs_data.json')
    document.data_items.push({ ...document.data_items[0], data_item_name: 'V_late', experiment_idx: 1, subexperiment_idx: 1 })
    mountEditor(document)
    const timeline = () => wrapper.findComponent(ProtocolInfoEditor)
    expect(timeline().props()).toMatchObject({ activeExp: 0, highlightExp: null, highlightSubexp: null })
    await wrapper.findAll('[data-testid="od-data-row"]')[1].find('.od-main').trigger('click')
    expect(timeline().props()).toMatchObject({ activeExp: 1, highlightExp: 1, highlightSubexp: 1 })
    expect(wrapper.findAll('[data-testid="od-data-row"]')[1].classes()).toContain('od-selected')
    expect(timeline().findAll('.column-head').map((head) => head.classes('column-head--highlight'))).toEqual([false, false, true])
  })

  it("shows a selected prediction item's experiment, and its last sub-experiment for one that names none", async () => {
    mountEditor(readFixture('prediction_items_536_obs_data.json'))
    const timeline = () => wrapper.findComponent(ProtocolInfoEditor)
    const rows = () => wrapper.findAll('[data-testid="od-prediction-row"]')
    await rows()[5].find('.od-main').trigger('click')
    expect(timeline().props()).toMatchObject({ activeExp: 1, highlightExp: 1, highlightSubexp: 1 })
    await rows()[1].find('[aria-label="details"]').trigger('click')
    expect(timeline().props()).toMatchObject({ activeExp: 0, highlightExp: 0, highlightSubexp: 0 })
    expect(rows()[1].classes()).toContain('od-selected')
    // Choosing another experiment leaves the highlight in its own.
    timeline().vm.$emit('update:activeExp', 1)
    await wrapper.vm.$nextTick()
    expect(timeline().props()).toMatchObject({ activeExp: 1, highlightExp: 0 })
  })

  it('clears a selection the document no longer has, as an undo leaves it', async () => {
    const document = readFixture('prediction_items_536_obs_data.json')
    mountEditor(document)
    const rows = () => wrapper.findAll('[data-testid="od-prediction-row"]')
    const last = document.prediction_items.length - 1
    await rows()[last].find('.od-main').trigger('click')
    expect(rows()[last].classes()).toContain('od-selected')
    await wrapper.setProps({ document: { ...document, prediction_items: document.prediction_items.slice(0, -1) } })
    await wrapper.setProps({ document })
    expect(rows()[last].classes()).not.toContain('od-selected')
    expect(wrapper.findComponent(ProtocolInfoEditor).props()).toMatchObject({ highlightExp: null })
  })

  it("passes each section's edits on", async () => {
    const document = readFixture('prediction_items_536_obs_data.json')
    mountEditor(document)
    wrapper.findComponent(PredictionItemsSection).vm.$emit('update:document', { ...document, prediction_items: [] })
    expect(lastDocument().prediction_items).toEqual([])
    wrapper.findComponent(ProtocolInfoEditor).vm.$emit('update:document', { ...document, data_items: [] })
    expect(lastDocument().data_items).toEqual([])
  })

  it("gives PhLynx's preset its data items read-only, and hides them for the host's setting", async () => {
    mountEditor(readFixture('prediction_items_536_obs_data.json'), { preset: 'phlynx' })
    const items = wrapper.findComponent(DataItemsSection)
    expect(items.props()).toMatchObject({ columns: 'phlynx', readOnly: null })
    expect(items.find('input').exists()).toBe(false)
    // Its prediction items stay editable.
    expect(wrapper.findComponent(PredictionItemsSection).find('select').exists()).toBe(true)
    await wrapper.setProps({ showDataItems: false })
    expect(headings()).toEqual(['protocol_info', 'prediction_items', 'prediction_plots'])
  })

  it('takes the data items read-only from the host, and actions for them', () => {
    mountEditor(readFixture('prediction_items_536_obs_data.json'), { dataItemsReadOnly: true }, { 'data-items-actions': '<button class="custom-funcs">Custom funcs</button>' })
    expect(wrapper.findComponent(DataItemsSection).find('input').exists()).toBe(false)
    expect(wrapper.findComponent(PredictionItemsSection).find('select').exists()).toBe(true)
    expect(wrapper.find('.od-section-row .custom-funcs').exists()).toBe(true)
  })
})
