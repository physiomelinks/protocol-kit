<template>
  <span ref="cellEl" class="variable-cell" @keydown.esc.stop="isPicking = false" @click.stop>
    <template v-if="isPicking">
      <VariablePicker :variables="variables" :placeholder="modelValue || 'Search for a variable…'" :aria-label="ariaLabel" @pick="pick" />
      <Button icon="pi pi-times" text rounded size="small" severity="secondary" :aria-label="`Clear ${ariaLabel}`" @click="choose('')" />
    </template>
    <button v-else type="button" class="od-value" :class="{ 'od-muted': !modelValue }" :title="modelValue" :aria-label="ariaLabel" @click="open">
      {{ modelValue || '—' }}
    </button>
  </span>
</template>

<script setup>
/**
 * A variable in a row of the obs_data editor: its name, which opens a search of the model's variables to pick another,
 * or to clear it, as CUFLynx's searchable select does.
 */
import { nextTick, ref } from 'vue'

import Button from 'primevue/button'

import VariablePicker from './VariablePicker.vue'

defineProps({
  // The variable's name, '' for none.
  modelValue: { type: String, default: '' },
  // The model's variables, as the editor's `variables` prop.
  variables: { type: Array, default: () => [] },
  ariaLabel: { type: String, default: 'Variable' },
})
const emit = defineEmits(['update:modelValue'])

const isPicking = ref(false)
const cellEl = ref(null)

/** Opens the search, the cursor in it. */
async function open() {
  isPicking.value = true
  await nextTick()
  cellEl.value?.querySelector('input')?.focus()
}

/**
 * Passes a variable's name on, '' to clear it, and closes the search.
 *
 * @param {string} name
 */
function choose(name) {
  isPicking.value = false
  emit('update:modelValue', name)
}

/**
 * Picks a variable from the search.
 *
 * @param {Object} variable - One of `variables`.
 */
const pick = (variable) => choose(variable.name)
</script>

<style scoped>
.variable-cell {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.variable-cell > :first-child {
  flex: 1;
  min-width: 0;
}
</style>
