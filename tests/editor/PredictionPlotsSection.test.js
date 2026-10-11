import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'

import { PredictionPlotsSection } from '../../src/editor/index.js'

const peak = (experiment) => ({
  data_item_name: `I_peak_e${experiment}`,
  operands: ['i_Na/i_Na'],
  unit: 'uA_per_cm2',
  operation: 'min_in_range',
  operation_kwargs: { start_frac: 0, end_frac: 0.2 },
  experiment_idx: experiment,
  subexperiment_idx: 1,
  item_name_for_plotting: 'I_peak',
})
const step = (experiment) => ({ data_item_name: `V_step_e${experiment}`, operands: ['clamp/V_cmd'], unit: 'mV', operation: 'mean', experiment_idx: experiment, subexperiment_idx: 1, item_name_for_plotting: 'V_step' })
const DOCUMENT = {
  protocol_info: {
    pre_times: [0, 0],
    sim_times: [
      [50, 50],
      [50, 50],
    ],
    params_to_change: {
      'clamp/V_cmd': [
        [-80, -40],
        [-80, 0],
      ],
    },
  },
  data_items: [],
  prediction_items: [peak(0), peak(1), step(0), step(1), { data_item_name: 'V', operands: ['membrane/V'], unit: 'mV' }],
  prediction_plots: [{ name: 'I-V', kind: 'feature_vs_input', x: { params_to_change: 'clamp/V_cmd', subexperiment_idx: 1 }, y: 'I_peak', series: null }],
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
 * @param {Object} obsData
 * @param {Object} [props]
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountSection(obsData, props = {}) {
  wrapper = mount(PredictionPlotsSection, { props: { document: obsData, ...props }, global: { plugins: [PrimeVue] }, attachTo: globalThis.document.body })
  return wrapper
}

const lastDocument = () => wrapper.emitted('update:document').at(-1)[0]
const rows = () => wrapper.findAll('[data-testid="od-plot-row"]')

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

describe('PredictionPlotsSection', () => {
  it('lists a row per plot: name, kind, y, x and series, over the feature groups and inputs', () => {
    mountSection(DOCUMENT)
    expect(wrapper.find('h3').text()).toBe('prediction_plots')
    expect(wrapper.findAll('.od-head span').map((head) => head.text())).toEqual(['name', 'kind', 'y', 'x', 'series', ''])
    const [plot] = rows()
    expect(plot.find('[aria-label="name"]').element.value).toBe('I-V')
    expect(plot.find('[aria-label="kind"]').element.value).toBe('feature_vs_input')
    // Only the groups of features: V, a trace, isn't one.
    expect(plot.findAll('[aria-label="y"] option').map((option) => option.text())).toEqual(['I_peak', 'V_step'])
    expect(plot.findAll('[aria-label="x"] option').map((option) => option.text())).toEqual(['clamp/V_cmd [sub 0]', 'clamp/V_cmd [sub 1]'])
    expect(plot.find('[aria-label="series"]').element.value).toBe('')
    expect(plot.classes()).not.toContain('od-invalid')
  })

  it('edits a plot: against another group, a line per value of an input', async () => {
    mountSection(DOCUMENT)
    await change(rows()[0], 'kind', 'feature_vs_feature')
    expect(lastDocument().prediction_plots[0]).toEqual({ name: 'I-V', kind: 'feature_vs_feature', x: 'V_step', y: 'I_peak', series: null })
    await change(rows()[0], 'series', JSON.stringify(['clamp/V_cmd', 0]))
    expect(lastDocument().prediction_plots[0].series).toEqual({ params_to_change: 'clamp/V_cmd', subexperiment_idx: 0 })
  })

  it('tints a plot the checks refuse, and says why', () => {
    mountSection({ ...DOCUMENT, prediction_plots: [{ ...DOCUMENT.prediction_plots[0], y: 'membrane/V' }] })
    expect(rows()[0].classes()).toContain('od-invalid')
    expect(rows()[0].find('.od-error').text()).toBe("y names 'membrane/V', which has items that aren't features: each needs an operation that gives one number, and no data_type 'series'.")
  })

  it('adds a plot of the first group against the first input, and removes one', async () => {
    mountSection(DOCUMENT)
    await wrapper.findAll('button').find((button) => button.text() === 'Add prediction plot').trigger('click')
    expect(lastDocument().prediction_plots[1]).toEqual({ name: 'I_peak vs clamp/V_cmd', kind: 'feature_vs_input', x: { params_to_change: 'clamp/V_cmd', subexperiment_idx: 0 }, y: 'I_peak', series: null })
    await rows()[0].find('[aria-label="remove"]').trigger('click')
    expect(lastDocument()).not.toHaveProperty('prediction_plots')
  })

  it('lists them read-only, and says there are none', () => {
    mountSection(DOCUMENT, { readOnly: true })
    expect(rows()[0].findAll('.od-cell').map((cell) => cell.text())).toEqual(['I-V', 'feature_vs_input', 'I_peak', 'clamp/V_cmd [sub 1]', '(none)'])
    wrapper.unmount()
    const { prediction_plots: _, ...withoutPlots } = DOCUMENT
    mountSection(withoutPlots)
    expect(wrapper.find('.od-empty').text()).toBe('No prediction_plots. Add one below.')
  })
})
