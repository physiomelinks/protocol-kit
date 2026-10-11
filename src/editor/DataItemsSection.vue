<template>
  <section class="data-items-section" aria-label="data_items" :style="{ '--od-columns': gridColumns }">
    <div class="od-section-row">
      <h3 class="od-section">data_items</h3>
      <slot name="actions"></slot>
    </div>
    <div class="od-head" aria-hidden="true">
      <span v-for="column in rowColumns" :key="column.key">{{ column.label }}</span>
      <span></span>
    </div>
    <ul class="od-list" data-testid="od-data-items">
      <li
        v-for="row in rows"
        :key="row.index"
        :class="{ 'od-invalid': isInvalid(row), 'od-selected': row.index === selected, 'od-non-diff': isNonDifferentiable(row) }"
        data-testid="od-data-row"
      >
        <div class="od-main" @click="select(row)">
          <template v-for="column in rowColumns" :key="column.key">
            <template v-if="!isEditable">
              <span class="od-cell" :class="{ 'od-muted': cellText(row, column.key) === '(none)' }" :title="cellText(row, column.key)">{{ cellText(row, column.key) }}</span>
            </template>
            <input v-else-if="column.key === 'name'" type="text" :value="row.name" aria-label="name" @change="(event) => edit(row, { name: event.target.value })" />
            <input
              v-else-if="column.key === 'value' || column.key === 'std'"
              type="number"
              step="any"
              :value="row[column.key]"
              :aria-label="column.key"
              @change="(event) => edit(row, { [column.key]: readNumber(event.target.value) })"
            />
            <select v-else-if="column.key === 'operation'" :value="row.operation" aria-label="operation" @change="(event) => changeOperation(row, event.target.value)">
              <option v-for="option in operationOptions(row)" :key="option" :value="option" :class="{ 'od-non-diff-option': isNonDifferentiableOperation(option) }">{{ option || '(none)' }}</option>
            </select>
            <select v-else-if="column.key === 'experiment'" :value="row.experiment" aria-label="exp" @change="(event) => changeExperiment(row, Number(event.target.value))">
              <option v-for="experiment in experimentOptions(row)" :key="experiment" :value="experiment">{{ experiment }}</option>
            </select>
            <select v-else-if="column.key === 'subexperiment'" :value="row.subexperiment" aria-label="sub" @change="(event) => edit(row, { subexperiment: Number(event.target.value) })">
              <option v-for="sub in subOptions(row)" :key="sub" :value="sub">{{ sub }}</option>
            </select>
          </template>
          <span class="od-rowbtns">
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
            <Button v-if="isEditable" icon="pi pi-times" text rounded size="small" severity="danger" aria-label="remove" @click.stop="remove(row)" />
          </span>
        </div>

        <p v-if="isNonDifferentiable(row)" class="od-warn" data-testid="od-nondiff-warn">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          Operation “{{ row.operation }}” is not differentiable — automatic differentiation (AD) gradients are unavailable; gradient-based
          calibration/sensitivity falls back to finite differences.
        </p>
        <p v-for="message in problemsOf(row)" :key="message" class="od-error">
          <i class="pi pi-times-circle" aria-hidden="true"></i>
          {{ message }}
        </p>

        <div v-if="expanded.has(row.index)" :id="detailId(row)" class="od-detail">
          <template v-for="column in detailColumns" :key="column.key">
            <div v-if="column.key === 'operands'" class="od-field">
              operands
              <span class="od-operands">
                <span v-for="(operand, position) in operandSlots(row)" :key="position" class="od-operand">
                  <span v-if="operandLabel(row, position)" class="od-operand-name">{{ operandLabel(row, position) }}</span>
                  <span v-if="!isEditable" class="od-text">{{ operand || '—' }}</span>
                  <VariableCell
                    v-else
                    :model-value="operand"
                    :variables="variablesWithTime"
                    :aria-label="`operand ${operandLabel(row, position) || position + 1}`"
                    @update:model-value="(name) => changeOperand(row, position, name)"
                  />
                </span>
                <Button v-if="isEditable && !operandsAreFixed(row)" icon="pi pi-plus" label="operand" text size="small" @click="addOperand(row)" />
              </span>
            </div>
            <template v-else-if="column.key === 'cost'">
              <label>
                cost_type
                <span v-if="!isEditable" class="od-text">{{ row.costType || describeDefaultCost() }}</span>
                <select v-else :value="row.costType" aria-label="cost_type" @change="(event) => changeCostType(row, event.target.value)">
                  <option value="">{{ describeDefaultCost() }}</option>
                  <option v-for="cost in costOptions(row)" :key="cost.name" :value="cost.name">{{ describeCost(cost) }}</option>
                </select>
              </label>
              <KwargField
                v-for="field in kwargFields(costSpec(row), row.costKwargs)"
                :key="`cost-${field.name}`"
                :field="field"
                :model-value="row.costKwargs[field.name]"
                title="cost_kwargs"
                :read-only="!isEditable"
                @update:model-value="(value) => setKwarg(row, 'costKwargs', field.name, value)"
              />
            </template>
            <template v-else-if="column.key === 'operationKwargs'">
              <KwargField
                v-for="field in row.operation ? kwargFields(operationSpec(row), row.operationKwargs) : []"
                :key="field.name"
                :field="field"
                :model-value="row.operationKwargs[field.name]"
                :references="referenceNames(row)"
                :read-only="!isEditable"
                @update:model-value="(value) => setKwarg(row, 'operationKwargs', field.name, value)"
              />
            </template>
            <label v-else-if="column.key === 'plot'">
              plot_type
              <span v-if="!isEditable" class="od-text">{{ row.plotType == null ? '(default)' : row.plotType || '(none)' }}</span>
              <select v-else :value="row.plotType ?? DEFAULT_PLOT" aria-label="plot_type" @change="(event) => edit(row, { plotType: event.target.value === DEFAULT_PLOT ? null : event.target.value })">
                <option :value="DEFAULT_PLOT">(default)</option>
                <option v-for="plotType in ['', ...vocabulary.plotTypes]" :key="plotType" :value="plotType">{{ plotType || '(none)' }}</option>
              </select>
            </label>
            <label v-else-if="column.key === 'weight'">
              weight
              <span v-if="!isEditable" class="od-text">{{ row.weight }}</span>
              <input v-else type="number" step="any" :value="row.weight" aria-label="weight" @change="(event) => edit(row, { weight: readNumber(event.target.value) })" />
            </label>
            <label v-else-if="column.key === 'source' || column.key === 'comment'" class="od-wide">
              {{ column.key === 'source' ? 'source — where this data came from (e.g. paper / dataset / DOI)' : 'comment' }}
              <span v-if="!isEditable" class="od-text">{{ row[column.key] || '—' }}</span>
              <textarea v-else rows="2" :value="row[column.key]" :aria-label="column.key" @change="(event) => edit(row, { [column.key]: event.target.value })"></textarea>
            </label>
            <label v-else>
              {{ column.label }}
              <span v-if="!isEditable" class="od-text">{{ row[column.key] || '—' }}</span>
              <input v-else type="text" :value="row[column.key]" :aria-label="column.label" @change="(event) => edit(row, { [column.key]: event.target.value })" />
            </label>
          </template>
        </div>
      </li>
      <li v-if="!rows.length" class="od-empty">{{ isEditable ? 'No editable data_items. Add one below.' : 'No data_items.' }}</li>
    </ul>
    <Button v-if="isEditable" label="Add data item" icon="pi pi-plus" size="small" text @click="add" />
    <p v-if="preservedCount" class="od-note" data-testid="od-preserved">
      {{ preservedCount }} non-editable item(s) (series / frequency / custom operation) will be preserved unchanged.
    </p>
  </section>
</template>

<script setup>
/**
 * The data_items of an obs_data document as CUFLynx's dialog lists them: a row each (name, value, std, operation,
 * experiment, sub-experiment) and its details under a chevron, the columns the host chooses (`columns`, a preset of
 * DATA_ITEM_COLUMN_PRESETS or a list of keys). Rows CA would refuse are tinted and say why; an item a row can't hold (a
 * series, a frequency, an operation CA has not, a distribution) is kept as it is, and counted below.
 */
import { computed, ref, useId } from 'vue'

import Button from 'primevue/button'

import KwargField from './KwargField.vue'
import VariableCell from './VariableCell.vue'
import { DATA_ITEM_COLUMNS, isReadOnlyPreset, resolveDataItemColumns } from './dataItemColumns.js'
import './obsDataRows.css'
import { addDataItem, createDataItem, listDataItems, removeDataItem, updateDataItem } from '../core/dataItems.js'
import { validateDataItems } from '../core/dataItemValidation.js'
import { DATA_ITEM_COST_TYPES, DATA_ITEM_VOCABULARY } from '../core/dataItemVocabulary.js'
import { findFreeItemName } from '../core/predictionItems.js'
import { isMapping } from '../core/protocolShapes.js'

// The value of plot_type's option for the data type's default, which a row holds as null.
const DEFAULT_PLOT = 'default'
// The width of each column of the row.
const WIDTHS = { name: '1.4fr', value: '0.8fr', std: '0.8fr', operation: '1.2fr', experiment: '0.5fr', subexperiment: '0.5fr' }

const props = defineProps({
  // The obs_data document, or a bare list of data items.
  document: { type: [Object, Array], required: true },
  // The model's variables, as the editor's `variables` prop, for the operands.
  variables: { type: Array, default: () => [] },
  // The columns shown: 'cuflynx', 'phlynx', or a list of keys (DATA_ITEM_COLUMNS).
  columns: { type: [String, Array], default: 'cuflynx' },
  // Whether the items are only listed; by default as the preset says, and editable for a list of keys.
  readOnly: { type: Boolean, default: null },
  // The operations, cost funcs, data and plot types offered, as DATA_ITEM_VOCABULARY.
  vocabulary: { type: Object, default: () => DATA_ITEM_VOCABULARY },
  // The place in data_items of the item selected.
  selected: { type: Number, default: null },
})
const emit = defineEmits(['update:document', 'select'])

const shownKeys = computed(() => resolveDataItemColumns(props.columns))
const isEditable = computed(() => !(props.readOnly ?? isReadOnlyPreset(props.columns)))
const rowColumns = computed(() => DATA_ITEM_COLUMNS.filter(({ key, place }) => place === 'row' && shownKeys.value.includes(key)))
const detailColumns = computed(() => DATA_ITEM_COLUMNS.filter(({ key, place }) => place === 'detail' && shownKeys.value.includes(key)))
const gridColumns = computed(() => [...rowColumns.value.map(({ key }) => WIDTHS[key]), isEditable.value ? '4rem' : '2rem'].join(' '))
const isShown = (key) => shownKeys.value.includes(key)

const simTimes = computed(() => (isMapping(props.document) && Array.isArray(props.document.protocol_info?.sim_times) ? props.document.protocol_info.sim_times : []))
const items = computed(() => listDataItems(props.document))
const operationNames = computed(() => props.vocabulary.operations.map(({ name }) => name))
// The time, which an operation such as a period takes, and the model's variables.
const variablesWithTime = computed(() => [{ name: 'time', kind: 'variable' }, ...props.variables])

/**
 * Whether a row can hold an item: a constant of one value, with no operation or one CA has. A series, a frequency, a
 * distribution, or an operation of the user's own is kept as it is.
 *
 * @param {Object} row - From listDataItems.
 * @returns {boolean}
 */
const isRowItem = (row) =>
  row.dataType === 'constant' && (!row.operation || operationNames.value.includes(row.operation)) && !Array.isArray(row.value) && !Array.isArray(row.std) && !row.probDistParams

const rows = computed(() => items.value.filter(isRowItem))
const preservedCount = computed(() => items.value.length - rows.value.length)
// Checked read-only too, as CA refuses the file all the same.
const checked = computed(() => validateDataItems(props.document, { vocabulary: props.vocabulary }))

/**
 * Words an item's message for its row: without CA's `data_items[i] ('name')`.
 *
 * @param {string} message
 * @returns {string}
 */
const describeItemMessage = (message) => message.replace(/^data_items\[\d+\] \('.*?'\)(: | )/, (_, separator) => (separator === ': ' ? '' : 'It '))

/**
 * Lists the errors CA gives an item.
 *
 * @param {Object} row
 * @returns {string[]}
 */
const problemsOf = (row) => (checked.value.itemErrors[row.index] ?? []).map(describeItemMessage)

/**
 * Whether a row is one CA would refuse, as CUFLynx's rowInvalid says: a value and a std above 0 that are numbers, and
 * an operand or kwargs to read; or one CA's checks refuse.
 *
 * @param {Object} row
 * @returns {boolean}
 */
function isInvalid(row) {
  const hasInputs = row.operands.some(Boolean) || (!!row.operation && Object.keys(row.operationKwargs).length > 0)
  return !Number.isFinite(row.value) || !Number.isFinite(row.std) || !(row.std > 0) || !hasInputs || problemsOf(row).length > 0
}

const operationSpec = (row) => props.vocabulary.operations.find(({ name }) => name === row.operation) ?? null

/**
 * Whether CA can't differentiate an operation, so gradients fall back to finite differences.
 *
 * @param {string} operation
 * @returns {boolean}
 */
const isNonDifferentiableOperation = (operation) => isShown('differentiable') && !!operation && props.vocabulary.operations.find(({ name }) => name === operation)?.differentiable === false
const isNonDifferentiable = (row) => isNonDifferentiableOperation(row.operation)

/**
 * Writes a cell as a read-only row shows it.
 *
 * @param {Object} row
 * @param {string} key
 * @returns {string}
 */
function cellText(row, key) {
  if (key === 'operation') return row.operation || '(none)'
  return row[key] == null || row[key] === '' ? '—' : String(row[key])
}

/**
 * Reads a number field: none for no text.
 *
 * @param {string} text
 * @returns {number|null}
 */
const readNumber = (text) => (text.trim() === '' || !Number.isFinite(Number(text)) ? null : Number(text))

/** Passes an edited document on. */
const emitDocument = (document) => emit('update:document', document)

/**
 * Changes an item.
 *
 * @param {Object} row
 * @param {Object} change - Any of a row's fields.
 */
const edit = (row, change) => emitDocument(updateDataItem(props.document, row.index, change))

// The items whose details are open, by place.
const expanded = ref(new Set())
// The operand slots shown of the items the user added slots to, by place.
const addedSlots = ref(new Map())
const idPrefix = useId()
const detailId = (row) => `${idPrefix}-detail-${row.index}`

/**
 * Selects an item, and opens its details, as clicking anywhere on its row does in CUFLynx.
 *
 * @param {Object} row
 */
function select(row) {
  expanded.value = new Set([...expanded.value, row.index])
  emit('select', row.index)
}

/**
 * Opens an item's details and selects it, or closes them, leaving the selection.
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
  const index = items.value.length
  emitDocument(addDataItem(props.document, createDataItem()))
  expanded.value = new Set([...expanded.value, index])
  emit('select', index)
}

/**
 * Removes an item; the details open after it stay open, and the item selected stays selected.
 *
 * @param {Object} row
 */
function remove(row) {
  const shift = (index) => (index > row.index ? index - 1 : index)
  expanded.value = new Set([...expanded.value].filter((index) => index !== row.index).map(shift))
  addedSlots.value = new Map([...addedSlots.value].filter(([index]) => index !== row.index).map(([index, count]) => [shift(index), count]))
  emitDocument(removeDataItem(props.document, row.index))
  if (props.selected === row.index) emit('select', null)
  else if (props.selected != null && props.selected > row.index) emit('select', props.selected - 1)
}

// The experiments, or the one of a document with no protocol, and the item's own when it is out of range.
const experimentOptions = (row) => [...new Set([...Array.from({ length: Math.max(1, simTimes.value.length) }, (_, experiment) => experiment), row.experiment])]
const subOptions = (row) => {
  const subs = simTimes.value[row.experiment]
  return [...new Set([...Array.from({ length: Math.max(1, Array.isArray(subs) ? subs.length : 0) }, (_, sub) => sub), row.subexperiment])]
}

/**
 * Moves an item to an experiment, keeping its sub-experiment within the experiment's.
 *
 * @param {Object} row
 * @param {number} experiment
 */
function changeExperiment(row, experiment) {
  const subs = simTimes.value[experiment]
  const count = Array.isArray(subs) ? subs.length : 1
  edit(row, { experiment, subexperiment: Math.min(row.subexperiment, Math.max(0, count - 1)) })
}

// The operations offered, and the item's own.
const operationOptions = (row) => [...new Set(['', ...operationNames.value, row.operation])]

/**
 * The variables an operation reads, by place: those it names when it takes a fixed number, else as many as the item
 * has or the user added, one at least.
 *
 * @param {Object} row
 * @returns {string[]}
 */
function operandSlots(row) {
  const spec = operationSpec(row)
  const count = spec && !spec.acceptsAny ? Math.max(spec.operands.length, row.operands.length) : Math.max(row.operands.length, 1, addedSlots.value.get(row.index) ?? 0)
  return Array.from({ length: count }, (_, position) => row.operands[position] ?? '')
}
const operandsAreFixed = (row) => !!operationSpec(row) && !operationSpec(row).acceptsAny
const operandLabel = (row, position) => operationSpec(row)?.operands[position] ?? ''

/**
 * Sets an operand; the first names an unnamed item, apart from the others, as CUFLynx seeds it.
 *
 * @param {Object} row
 * @param {number} position
 * @param {string} name - '' to clear it.
 */
function changeOperand(row, position, name) {
  const operands = operandSlots(row)
  operands[position] = name
  const change = { operands }
  if (!row.name && position === 0 && name) change.name = findFreeItemName(props.document, name)
  edit(row, change)
}

/**
 * Adds a slot for a variable to an operation that takes any number, after those shown. The document keeps no blank
 * operand, so the slot is the editor's until it is filled.
 *
 * @param {Object} row
 */
function addOperand(row) {
  addedSlots.value = new Map([...addedSlots.value, [row.index, operandSlots(row).length + 1]])
}

/**
 * Changes the operation, dropping the kwargs it doesn't take and the operands past those it reads, as CUFLynx does.
 *
 * @param {Object} row
 * @param {string} operation
 */
function changeOperation(row, operation) {
  const spec = props.vocabulary.operations.find(({ name }) => name === operation)
  const operationKwargs = spec && !spec.acceptsAny ? Object.fromEntries(Object.entries(row.operationKwargs).filter(([name]) => spec.kwargs.some((field) => field.name === name))) : row.operationKwargs
  const operands = spec && !spec.acceptsAny ? Array.from({ length: spec.operands.length }, (_, position) => row.operands[position] ?? '') : row.operands
  edit(row, { operation, operationKwargs, operands })
}

/**
 * Lists the kwargs a func takes, then those the item has that it doesn't name.
 *
 * @param {Object|null} spec
 * @param {Object} kwargs
 * @returns {Array<{name: string, default: *, type: string}>}
 */
function kwargFields(spec, kwargs) {
  const fields = spec?.kwargs ?? []
  return [...fields, ...Object.keys(kwargs).filter((name) => !fields.some((field) => field.name === name)).map((name) => ({ name, default: null, type: 'any' }))]
}

/**
 * Sets or unsets a kwarg.
 *
 * @param {Object} row
 * @param {'operationKwargs'|'costKwargs'} group
 * @param {string} name
 * @param {*} value - Undefined to unset it.
 */
function setKwarg(row, group, name, value) {
  const kwargs = { ...row[group] }
  if (value === undefined) delete kwargs[name]
  else kwargs[name] = value
  edit(row, { [group]: kwargs })
}

/**
 * The other items an operation's argument may name.
 *
 * @param {Object} row
 * @returns {string[]}
 */
const referenceNames = (row) => items.value.filter((item) => item.index !== row.index && item.name).map((item) => item.name)

/**
 * Finds a cost func, among the host's or CA's own.
 *
 * @param {string} name
 * @returns {Object|undefined}
 */
const findCost = (name) => props.vocabulary.costTypes?.find((entry) => entry.name === name) ?? DATA_ITEM_COST_TYPES.find((entry) => entry.name === name)
const costSpec = (row) => findCost(row.costType || props.vocabulary.defaultCostType) ?? null
const costOptions = (row) => [...props.vocabulary.costTypes, ...(row.costType && !props.vocabulary.costTypes.some(({ name }) => name === row.costType) ? [{ name: row.costType }] : [])]

/**
 * Names the default cost, as CUFLynx does, so the items without one say what scores them.
 *
 * @returns {string}
 */
const describeDefaultCost = () => (props.vocabulary.defaultCostType ? `(default — ${props.vocabulary.defaultCostType})` : '(default)')

/**
 * Names a cost func with CA's flags: MLE, combiner, AD.
 *
 * @param {Object} cost
 * @returns {string}
 */
function describeCost(cost) {
  const tags = [cost.isMLE && 'MLE', cost.isCombiner && 'combiner', cost.differentiable && 'AD'].filter(Boolean)
  return tags.length ? `${cost.name} — ${tags.join(', ')}` : cost.name
}

/**
 * Changes the cost func, dropping the kwargs it doesn't take when it says what it takes.
 *
 * @param {Object} row
 * @param {string} costType
 */
function changeCostType(row, costType) {
  const spec = findCost(costType || props.vocabulary.defaultCostType)
  const costKwargs = spec && spec.acceptsAny === false ? Object.fromEntries(Object.entries(row.costKwargs).filter(([name]) => spec.kwargs.some((field) => field.name === name))) : row.costKwargs
  edit(row, { costType, costKwargs })
}
</script>
