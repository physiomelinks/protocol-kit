<template>
  <section class="prediction-items-section" aria-label="prediction_items" :style="{ '--od-columns': gridColumns }">
    <h3 class="od-section">prediction_items</h3>
    <p v-for="message in sharedErrors" :key="message" class="od-error">
      <i class="pi pi-times-circle" aria-hidden="true"></i>
      {{ message }}
    </p>
    <p v-for="message in checked.warnings" :key="message" class="od-warn">
      <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
      {{ message }}
    </p>
    <div class="od-head" aria-hidden="true">
      <span v-for="column in rowColumns" :key="column.key">{{ column.label }}</span>
      <span></span>
    </div>
    <ul class="od-list" data-testid="od-prediction-items">
      <li v-for="row in rows" :key="row.index" :class="{ 'od-invalid': problemsOf(row).length > 0, 'od-selected': row.index === selected }" data-testid="od-prediction-row">
        <div class="od-main" @click="select(row)">
          <template v-for="column in rowColumns" :key="column.key">
            <span v-if="readOnly" class="od-cell" :title="cellText(row, column.key)">{{ cellText(row, column.key) }}</span>
            <VariableCell
              v-else-if="column.key === 'variable'"
              :model-value="row.operands[0] ?? ''"
              :variables="variables"
              aria-label="variable"
              @update:model-value="(name) => changeVariable(row, name)"
            />
            <input
              v-else-if="column.key === 'unit' || column.key === 'traceName'"
              type="text"
              :placeholder="column.label"
              :value="row[column.key]"
              :aria-label="column.label"
              @change="(event) => edit(row, { [column.key]: event.target.value })"
            />
            <select v-else-if="column.key === 'experiment'" :value="row.experiment" aria-label="exp" @change="(event) => changeExperiment(row, Number(event.target.value))">
              <option v-for="experiment in experimentOptions(row)" :key="experiment" :value="experiment">{{ experiment }}</option>
            </select>
            <select v-else-if="column.key === 'subexperiment'" :value="row.subexperiment ?? LAST" aria-label="sub" @change="(event) => edit(row, { subexperiment: event.target.value === LAST ? null : Number(event.target.value) })">
              <option :value="LAST">(last)</option>
              <option v-for="sub in subOptions(row)" :key="sub" :value="sub">{{ sub }}</option>
            </select>
            <select v-else-if="column.key === 'operation'" :value="row.operation" aria-label="operation" @change="(event) => changeOperation(row, event.target.value)">
              <option v-for="option in operationOptions(row)" :key="option" :value="option">{{ option || '(none)' }}</option>
            </select>
          </template>
          <span class="od-rowbtns">
            <span v-if="row.isValidationData" class="od-chip" title="Held-out data to validate against: kept as it is">obs</span>
            <Button
              :icon="expanded.has(row.index) ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
              text
              rounded
              size="small"
              aria-label="details"
              :aria-expanded="expanded.has(row.index)"
              :aria-controls="expanded.has(row.index) ? detailId(row) : undefined"
              @click.stop="toggle(row)"
            />
            <Button v-if="!readOnly" icon="pi pi-times" text rounded size="small" severity="danger" aria-label="remove" @click.stop="remove(row)" />
          </span>
        </div>

        <p v-for="message in problemsOf(row)" :key="message" class="od-error">
          <i class="pi pi-times-circle" aria-hidden="true"></i>
          {{ message }}
        </p>

        <div v-if="expanded.has(row.index)" :id="detailId(row)" class="od-detail">
          <template v-for="column in detailColumns" :key="column.key">
            <template v-if="column.key === 'operationKwargs'">
              <KwargField
                v-for="field in row.operation ? kwargFields(row) : []"
                :key="field.name"
                :field="field"
                :model-value="row.operationKwargs[field.name]"
                :references="referenceNames(row)"
                :read-only="readOnly"
                @update:model-value="(value) => setKwarg(row, field.name, value)"
              />
            </template>
            <label v-else>
              {{ column.label }}
              <span v-if="readOnly" class="od-text">{{ row[column.key] || '—' }}</span>
              <input
                v-else
                type="text"
                :value="row[column.key]"
                :placeholder="column.key === 'itemName' ? defaultItemName(row) : ''"
                :aria-label="column.label"
                @change="(event) => edit(row, { [column.key]: event.target.value })"
              />
            </label>
          </template>
        </div>
      </li>
      <li v-if="!rows.length" class="od-empty">{{ readOnly ? 'No prediction_items.' : 'No prediction_items. Add one below.' }}</li>
    </ul>
    <Button v-if="!readOnly" label="Add prediction" icon="pi pi-plus" size="small" text @click="add" />
  </section>
</template>

<script setup>
/**
 * The prediction_items of an obs_data document as CUFLynx's dialog lists them: a row each (variable, unit, trace label,
 * experiment, sub-experiment, operation) and its name, item label and operation kwargs under a chevron. Each item is
 * checked as CA #536 reads it, its errors under its row; held-out data is marked `obs`, and kept as it is.
 */
import { computed, ref, useId } from 'vue'

import Button from 'primevue/button'

import KwargField from './KwargField.vue'
import VariableCell from './VariableCell.vue'
import { PREDICTION_ITEM_COLUMNS, resolvePredictionItemColumns } from './predictionItemColumns.js'
import './obsDataRows.css'
import { DATA_ITEM_VOCABULARY } from '../core/dataItemVocabulary.js'
import { addPredictionItem, buildPredictionItem, createPredictionItem, listPredictionItems, removePredictionItem, updatePredictionItem } from '../core/predictionItems.js'
import { nameItemForPlotting, validatePredictionItems } from '../core/predictionValidation.js'
import { isMapping } from '../core/protocolShapes.js'

// The value of the sub-experiment's option for the experiment's last, which a row holds as null.
const LAST = 'last'
// The width of each column of the row.
const WIDTHS = { variable: '1.4fr', unit: '0.9fr', traceName: '1.1fr', experiment: '0.5fr', subexperiment: '0.6fr', operation: '1.1fr' }

const props = defineProps({
  // The obs_data document.
  document: { type: [Object, Array], required: true },
  // The model's variables, as the editor's `variables` prop.
  variables: { type: Array, default: () => [] },
  // The columns shown: 'cuflynx', 'phlynx', or a list of keys (PREDICTION_ITEM_COLUMNS).
  columns: { type: [String, Array], default: 'cuflynx' },
  readOnly: { type: Boolean, default: false },
  // The operations offered, as DATA_ITEM_VOCABULARY's.
  vocabulary: { type: Object, default: () => DATA_ITEM_VOCABULARY },
  // The time between the samples a run records, to check that each range takes some.
  dt: { type: Number, default: null },
  // The place in prediction_items of the item selected.
  selected: { type: Number, default: null },
})
const emit = defineEmits(['update:document', 'select'])

const shownKeys = computed(() => resolvePredictionItemColumns(props.columns))
const rowColumns = computed(() => PREDICTION_ITEM_COLUMNS.filter(({ key, place }) => place === 'row' && shownKeys.value.includes(key)))
const detailColumns = computed(() => PREDICTION_ITEM_COLUMNS.filter(({ key, place }) => place === 'detail' && shownKeys.value.includes(key)))
const gridColumns = computed(() => [...rowColumns.value.map(({ key }) => WIDTHS[key]), props.readOnly ? '4rem' : '6rem'].join(' '))

const simTimes = computed(() => (isMapping(props.document) && Array.isArray(props.document.protocol_info?.sim_times) ? props.document.protocol_info.sim_times : []))
const rows = computed(() => listPredictionItems(props.document))
const checked = computed(() => (isMapping(props.document) ? validatePredictionItems(props.document, { dt: props.dt }) : { errors: [], warnings: [], itemErrors: [] }))
// What CA refuses of the items together, such as a name two items have.
const sharedErrors = computed(() => {
  const own = new Set(checked.value.itemErrors.flat())
  return checked.value.errors.filter((message) => !own.has(message))
})

/**
 * Lists the errors CA gives an item, without its `prediction_items[i] ('name')`.
 *
 * @param {Object} row
 * @returns {string[]}
 */
const problemsOf = (row) => (checked.value.itemErrors[row.index] ?? []).map((message) => message.replace(/^prediction_items\[\d+\]( \('.*?'\))?(: | )/, (_, name, separator) => (separator === ': ' ? '' : 'It ')))

/**
 * Writes a cell as a read-only row shows it.
 *
 * @param {Object} row
 * @param {string} key
 * @returns {string}
 */
function cellText(row, key) {
  if (key === 'variable') return row.operands[0] ?? '—'
  if (key === 'subexperiment') return row.subexperiment == null ? '(last)' : String(row.subexperiment)
  if (key === 'operation') return row.operation || '(none)'
  return row[key] === '' || row[key] == null ? '—' : String(row[key])
}

/**
 * Names the group CA plots an item in when it has no item label of its own.
 *
 * @param {Object} row
 * @returns {string}
 */
const defaultItemName = (row) => nameItemForPlotting(buildPredictionItem({ ...row, itemName: '' }))

/** Passes an edited document on. */
const emitDocument = (document) => emit('update:document', document)

/**
 * Changes an item.
 *
 * @param {Object} row
 * @param {Object} change - Any of a row's fields.
 */
const edit = (row, change) => emitDocument(updatePredictionItem(props.document, row.index, change))

// The items whose details are open, by place.
const expanded = ref(new Set())
const idPrefix = useId()
const detailId = (row) => `${idPrefix}-detail-${row.index}`

/**
 * Selects an item and opens its details.
 *
 * @param {Object} row
 */
function select(row) {
  expanded.value = new Set([...expanded.value, row.index])
  emit('select', row.index)
}

/**
 * Opens an item's details and selects it, or closes them.
 *
 * @param {Object} row
 */
function toggle(row) {
  if (!expanded.value.has(row.index)) return select(row)
  const open = new Set(expanded.value)
  open.delete(row.index)
  expanded.value = open
}

/** Adds an item, as CUFLynx's editor begins one, and opens it. */
function add() {
  const index = rows.value.length
  emitDocument(addPredictionItem(props.document, createPredictionItem()))
  expanded.value = new Set([...expanded.value, index])
  emit('select', index)
}

/**
 * Removes an item; the details open after it stay open, and the item selected stays selected.
 *
 * @param {Object} row
 */
function remove(row) {
  expanded.value = new Set([...expanded.value].filter((index) => index !== row.index).map((index) => (index > row.index ? index - 1 : index)))
  emitDocument(removePredictionItem(props.document, row.index))
  if (props.selected === row.index) emit('select', null)
  else if (props.selected != null && props.selected > row.index) emit('select', props.selected - 1)
}

/**
 * Picks the variable an item records; it names an unnamed item, and gives its unit when it has none of its own.
 *
 * @param {Object} row
 * @param {string} name - '' to clear it.
 */
function changeVariable(row, name) {
  const change = { operands: name ? [name] : [] }
  const unit = props.variables.find((variable) => variable.name === name)?.unit
  if (unit && (!row.unit || row.unit === 'dimensionless')) change.unit = unit
  edit(row, change)
}

// The experiments, and the item's own when it is out of range.
const experimentOptions = (row) => [...new Set([...Array.from({ length: Math.max(1, simTimes.value.length) }, (_, experiment) => experiment), row.experiment])]
const subOptions = (row) => {
  const subs = simTimes.value[row.experiment]
  const options = Array.from({ length: Array.isArray(subs) ? subs.length : 0 }, (_, sub) => sub)
  return row.subexperiment == null || options.includes(row.subexperiment) ? options : [...options, row.subexperiment]
}

/**
 * Moves an item to an experiment; a sub-experiment the experiment lacks becomes its last.
 *
 * @param {Object} row
 * @param {number} experiment
 */
function changeExperiment(row, experiment) {
  const subs = simTimes.value[experiment]
  const isKept = row.subexperiment == null || (Array.isArray(subs) && row.subexperiment < subs.length)
  edit(row, { experiment, ...(isKept ? {} : { subexperiment: null }) })
}

// The operations offered, and the item's own.
const operationOptions = (row) => [...new Set(['', ...props.vocabulary.operations.map(({ name }) => name), row.operation])]
const operationSpec = (row) => props.vocabulary.operations.find(({ name }) => name === row.operation) ?? null

/**
 * Changes the operation, dropping the kwargs it doesn't take.
 *
 * @param {Object} row
 * @param {string} operation
 */
function changeOperation(row, operation) {
  const spec = props.vocabulary.operations.find(({ name }) => name === operation)
  const operationKwargs = spec && !spec.acceptsAny ? Object.fromEntries(Object.entries(row.operationKwargs).filter(([name]) => spec.kwargs.some((field) => field.name === name))) : row.operationKwargs
  edit(row, { operation, operationKwargs })
}

/**
 * Lists the kwargs the item's operation takes, start_frac and end_frac for a range, then those it has that it doesn't
 * name.
 *
 * @param {Object} row
 * @returns {Array<{name: string, default: *, type: string}>}
 */
function kwargFields(row) {
  const fields = operationSpec(row)?.kwargs ?? []
  return [...fields, ...Object.keys(row.operationKwargs).filter((name) => !fields.some((field) => field.name === name)).map((name) => ({ name, default: null, type: 'any' }))]
}

/**
 * Sets or unsets a kwarg.
 *
 * @param {Object} row
 * @param {string} name
 * @param {*} value - Undefined to unset it.
 */
function setKwarg(row, name, value) {
  const operationKwargs = { ...row.operationKwargs }
  if (value === undefined) delete operationKwargs[name]
  else operationKwargs[name] = value
  edit(row, { operationKwargs })
}

/**
 * The items computed before this one, which an operation's argument may name.
 *
 * @param {Object} row
 * @returns {string[]}
 */
const referenceNames = (row) => rows.value.filter((item) => item.index < row.index && item.name).map((item) => item.name)
</script>
