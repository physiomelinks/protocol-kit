<template>
  <section class="obs-data-editor">
    <h3 class="od-section">protocol_info</h3>
    <template v-if="!hasProtocol">
      <Button label="Add protocol_info" icon="pi pi-plus" size="small" @click="addProtocol" />
      <p class="od-hint">
        This is a data-only obs_data with no protocol. Add one to define experiments, controlled inputs (params_to_change), and prediction_items.
      </p>
    </template>
    <ProtocolInfoEditor
      v-else
      v-model:active-exp="activeExp"
      :document="document"
      :variables="variables"
      :get-value="getValue"
      :confirm="confirm"
      :palette="palette"
      :warn="warn"
      :highlight-exp="highlight.experiment"
      :highlight-subexp="highlight.subexperiment"
      @update:document="emitDocument"
    />

    <DataItemsSection
      v-if="showDataItems"
      :document="document ?? []"
      :variables="variables"
      :columns="dataItemColumns ?? preset"
      :read-only="dataItemsReadOnly"
      :vocabulary="vocabulary"
      :selected="selection?.section === 'data' ? selection.index : null"
      @select="(index) => select('data', index)"
      @update:document="emitDocument"
    >
      <template #actions><slot name="data-items-actions"></slot></template>
    </DataItemsSection>

    <template v-if="hasProtocol">
      <PredictionItemsSection
        :document="document"
        :variables="variables"
        :columns="preset"
        :vocabulary="vocabulary"
        :dt="dt"
        :selected="selection?.section === 'prediction' ? selection.index : null"
        @select="(index) => select('prediction', index)"
        @update:document="emitDocument"
      />
      <PredictionPlotsSection :document="document" @update:document="emitDocument" />
    </template>
  </section>
</template>

<script setup>
/**
 * Edits an obs_data document as CUFLynx's "Edit obs_data" dialog does, a section for each of its keys: its
 * protocol_info on a timeline (ProtocolInfoEditor), its data_items and prediction_items as rows (DataItemsSection,
 * PredictionItemsSection), and its prediction_plots. Selecting an item's row shows its experiment and tints its
 * sub-experiment there. A data-only document (no protocol_info) offers to add one, and shows only its data items.
 *
 * The host gives its model's variables, and chooses the preset of its app: 'cuflynx' edits every column; 'phlynx' shows
 * the data items read-only, without what a calibration needs of them.
 */
import { computed, ref, watch } from 'vue'

import Button from 'primevue/button'

import DataItemsSection from './DataItemsSection.vue'
import PredictionItemsSection from './PredictionItemsSection.vue'
import PredictionPlotsSection from './PredictionPlotsSection.vue'
import ProtocolInfoEditor from './ProtocolInfoEditor.vue'
import './obsDataRows.css'
import { DATA_ITEM_VOCABULARY } from '../core/dataItemVocabulary.js'
import { EXPERIMENT_PALETTE } from '../core/experimentColours.js'
import { readObsDataParts } from '../core/obsDataDocument.js'
import { ensureProtocol } from '../core/protocolEditing.js'

const props = defineProps({
  // The obs_data document, or null when the workspace has none.
  document: { type: [Object, Array], default: null },
  // The model's variables, by the names a protocol gives them: `{ name, label, unit, kind, value }`.
  variables: { type: Array, default: () => [] },
  // Reads a variable's value in the model, by its name, when its `value` may be out of date.
  getValue: { type: Function, default: null },
  // Asks before removing something from the protocol: `(options) => Promise<boolean>`.
  confirm: { type: Function, default: null },
  // The colours of experiments the file doesn't colour, by place.
  palette: { type: Array, default: () => EXPERIMENT_PALETTE },
  // The host's own warnings about a protocol_info: `(protocolInfo) => string[]`.
  warn: { type: Function, default: null },
  // The time between the samples a run records, to check that each prediction item's range takes some.
  dt: { type: Number, default: null },
  // The host's app: 'cuflynx' or 'phlynx' (DATA_ITEM_COLUMN_PRESETS, PREDICTION_ITEM_COLUMN_PRESETS).
  preset: { type: String, default: 'cuflynx' },
  // Whether to show the data items, which the host may leave to its own settings.
  showDataItems: { type: Boolean, default: true },
  // The data items' columns, when not the preset's: a list of keys (DATA_ITEM_COLUMNS).
  dataItemColumns: { type: [String, Array], default: null },
  // Whether the data items are only listed; by default as the preset says.
  dataItemsReadOnly: { type: Boolean, default: null },
  // The operations, cost funcs, data and plot types offered, as DATA_ITEM_VOCABULARY (readObsDataOptions reads
  // CUFLynx's).
  vocabulary: { type: Object, default: () => DATA_ITEM_VOCABULARY },
})
const emit = defineEmits(['update:document'])

const hasProtocol = computed(() => !!props.document && readObsDataParts(props.document).protocolInfo != null)
// The experiment the timeline shows, and the row selected: `{ section: 'data'|'prediction', index }`.
const activeExp = ref(0)
const selection = ref(null)

// The experiment and sub-experiment of the item selected: a data item's, by default the first; a prediction item's,
// by default its experiment's last.
const highlight = computed(() => {
  const { section, index } = selection.value ?? {}
  const parts = props.document ? readObsDataParts(props.document) : null
  const item = section === 'data' ? parts?.dataItems[index] : section === 'prediction' ? props.document?.prediction_items?.[index] : null
  if (!item || typeof item !== 'object') return { experiment: null, subexperiment: null }
  const experiment = Number(item.experiment_idx ?? 0)
  const subs = parts.protocolInfo?.sim_times?.[experiment]
  const last = Array.isArray(subs) ? subs.length - 1 : 0
  return { experiment, subexperiment: Number(item.subexperiment_idx ?? (section === 'data' ? 0 : last)) }
})

/**
 * Selects an item's row, showing its experiment in the timeline, as CUFLynx's selectRow does.
 *
 * @param {'data'|'prediction'} section
 * @param {number|null} index - Null to clear the selection.
 */
function select(section, index) {
  selection.value = index == null ? null : { section, index }
  if (hasProtocol.value && highlight.value.experiment != null) activeExp.value = highlight.value.experiment
}

// A document gaining or losing protocol_info clears the selection.
watch(
  () => props.document == null || hasProtocol.value,
  () => (selection.value = null)
)

/**
 * Counts the items of a section of the document.
 *
 * @param {'data'|'prediction'} section
 * @returns {number}
 */
function countItems(section) {
  if (!props.document) return 0
  const items = section === 'data' ? readObsDataParts(props.document).dataItems : props.document.prediction_items
  return Array.isArray(items) ? items.length : 0
}

// A document without the item selected (one undone, or replaced) clears the selection.
watch(
  () => props.document,
  () => {
    if (selection.value && selection.value.index >= countItems(selection.value.section)) selection.value = null
  }
)

/** Passes an edited document on. */
const emitDocument = (document) => emit('update:document', document)

/** Gives a data-only document a protocol of one experiment, as CUFLynx's "Add protocol_info" does. */
function addProtocol() {
  activeExp.value = 0
  emitDocument(ensureProtocol(props.document))
}
</script>

<style scoped>
.od-hint {
  margin: 0.4rem 0 0.5rem;
  font-size: 0.8rem;
  color: var(--p-text-muted-color, #64748b);
}
</style>
