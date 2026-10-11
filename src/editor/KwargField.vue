<template>
  <label class="kwarg-field" :title="`${title} (default ${formatValue(field.default)})`">
    {{ field.name }}
    <span v-if="readOnly" class="od-text">{{ formatValue(shown) }}</span>
    <input v-else-if="field.type === 'boolean'" type="checkbox" class="kwarg-bool" :checked="!!shown" :aria-label="field.name" @change="(event) => emit('update:modelValue', event.target.checked)" />
    <!-- An operation of no operands takes other items by name, which CA resolves: chosen, never typed. -->
    <select v-else-if="field.type === 'data_item'" :value="modelValue ?? ''" :aria-label="field.name" @change="(event) => emit('update:modelValue', event.target.value || undefined)">
      <option value="">—</option>
      <option v-for="name in referenceOptions" :key="name" :value="name">{{ name }}</option>
    </select>
    <input
      v-else
      :type="field.type === 'number' ? 'number' : 'text'"
      step="any"
      :value="formatValue(shown, '')"
      :aria-label="field.name"
      @change="(event) => change(event.target.value)"
    />
  </label>
</template>

<script setup>
/**
 * One keyword argument of an item's operation or cost func, as CUFLynx's dialog edits it: a checkbox for a boolean,
 * another item's name for an operation of no operands, else a number or text, shown at its default until set.
 */
import { computed } from 'vue'

const props = defineProps({
  // `{ name, default, type }`, type 'boolean', 'number', 'string', 'data_item', or 'any' for one the func doesn't name.
  field: { type: Object, required: true },
  // Its value in the item; undefined when unset.
  modelValue: { type: [String, Number, Boolean, Object, Array], default: undefined },
  // The names a 'data_item' argument may take.
  references: { type: Array, default: () => [] },
  // Says what it is, in its tooltip: 'operation kwarg' or 'cost_kwargs'.
  title: { type: String, default: 'operation kwarg' },
  readOnly: { type: Boolean, default: false },
})
// Emits the value to set, or undefined to unset it.
const emit = defineEmits(['update:modelValue'])

const shown = computed(() => (props.modelValue === undefined ? props.field.default : props.modelValue))
// The other items, and the name stored when it is none of them, so a dangling reference shows, and stays.
const referenceOptions = computed(() => (typeof props.modelValue === 'string' && props.modelValue && !props.references.includes(props.modelValue) ? [...props.references, props.modelValue] : props.references))

/**
 * Writes a value as a field shows it.
 *
 * @param {*} value
 * @param {string} [none] - For no value.
 * @returns {string}
 */
const formatValue = (value, none = 'None') => (value == null ? none : typeof value === 'object' ? JSON.stringify(value) : String(value))

/**
 * Reads a field's text as the argument's type and passes it on: none for no text, a number for a number, and for one
 * the func doesn't name, a number, a boolean or text.
 *
 * @param {string} text
 */
function change(text) {
  const trimmed = text.trim()
  if (!trimmed) return emit('update:modelValue', undefined)
  if (props.field.type === 'string') return emit('update:modelValue', text)
  const number = Number(trimmed)
  if (Number.isFinite(number)) return emit('update:modelValue', number)
  if (props.field.type === 'number') return
  emit('update:modelValue', /^true$/i.test(trimmed) ? true : /^false$/i.test(trimmed) ? false : text)
}
</script>

<style scoped>
.kwarg-bool {
  align-self: start;
}
</style>
