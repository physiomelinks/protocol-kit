import { describe, expect, it } from 'vitest'

import { computeFeatures } from '../../src/core/features.js'
import { parseObsData, serialiseObsData } from '../../src/core/obsDataDocument.js'
import { removePredictionItem, updatePredictionItem } from '../../src/core/predictionItems.js'
import {
  addPredictionPlot,
  computePlotSeries,
  findPlotsLosingInput,
  listFeatureGroups,
  removePredictionPlot,
  updatePredictionPlot,
  validatePredictionPlots,
} from '../../src/core/predictionPlots.js'
import { addSubExperiment, findObservationsAt, moveExperiment, removeExperiment, removeSubExperiment } from '../../src/core/protocolEditing.js'

const STEP = (sub = 1) => ({ params_to_change: 'clamp/V_cmd', subexperiment_idx: sub })
const peak = (experiment, fields = {}) => ({
  data_item_name: `I_peak_e${experiment}`,
  operands: ['i_Na/i_Na'],
  unit: 'uA_per_cm2',
  operation: 'min_in_range',
  operation_kwargs: { start_frac: 0, end_frac: 0.2 },
  experiment_idx: experiment,
  subexperiment_idx: 1,
  item_name_for_plotting: 'I_peak',
  ...fields,
})
const step = (experiment) => ({ data_item_name: `V_step_e${experiment}`, operands: ['clamp/V_cmd'], unit: 'mV', operation: 'mean', experiment_idx: experiment, subexperiment_idx: 1, item_name_for_plotting: 'V_step' })
// The proposal's worked example: three voltage steps from a -80 mV hold, at two g_Na.
const DOCUMENT = {
  protocol_info: {
    pre_times: [1000, 1000, 1000],
    sim_times: [
      [50, 50],
      [50, 50],
      [50, 50],
    ],
    experiment_labels: ['step -40 mV', 'step -20 mV', 'step 0 mV'],
    params_to_change: {
      'clamp/V_cmd': [
        [-80, -40],
        [-80, -20],
        [-80, 0],
      ],
      'i_Na/g_Na': [
        [0.12, 0.12],
        [0.12, 0.06],
        [0.12, 0.12],
      ],
    },
  },
  data_items: [],
  prediction_items: [peak(0), peak(1, { data_type: 'constant', value: -3.4, std: 0.2 }), peak(2), step(0), step(1), step(2)],
  prediction_plots: [
    { name: 'Peak I_Na vs step potential', kind: 'feature_vs_feature', x: 'V_step', y: 'I_peak', series: null },
    { name: 'Peak I_Na vs command', kind: 'feature_vs_input', x: STEP(), y: 'I_peak', series: { params_to_change: 'i_Na/g_Na', subexperiment_idx: 1 } },
  ],
}

/**
 * Each experiment's sub-experiments, recorded: a sodium current peaking at -(e + 1) early in the step.
 *
 * @returns {Array<Array<Object>>}
 */
const SEGMENTS = [0, 1, 2].map((experiment) =>
  [0, 1].map((sub) => ({
    values: {
      'i_Na/i_Na': Float64Array.from({ length: 51 }, (_, index) => (sub === 1 && index === 3 ? -(experiment + 1) : 0)),
      'clamp/V_cmd': [DOCUMENT.protocol_info.params_to_change['clamp/V_cmd'][experiment][sub]],
    },
  }))
)

describe('listFeatureGroups', () => {
  it('groups prediction items as CA names them for plotting, with their experiments', () => {
    expect(listFeatureGroups(DOCUMENT).map(({ name, unit, experiments, isFeature }) => ({ name, unit, experiments, isFeature }))).toEqual([
      { name: 'I_peak', unit: 'uA_per_cm2', experiments: [0, 1, 2], isFeature: true },
      { name: 'V_step', unit: 'mV', experiments: [0, 1, 2], isFeature: true },
    ])
    expect(listFeatureGroups({ prediction_items: [{ data_item_name: 'V', operands: ['m/V'], unit: 'mV' }] })[0]).toMatchObject({ name: 'm/V', isFeature: false })
  })
})

describe('editing prediction plots', () => {
  it('adds, changes and removes plots, the list going with the last', () => {
    const { prediction_plots: _, ...bare } = DOCUMENT
    const added = addPredictionPlot(bare, { name: 'I_peak vs V_step', kind: 'feature_vs_feature', x: 'V_step', y: 'I_peak' })
    expect(added.prediction_plots).toEqual([{ name: 'I_peak vs V_step', kind: 'feature_vs_feature', x: 'V_step', y: 'I_peak', series: null }])
    expect(bare.prediction_plots).toBeUndefined()

    const updated = updatePredictionPlot({ ...added, prediction_plots: [{ ...added.prediction_plots[0], x_note: 'kept' }] }, 0, { kind: 'feature_vs_input', x: STEP() })
    expect(updated.prediction_plots[0]).toEqual({ name: 'I_peak vs V_step', kind: 'feature_vs_input', x: STEP(), y: 'I_peak', series: null, x_note: 'kept' })
    expect(updatePredictionPlot(added, 3, { name: 'none' })).toBe(added)

    expect(Object.hasOwn(removePredictionPlot(added, 0), 'prediction_plots')).toBe(false)
    expect(removePredictionPlot(added, 2)).toBe(added)
  })

  it('round-trips a file with plots, byte for byte, and through edits that leave them', () => {
    const text = `${JSON.stringify(DOCUMENT, null, 2)}\n`
    const { document } = parseObsData(text)
    expect(new TextDecoder().decode(serialiseObsData(document))).toBe(text)
    expect(removePredictionPlot(addPredictionPlot(document, { name: 'extra', kind: 'feature_vs_feature', x: 'I_peak', y: 'V_step' }), 2)).toEqual(document)
    expect(moveExperiment(moveExperiment(document, 0, 2), 2, 0)).toEqual(document)
    expect(addSubExperiment(document, 0).prediction_plots).toEqual(document.prediction_plots)
  })
})

describe('validatePredictionPlots', () => {
  const errorsOf = (plots, change = {}) => validatePredictionPlots({ ...DOCUMENT, ...change, prediction_plots: plots }).plotErrors

  it('passes the worked example, and a file without plots', () => {
    expect(validatePredictionPlots(DOCUMENT)).toEqual({ errors: [], plotErrors: [[], []] })
    expect(validatePredictionPlots({ prediction_items: [] })).toEqual({ errors: [], plotErrors: [] })
  })

  it('checks the list, its entries, their keys, names and kinds', () => {
    expect(validatePredictionPlots({ prediction_plots: {} }).errors).toEqual(["prediction_plots must be a list of dict entries, got <class 'dict'>"])
    expect(errorsOf([3, { name: 'a', kind: 'feature_vs_feature', x: 'V_step', y: 'I_peak', colour: 'r' }])).toEqual([
      ["prediction_plots[0] must be a dict, got <class 'int'>."],
      ["Unknown keys in prediction_plots[1] ('a') not in schema: ['colour']"],
    ])
    const plot = { kind: 'feature_vs_feature', x: 'V_step', y: 'I_peak' }
    expect(errorsOf([{ ...plot, name: ' ' }, { ...plot, name: 'a' }, { ...plot, name: 'a', kind: 'curve' }, { ...plot, name: 'b', kind: 'feature_vs_experiment', x: null }])).toEqual([
      ["prediction_plots[0] (' '): It needs a name: a string, not empty."],
      [],
      [
        "prediction_plots[2] ('a'): Its name is prediction_plots[1]'s too; each plot needs its own.",
        "prediction_plots[2] ('a'): Its kind must be 'feature_vs_feature' or 'feature_vs_input', got 'curve'.",
      ],
      ["prediction_plots[3] ('b'): Its kind must be 'feature_vs_feature' or 'feature_vs_input', got 'feature_vs_experiment'."],
    ])
  })

  it('checks that x fits the kind, and that the groups exist, are features, once per experiment, over the same experiments', () => {
    const items = [...DOCUMENT.prediction_items.slice(0, 5), { data_item_name: 'V_trace', operands: ['m/V'], unit: 'mV', item_name_for_plotting: 'V_step' }, peak(2, { data_item_name: 'again' })]
    expect(
      errorsOf(
        [
          { name: 'a', kind: 'feature_vs_feature', x: STEP(), y: 'I_peak' },
          { name: 'b', kind: 'feature_vs_feature', x: 'V_step', y: 'nothing' },
          { name: 'c', kind: 'feature_vs_feature', x: 'V_step', y: 'I_peak' },
          { name: 'd', kind: 'feature_vs_input', x: 'V_step', y: 'I_peak' },
        ],
        { prediction_items: items }
      )
    ).toEqual([
      [
        "prediction_plots[0] ('a'): y names 'I_peak', which has 2 items in experiment_idx 2 (I_peak_e2, again); a plot takes one per experiment.",
        "prediction_plots[0] ('a'): For a feature_vs_feature plot, x must name a group of features, got {'params_to_change': 'clamp/V_cmd', 'subexperiment_idx': 1}.",
      ],
      [
        "prediction_plots[1] ('b'): y names no prediction items: none has the item_name_for_plotting 'nothing'.",
        "prediction_plots[1] ('b'): x names 'V_step', which has items that aren't features: each needs an operation that gives one number, and no data_type 'series'.",
        "prediction_plots[1] ('b'): x names 'V_step', which has 2 items in experiment_idx 0 (V_step_e0, V_trace); a plot takes one per experiment.",
      ],
      [
        "prediction_plots[2] ('c'): y names 'I_peak', which has 2 items in experiment_idx 2 (I_peak_e2, again); a plot takes one per experiment.",
        "prediction_plots[2] ('c'): x names 'V_step', which has items that aren't features: each needs an operation that gives one number, and no data_type 'series'.",
        "prediction_plots[2] ('c'): x names 'V_step', which has 2 items in experiment_idx 0 (V_step_e0, V_trace); a plot takes one per experiment.",
        "prediction_plots[2] ('c'): x and y cover different experiments: 'V_step' experiment_idx [0, 1], 'I_peak' [0, 1, 2]. Each point needs both.",
      ],
      [
        "prediction_plots[3] ('d'): y names 'I_peak', which has 2 items in experiment_idx 2 (I_peak_e2, again); a plot takes one per experiment.",
        "prediction_plots[3] ('d'): x must be {'params_to_change': <key>, 'subexperiment_idx': <int>}, got 'V_step'.",
      ],
    ])
    expect(errorsOf([{ name: 'a', kind: 'feature_vs_feature', x: 'V_step', y: 'I_peak' }], { prediction_items: DOCUMENT.prediction_items.slice(0, 5) })).toEqual([
      ["prediction_plots[0] ('a'): x and y cover different experiments: 'V_step' experiment_idx [0, 1], 'I_peak' [0, 1, 2]. Each point needs both."],
    ])
  })

  it('checks that an input is set, to a number, in that sub-experiment of each experiment', () => {
    const info = structuredClone(DOCUMENT.protocol_info)
    info.sim_times[2] = [50]
    info.params_to_change['clamp/V_cmd'][1][1] = 'step_e1'
    const plot = { name: 'a', kind: 'feature_vs_input', y: 'I_peak' }
    expect(
      errorsOf(
        [
          { ...plot, x: STEP() },
          { ...plot, name: 'b', x: { params_to_change: 'clamp/V_hold', subexperiment_idx: 0 } },
          { ...plot, name: 'c', x: 'V_step' },
          { ...plot, name: 'd', x: { ...STEP(0), at: 1 }, series: { params_to_change: 'i_Na/g_Na', subexperiment_idx: 1.5 } },
        ],
        { protocol_info: info }
      )
    ).toEqual([
      [
        "prediction_plots[0] ('a'): x reads 'clamp/V_cmd' in experiment_idx 1, sub-experiment 1, which is 'step_e1': a shape or trace, not a number.",
        "prediction_plots[0] ('a'): x's subexperiment_idx 1 is not a sub-experiment of experiment_idx 2, which has 1.",
      ],
      ["prediction_plots[1] ('b'): x names the input 'clamp/V_hold', which protocol_info's params_to_change doesn't set."],
      ["prediction_plots[2] ('c'): x must be {'params_to_change': <key>, 'subexperiment_idx': <int>}, got 'V_step'."],
      [
        "prediction_plots[3] ('d'): x has keys it doesn't take: ['at']. It is {'params_to_change': <key>, 'subexperiment_idx': <int>}.",
        "prediction_plots[3] ('d'): series's subexperiment_idx must be an integer, got 1.5.",
      ],
    ])
  })
})

describe('plots follow protocol edits', () => {
  it('keeps an input read in the same sub-experiment when one before it goes, where its features are in that experiment alone', () => {
    const document = structuredClone(DOCUMENT)
    document.protocol_info.sim_times[0] = [50, 50, 50]
    for (const rows of Object.values(document.protocol_info.params_to_change)) rows[0].push(rows[0][1])
    document.prediction_items = [peak(0, { subexperiment_idx: 2 })]
    document.prediction_plots = [{ name: 'one', kind: 'feature_vs_input', x: STEP(2), y: 'I_peak', series: null }]
    expect(removeSubExperiment(document, 0, 0).prediction_plots).toEqual([{ name: 'one', kind: 'feature_vs_input', x: STEP(1), y: 'I_peak', series: null }])
    // Another experiment's removal changes nothing it reads.
    expect(removeSubExperiment(document, 1, 0).prediction_plots).toEqual(document.prediction_plots)
  })

  it('removes a plot that loses its input, and says so before', () => {
    // Removing sub-experiment 1 of experiment 0 takes the command the plot reads there; its items there go too.
    expect(findPlotsLosingInput(DOCUMENT, 0, 1)).toEqual([1])
    expect(findObservationsAt(DOCUMENT, 0, 1)).toEqual(['I_peak_e0', 'V_step_e0', 'Peak I_Na vs command (prediction plot)'])
    expect(removeSubExperiment(DOCUMENT, 0, 1).prediction_plots.map(({ name }) => name)).toEqual(['Peak I_Na vs step potential'])
    // Removing an earlier one of experiment 0 alone would read another sub-experiment there than in the others.
    expect(findPlotsLosingInput(DOCUMENT, 0, 0)).toEqual([1])
    expect(findObservationsAt(DOCUMENT, 0)).toEqual(['I_peak_e0', 'V_step_e0'])
  })

  it('keeps plots through experiments moving and going, their groups renumbered with them', () => {
    const removed = removeExperiment(DOCUMENT, 1)
    expect(removed.prediction_plots).toEqual(DOCUMENT.prediction_plots)
    expect(validatePredictionPlots(removed).errors).toEqual([])
  })

  it("follows a group renamed in its last item, and leaves a removed group's plots for validation to report", () => {
    // V_step's items, renamed one by one: the plots follow once the last of them is.
    let renamed = DOCUMENT
    for (const index of [3, 4]) renamed = updatePredictionItem(renamed, index, { itemName: 'V_command' })
    expect(renamed.prediction_plots[0]).toMatchObject({ x: 'V_step', y: 'I_peak' })
    renamed = updatePredictionItem(renamed, 5, { itemName: 'V_command' })
    expect(renamed.prediction_plots[0]).toMatchObject({ x: 'V_command', y: 'I_peak' })
    expect(validatePredictionPlots(renamed).errors).toEqual([])
    // A data_item_name is no group: the plots keep theirs.
    expect(updatePredictionItem(DOCUMENT, 0, { name: 'I_min' }).prediction_plots[0].y).toBe('I_peak')
    let removed = DOCUMENT
    for (const index of [5, 4, 3]) removed = removePredictionItem(removed, index)
    expect(validatePredictionPlots(removed).plotErrors[0]).toEqual([
      "prediction_plots[0] ('Peak I_Na vs step potential'): x names no prediction items: none has the item_name_for_plotting 'V_step'.",
    ])
  })
})

describe('computePlotSeries', () => {
  it("pairs each experiment's features into points, sorted by series then x, with measured data", () => {
    const [byFeature, byInput] = computePlotSeries(DOCUMENT, computeFeatures(DOCUMENT, SEGMENTS))
    expect(byFeature).toMatchObject({ name: 'Peak I_Na vs step potential', x: { label: 'V_step', unit: 'mV' }, y: { label: 'I_peak', unit: 'uA_per_cm2' }, series: null, errors: [], skipped: [] })
    expect(byFeature.points).toEqual([
      { experiment: 0, x: -40, y: -1, series: null, measured: null },
      { experiment: 1, x: -20, y: -2, series: null, measured: { value: -3.4, std: 0.2 } },
      { experiment: 2, x: 0, y: -3, series: null, measured: null },
    ])
    expect(byInput.x).toEqual({ label: 'clamp/V_cmd (sub-experiment 2)', unit: '' })
    expect(byInput.series).toEqual({ label: 'i_Na/g_Na (sub-experiment 2)' })
    expect(byInput.points.map(({ experiment, x, series }) => [experiment, x, series])).toEqual([
      [1, -20, 0.06],
      [0, -40, 0.12],
      [2, 0, 0.12],
    ])
  })

  it("skips what wasn't computed, and draws no invalid plot", () => {
    const document = { ...DOCUMENT, prediction_plots: [{ name: 'by step', kind: 'feature_vs_input', x: STEP(), y: 'I_peak', series: null }, { name: 'bad', kind: 'feature_vs_feature', x: 'none', y: 'I_peak' }] }
    const [byStep, bad] = computePlotSeries(document, computeFeatures(document, SEGMENTS.slice(0, 2)))
    expect(byStep.points.map(({ x, y }) => [x, y])).toEqual([
      [-40, -1],
      [-20, -2],
    ])
    expect(byStep.skipped).toEqual([{ experiment: 2, reason: "Sub-experiment 2 of experiment 3 wasn't run." }])
    expect(bad).toMatchObject({ points: [], errors: ["prediction_plots[1] ('bad'): x names no prediction items: none has the item_name_for_plotting 'none'."] })
  })
})
