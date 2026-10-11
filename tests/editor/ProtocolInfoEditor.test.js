import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EXPERIMENT_PALETTE } from '../../src/core/experimentColours.js'
import { ProtocolCellEditor, ProtocolInfoEditor, VariablePicker } from '../../src/editor/index.js'

const RESOURCES = join(__dirname, '../resources')
const readFixture = (fileName) => JSON.parse(readFileSync(join(RESOURCES, fileName), 'utf8'))

// A host of its own: its model's variables, how it reads their values, and how it asks.
const VARIABLES = [
  { name: 'engine/pace', label: 'Pacing', unit: 'dimensionless', kind: 'constant', value: 0 },
  { name: 'membrane/V', unit: 'mV', kind: 'variable' },
  { name: 'membrane/V_clamp', unit: 'mV', kind: 'constant', value: -80 },
  { name: 'parameters/g_Na', unit: 'mS_per_cm2', kind: 'constant', value: 0.12 },
  { name: 'parameters/g_K', unit: 'mS_per_cm2', kind: 'constant', value: '0.036' },
  { name: 'global_parameters/T', unit: 'kelvin', kind: 'global_constant', value: 0 },
]

let wrapper
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  delete window.confirm
  document.body.innerHTML = ''
})

/**
 * Stands in for the browser's confirm, which happy-dom lacks.
 *
 * @param {boolean} answer
 * @returns {import('vitest').Mock}
 */
const stubBrowserConfirm = (answer) => (window.confirm = vi.fn(() => answer))

/**
 * Mounts the editor on a document, as a host would.
 *
 * @param {Object} document
 * @param {Object} [props]
 * @param {Array} [plugins] - Besides PrimeVue.
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountEditor(document, props = {}, plugins = []) {
  wrapper = mount(ProtocolInfoEditor, {
    props: { document, variables: VARIABLES, ...props },
    global: { plugins: [PrimeVue, ...plugins] },
    attachTo: globalThis.document.body,
  })
  return wrapper
}

/**
 * The documents the editor has passed on.
 *
 * @returns {Array<Object>}
 */
const emittedDocuments = () => (wrapper.emitted('update:document') ?? []).map(([edited]) => edited)

describe('ProtocolInfoEditor', () => {
  it('shows a br-1977 document: its experiment, its colour, and a lane for the parameter it paces', () => {
    mountEditor(readFixture('br-1977_obs_data.json'))
    const experiment = wrapper.find('.rail-item')
    expect(experiment.attributes('aria-label')).toBe('1 Hz pacing')
    expect(experiment.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.rail-meta').text()).toBe('2000 s in 1 part')
    // experiment_colors gives r, matplotlib's red.
    expect(wrapper.find('.swatch').attributes('style')).toBe('background: #e34948;')

    const lane = wrapper.find('.lane-label')
    expect(lane.attributes('title')).toBe('engine/pace')
    expect(lane.find('.lane-units').text()).toBe('dimensionless')
    expect(wrapper.find('.kind-chip').attributes('aria-label')).toBe('How engine/pace varies in sub-experiment 1: Pacing')
    expect(wrapper.find('.lane-plot polyline').attributes('stroke')).toBe('#e34948')
    expect(wrapper.findAll('[role="status"] .p-message')).toHaveLength(0)
  })

  it('offers to create a protocol when the document has none', async () => {
    mountEditor(null)
    await wrapper.find('.protocol-empty button').trigger('click')
    expect(emittedDocuments()[0].protocol_info.sim_times).toEqual([[1]])
  })

  it('edits a sub-experiment length in place and passes the document on', async () => {
    const original = readFixture('br-1977_obs_data.json')
    mountEditor(original)
    await wrapper.find('button[aria-label="Edit sub-experiment 1 length, 2000 s"]').trigger('click')
    const input = wrapper.find('input[aria-label="Sub-experiment 1 length"]')
    await input.setValue('1500')
    await input.trigger('keydown', { key: 'Enter' })

    const [edited] = emittedDocuments()
    expect(edited.protocol_info.sim_times).toEqual([[1500]])
    expect(edited.data_items).toEqual(original.data_items)
    // The editor never changes the document it is given.
    expect(original.protocol_info.sim_times).toEqual([[2000]])
  })

  it('renames an experiment', async () => {
    mountEditor(readFixture('br-1977_obs_data.json'))
    const name = wrapper.find('input[aria-label="Experiment name"]')
    await name.setValue('2 Hz pacing')
    await name.trigger('change')
    expect(emittedDocuments()[0].protocol_info.experiment_labels).toEqual(['2 Hz pacing'])
  })

  it("asks before removing a sub-experiment observations refer to, then renumbers the prediction items", async () => {
    const confirm = vi.fn(async () => true)
    mountEditor(readFixture('prediction_items_536_obs_data.json'), { confirm })
    await wrapper.find('button[aria-label="Remove sub-experiment 1"]').trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0][0]).toMatchObject({ header: 'Remove sub-experiment 1?', severity: 'warning', acceptLabel: 'Remove', rejectLabel: 'Keep' })
    expect(confirm.mock.calls[0][0].message).toContain('2 observations refer to it (V_rest, i_Na_holding)')

    const [edited] = emittedDocuments()
    expect(edited.protocol_info.sim_times).toEqual([[200], [50, 200]])
    expect(edited.data_items).toEqual([])
    const items = edited.prediction_items.map(({ data_item_name, experiment_idx, subexperiment_idx }) => [data_item_name, experiment_idx, subexperiment_idx])
    expect(items).toEqual([
      // Recording over the experiment's last sub-experiment, which stays.
      ['V_trace', 0, undefined],
      ['I_peak_e0', 0, 0],
      ['I_peak_e1', 1, 1],
      ['V_step_e1', 1, 1],
      ['I_late_e1', 1, undefined],
    ])
  })

  it('keeps the sub-experiment when the host is told no', async () => {
    const confirm = vi.fn(async () => false)
    mountEditor(readFixture('prediction_items_536_obs_data.json'), { confirm })
    await wrapper.find('button[aria-label="Remove sub-experiment 1"]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    expect(emittedDocuments()).toEqual([])
  })

  it('asks with the browser when the host gives no confirm and has no ConfirmationService', async () => {
    const browserConfirm = stubBrowserConfirm(true)
    mountEditor(readFixture('br-1977_obs_data.json'))
    await wrapper.find('button[aria-label="Stop setting engine/pace"]').trigger('click')
    await flushPromises()
    expect(browserConfirm).toHaveBeenCalledWith('Stop setting engine/pace?\n\nThe protocol stops setting it in every experiment. Undo brings it back.')
    expect(emittedDocuments()[0].protocol_info.params_to_change).toEqual({})
  })

  it("asks with PrimeVue's ConfirmDialog when the host has its ConfirmationService", async () => {
    const browserConfirm = stubBrowserConfirm(true)
    mountEditor(readFixture('br-1977_obs_data.json'), {}, [ConfirmationService])
    await wrapper.find('button[aria-label="Stop setting engine/pace"]').trigger('click')
    await flushPromises()

    const dialog = document.body.querySelector('.p-confirmdialog')
    expect(dialog?.textContent).toContain('Stop setting engine/pace?')
    dialog.querySelector('.p-confirmdialog-accept-button').click()
    await flushPromises()
    expect(browserConfirm).not.toHaveBeenCalled()
    expect(emittedDocuments()[0].protocol_info.params_to_change).toEqual({})
  })

  it('adds a parameter picked from the host variables, at the value the host reads', async () => {
    const getValue = vi.fn((name) => (name === 'parameters/g_K' ? '0.072' : undefined))
    mountEditor(readFixture('br-1977_obs_data.json'), { getValue })
    await wrapper.find('.add-parameter-button').trigger('click')
    const picker = wrapper.findComponent(VariablePicker)

    // Only parameters, and not one the protocol sets already.
    const offered = VARIABLES.filter((variable) => picker.props('filter')(variable)).map((variable) => variable.name)
    expect(offered).toEqual(['membrane/V_clamp', 'parameters/g_Na', 'parameters/g_K', 'global_parameters/T'])

    picker.vm.$emit('pick', VARIABLES[4])
    await flushPromises()
    expect(getValue).toHaveBeenCalledWith('parameters/g_K')
    expect(emittedDocuments()[0].protocol_info.params_to_change['parameters/g_K']).toEqual([[0.072]])
    expect(wrapper.findComponent(VariablePicker).exists()).toBe(false)
  })

  it("adds a parameter at its value in the variables when the host gives no getValue", async () => {
    mountEditor(readFixture('br-1977_obs_data.json'))
    await wrapper.find('.add-parameter-button').trigger('click')
    wrapper.findComponent(VariablePicker).vm.$emit('pick', VARIABLES[4])
    await flushPromises()
    expect(emittedDocuments()[0].protocol_info.params_to_change['parameters/g_K']).toEqual([[0.036]])
  })

  it("colours experiments the file doesn't from the host's palette, else the default one", () => {
    const document = readFixture('prediction_items_536_obs_data.json')
    delete document.protocol_info.experiment_colors
    mountEditor(document, { palette: ['#123456', '#abcdef'] })
    expect(wrapper.findAll('.swatch').map((swatch) => swatch.attributes('style'))).toEqual(['background: #123456;', 'background: #abcdef;'])
    wrapper.unmount()

    mountEditor(document)
    expect(wrapper.find('.lane-plot polyline').attributes('stroke')).toBe(EXPERIMENT_PALETTE[0])
  })

  it("shows the host's own warnings after its checks", () => {
    const document = readFixture('br-1977_obs_data.json')
    document.protocol_info.experiment_labels = ['a', 'b']
    const warn = vi.fn(() => ['Ignored here.'])
    mountEditor(document, { warn })
    expect(warn).toHaveBeenCalledWith(document.protocol_info)
    expect(wrapper.findAll('.messages .p-message').map((message) => message.text())).toEqual([
      'experiment_labels has 2 entries for 1 experiments.',
      'Ignored here.',
    ])
  })
})

describe('ProtocolInfoEditor, the experiment shown and the sub-experiment highlighted', () => {
  it('shows the experiment the host says (v-model:activeExp), and tells it of the one chosen', async () => {
    mountEditor(readFixture('prediction_items_536_obs_data.json'), { activeExp: 1 })
    expect(wrapper.findAll('.rail-item').map((item) => item.attributes('aria-pressed'))).toEqual(['false', 'true'])
    await wrapper.findAll('.rail-item')[0].trigger('click')
    expect(wrapper.emitted('update:activeExp')).toEqual([[0]])
    await wrapper.setProps({ activeExp: 0 })
    expect(wrapper.findAll('.rail-item').map((item) => item.attributes('aria-pressed'))).toEqual(['true', 'false'])
  })

  it("keeps the experiment chosen when the host doesn't say", async () => {
    mountEditor(readFixture('prediction_items_536_obs_data.json'))
    await wrapper.findAll('.rail-item')[1].trigger('click')
    expect(wrapper.findAll('.rail-item').map((item) => item.attributes('aria-pressed'))).toEqual(['false', 'true'])
  })

  it("tints the sub-experiment highlighted, only in its own experiment's timeline", async () => {
    mountEditor(readFixture('prediction_items_536_obs_data.json'), { activeExp: 1, highlightExp: 1, highlightSubexp: 0 })
    const tinted = () => wrapper.findAll('.column-head').map((head) => head.classes('column-head--highlight'))
    // The warm-up's head, then each sub-experiment's.
    expect(tinted()).toEqual([false, true, false])
    expect(wrapper.findAll('.lane-cell--highlight').length).toBeGreaterThan(0)
    await wrapper.setProps({ activeExp: 0 })
    expect(tinted()).not.toContain(true)
    await wrapper.setProps({ highlightExp: null, highlightSubexp: 1 })
    expect(tinted()).toEqual([false, false, true])
  })
})

describe('ProtocolInfoEditor, parameters at their model values', () => {
  // Two sub-experiments: V_clamp steps, the others stay at the model's values (g_K's read from a string).
  const atModelValues = () => ({
    protocol_info: {
      pre_times: [0],
      sim_times: [[1, 1]],
      params_to_change: {
        'parameters/g_Na': [[0.12, 0.12]],
        'membrane/V_clamp': [[-80, -40]],
        'parameters/g_K': [[0.036, 0.036]],
        'global_parameters/T': [[0, 0]],
      },
    },
  })
  const laneNames = () => wrapper.findAll('.lane-label').map((label) => label.attributes('title'))
  const toggle = () => wrapper.find('.collapsed-toggle')

  it('tucks them away below the others, and shows and hides them on asking', async () => {
    mountEditor(atModelValues())
    expect(laneNames()).toEqual(['membrane/V_clamp'])
    expect(wrapper.find('.collapsed-note span').text()).toBe('3 parameters at their model values')
    expect(toggle().attributes('aria-expanded')).toBe('false')
    expect(toggle().attributes('aria-label')).toBe('Show 3 parameters at their model values')

    await toggle().trigger('click')
    expect(laneNames()).toEqual(['parameters/g_Na', 'membrane/V_clamp', 'parameters/g_K', 'global_parameters/T'])
    expect(toggle().attributes('aria-expanded')).toBe('true')
    expect(toggle().text()).toBe('Hide')

    await toggle().trigger('click')
    expect(laneNames()).toEqual(['membrane/V_clamp'])
    // The document keeps them.
    expect(wrapper.emitted('update:document')).toBeUndefined()
  })

  it('shows one again once it is set to something else', async () => {
    mountEditor(atModelValues())
    await toggle().trigger('click')
    const edited = atModelValues()
    edited.protocol_info.params_to_change['parameters/g_Na'][0][1] = 0.2
    await wrapper.setProps({ document: edited })
    await toggle().trigger('click')
    expect(laneNames()).toEqual(['parameters/g_Na', 'membrane/V_clamp'])
    expect(wrapper.find('.collapsed-note span').text()).toBe('2 parameters at their model values')
  })

  it('shows a parameter added in the editor, though at its model value', async () => {
    const document = atModelValues()
    delete document.protocol_info.params_to_change['parameters/g_Na']
    mountEditor(document)
    await wrapper.find('.add-parameter-button').trigger('click')
    wrapper.findComponent(VariablePicker).vm.$emit('pick', VARIABLES[3])
    await flushPromises()
    const [edited] = emittedDocuments()
    expect(edited.protocol_info.params_to_change['parameters/g_Na']).toEqual([[0.12, 0.12]])
    await wrapper.setProps({ document: edited })
    expect(laneNames()).toEqual(['membrane/V_clamp', 'parameters/g_Na'])
    expect(wrapper.find('.collapsed-note span').text()).toBe('2 parameters at their model values')
  })

  it('shows those an error or warning names', () => {
    const document = atModelValues()
    // CA refuses the row as too short; the editor reads the missing value as 0, T's model value.
    document.protocol_info.params_to_change['global_parameters/T'] = [[0]]
    mountEditor(document, { warn: () => ['parameters/g_K is ignored here.'] })
    expect(wrapper.find('.messages').text()).toContain('global_parameters/T[0]: 1 sub value(s), expected 2')
    expect(laneNames()).toEqual(['membrane/V_clamp', 'parameters/g_K', 'global_parameters/T'])
    expect(wrapper.find('.collapsed-note span').text()).toBe('1 parameter at its model value')
  })

  it('keeps one edited back to its model value shown', async () => {
    const document = atModelValues()
    document.protocol_info.params_to_change['parameters/g_Na'] = [[0.12, 0.2]]
    mountEditor(document)
    expect(laneNames()).toEqual(['parameters/g_Na', 'membrane/V_clamp'])
    await wrapper.find('[aria-label="Change how parameters/g_Na varies in sub-experiment 2"]').trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))
    await flushPromises()
    wrapper.findComponent(ProtocolCellEditor).vm.$emit('apply', { value: 0.12 })
    await flushPromises()
    const [edited] = emittedDocuments()
    expect(edited.protocol_info.params_to_change['parameters/g_Na']).toEqual([[0.12, 0.12]])
    await wrapper.setProps({ document: edited })
    expect(laneNames()).toEqual(['parameters/g_Na', 'membrane/V_clamp'])
    expect(wrapper.find('.collapsed-note span').text()).toBe('2 parameters at their model values')
  })

  it('reads a message as naming a parameter only by its whole name', () => {
    mountEditor(atModelValues(), { warn: () => ['parameters/g_Ks is ignored here.', 'See (global_parameters/T).'] })
    expect(laneNames()).toEqual(['membrane/V_clamp', 'global_parameters/T'])
    expect(wrapper.find('.collapsed-note span').text()).toBe('2 parameters at their model values')
  })

  it('shows those whose model value is unknown', () => {
    const getValue = (name) => (name === 'parameters/g_Na' ? undefined : name === 'global_parameters/T' ? 'n/a' : VARIABLES.find((variable) => variable.name === name)?.value)
    mountEditor(atModelValues(), { getValue })
    expect(laneNames()).toEqual(['parameters/g_Na', 'membrane/V_clamp', 'global_parameters/T'])
  })

  it('offers no line when none is at its model value', () => {
    mountEditor(readFixture('br-1977_obs_data.json'))
    expect(wrapper.find('.collapsed-note').exists()).toBe(false)
  })
})

describe('VariablePicker', () => {
  it('searches the variables given, keeping those the filter keeps, and emits the one picked', async () => {
    wrapper = mount(VariablePicker, {
      props: { variables: VARIABLES, filter: (variable) => variable.kind === 'constant' },
      global: { plugins: [PrimeVue] },
    })
    const autoComplete = wrapper.findComponent({ name: 'AutoComplete' })
    autoComplete.vm.$emit('complete', { query: 'g para' })
    await flushPromises()
    expect(autoComplete.props('suggestions').map((variable) => variable.name)).toEqual(['parameters/g_K', 'parameters/g_Na'])

    autoComplete.vm.$emit('option-select', { value: VARIABLES[3] })
    await flushPromises()
    expect(wrapper.emitted('pick')).toEqual([[VARIABLES[3]]])
  })
})
