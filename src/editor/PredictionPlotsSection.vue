<template>
  <section class="prediction-plots-section" aria-label="prediction_plots" :style="{ '--od-columns': `1.4fr 1fr 1fr 1.2fr 1.2fr ${readOnly ? '0' : '2rem'}` }">
    <h3 class="od-section">prediction_plots</h3>
    <div class="od-head" aria-hidden="true">
      <span>name</span>
      <span>kind</span>
      <span>y</span>
      <span>x</span>
      <span>series</span>
      <span></span>
    </div>
    <ul class="od-list" data-testid="od-prediction-plots">
      <li v-for="(plot, index) in plots" :key="index" :class="{ 'od-invalid': (checked.plotErrors[index] ?? []).length > 0 }" data-testid="od-plot-row">
        <div class="od-main">
          <template v-if="readOnly || !isMapping(plot)">
            <span class="od-cell" :title="plot?.name">{{ plot?.name || '—' }}</span>
            <span class="od-cell">{{ plot?.kind ?? '—' }}</span>
            <span class="od-cell">{{ plot?.y ?? '—' }}</span>
            <span class="od-cell">{{ describeAxis(plot?.x) }}</span>
            <span class="od-cell">{{ describeAxis(plot?.series, '(none)') }}</span>
          </template>
          <template v-else>
            <input type="text" :value="plot.name" aria-label="name" @change="(event) => edit(index, { name: event.target.value })" />
            <select :value="plot.kind" aria-label="kind" @change="(event) => changeKind(index, event.target.value)">
              <option v-for="kind in withOwn(KINDS, plot.kind)" :key="kind" :value="kind">{{ kind }}</option>
            </select>
            <select :value="plot.y" aria-label="y" @change="(event) => edit(index, { y: event.target.value })">
              <option v-for="group in withOwn(groupNames, plot.y)" :key="group" :value="group">{{ group }}</option>
            </select>
            <select v-if="plot.kind === 'feature_vs_feature'" :value="plot.x" aria-label="x" @change="(event) => edit(index, { x: event.target.value })">
              <option v-for="group in withOwn(groupNames, plot.x)" :key="group" :value="group">{{ group }}</option>
            </select>
            <select v-else :value="encodeInput(plot.x)" aria-label="x" @change="(event) => edit(index, { x: decodeInput(event.target.value) })">
              <option v-for="input in withOwn(inputs, plot.x)" :key="encodeInput(input)" :value="encodeInput(input)">{{ describeAxis(input) }}</option>
            </select>
            <select :value="encodeInput(plot.series)" aria-label="series" @change="(event) => edit(index, { series: decodeInput(event.target.value) })">
              <option :value="NONE">(none)</option>
              <option v-for="input in withOwn(inputs, plot.series)" :key="encodeInput(input)" :value="encodeInput(input)">{{ describeAxis(input) }}</option>
            </select>
          </template>
          <span class="od-rowbtns">
            <Button v-if="!readOnly" icon="pi pi-times" text rounded size="small" severity="danger" aria-label="remove" @click="emitDocument(removePredictionPlot(document, index))" />
          </span>
        </div>
        <p v-for="message in problemsOf(index)" :key="message" class="od-error">
          <i class="pi pi-times-circle" aria-hidden="true"></i>
          {{ message }}
        </p>
      </li>
      <li v-if="!plots.length" class="od-empty">{{ readOnly ? 'No prediction_plots.' : 'No prediction_plots. Add one below.' }}</li>
    </ul>
    <Button v-if="!readOnly" label="Add prediction plot" icon="pi pi-plus" size="small" text :disabled="!groupNames.length" @click="add" />
  </section>
</template>

<script setup>
/**
 * The prediction_plots of an obs_data document, a row each (name, kind, y, x, series) as the proposal to
 * circulatory_autogen writes them: y a group of features (an item_name_for_plotting), x another group or an input's
 * value in a sub-experiment, and series none or an input. Each plot is checked as the proposal says, its errors under
 * its row.
 */
import { computed } from 'vue'

import Button from 'primevue/button'

import './obsDataRows.css'
import { PREDICTION_PLOT_KINDS, addPredictionPlot, listFeatureGroups, listPredictionPlots, removePredictionPlot, updatePredictionPlot, validatePredictionPlots } from '../core/predictionPlots.js'
import { isMapping } from '../core/protocolShapes.js'

const KINDS = PREDICTION_PLOT_KINDS.map(({ value }) => value)
// The value of series' option for none.
const NONE = ''

const props = defineProps({
  // The obs_data document.
  document: { type: Object, required: true },
  readOnly: { type: Boolean, default: false },
})
const emit = defineEmits(['update:document'])

const plots = computed(() => listPredictionPlots(props.document))
const checked = computed(() => validatePredictionPlots(props.document))
const groupNames = computed(() => listFeatureGroups(props.document).filter(({ isFeature }) => isFeature).map(({ name }) => name))
// Each input in each sub-experiment, as a plot reads it.
const inputs = computed(() => {
  const info = isMapping(props.document.protocol_info) ? props.document.protocol_info : {}
  const subs = Math.max(0, ...(Array.isArray(info.sim_times) ? info.sim_times : []).map((row) => (Array.isArray(row) ? row.length : 0)))
  return Object.keys(isMapping(info.params_to_change) ? info.params_to_change : {}).flatMap((key) => Array.from({ length: subs }, (_, sub) => ({ params_to_change: key, subexperiment_idx: sub })))
})

/**
 * Lists the options of a select, and the plot's own value when it is none of them, so it shows.
 *
 * @param {Array} options
 * @param {*} own
 * @returns {Array}
 */
function withOwn(options, own) {
  if (own == null || own === '') return options
  const key = typeof own === 'string' ? own : encodeInput(own)
  return options.some((option) => (typeof option === 'string' ? option : encodeInput(option)) === key) ? options : [...options, own]
}

/**
 * Writes an input reference as an option's value.
 *
 * @param {*} reference
 * @returns {string}
 */
const encodeInput = (reference) => (isMapping(reference) ? JSON.stringify([reference.params_to_change, reference.subexperiment_idx]) : NONE)

/**
 * Reads an option's value as an input reference.
 *
 * @param {string} value
 * @returns {Object|null}
 */
function decodeInput(value) {
  if (value === NONE) return null
  const [key, sub] = JSON.parse(value)
  return { params_to_change: key, subexperiment_idx: sub }
}

/**
 * Describes what an axis reads: a group's name, or an input in a sub-experiment.
 *
 * @param {*} axis
 * @param {string} [none]
 * @returns {string}
 */
const describeAxis = (axis, none = '—') => (axis == null ? none : isMapping(axis) ? `${axis.params_to_change} [sub ${axis.subexperiment_idx}]` : String(axis))

/**
 * Lists a plot's errors, without its `prediction_plots[i] ('name')`.
 *
 * @param {number} index
 * @returns {string[]}
 */
const problemsOf = (index) => (checked.value.plotErrors[index] ?? []).map((message) => message.replace(/^prediction_plots\[\d+\]( \(.*?\))?: /, ''))

/** Passes an edited document on. */
const emitDocument = (document) => emit('update:document', document)

/**
 * Changes a plot.
 *
 * @param {number} index
 * @param {Object} change - Any of name, kind, x, y and series.
 */
const edit = (index, change) => emitDocument(updatePredictionPlot(props.document, index, change))

/**
 * Changes how a plot reads x: the first group, or the first input.
 *
 * @param {number} index
 * @param {string} kind
 */
function changeKind(index, kind) {
  const x = kind === 'feature_vs_feature' ? (groupNames.value.find((group) => group !== plots.value[index].y) ?? groupNames.value[0] ?? null) : (inputs.value[0] ?? null)
  edit(index, { kind, x })
}

/** Adds a plot of the first group against the first input, else another group, named after them. */
function add() {
  const y = groupNames.value[0]
  const isAgainstInput = inputs.value.length > 0
  const x = isAgainstInput ? inputs.value[0] : (groupNames.value.find((group) => group !== y) ?? y)
  const base = `${y} vs ${isAgainstInput ? x.params_to_change : x}`
  const names = new Set(plots.value.map((plot) => plot?.name))
  let name = base
  for (let suffix = 2; names.has(name); suffix++) name = `${base} (${suffix})`
  emitDocument(addPredictionPlot(props.document, { name, kind: isAgainstInput ? 'feature_vs_input' : 'feature_vs_feature', x, y }))
}
</script>
