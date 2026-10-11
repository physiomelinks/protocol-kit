import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { checkOperationRange, findPredictionItemLimits, isRangeOperation, readOperation, validatePredictionItems } from '../../src/core/predictionValidation.js'

const RESOURCES = join(__dirname, '../resources')
const readFixture = (fileName) => JSON.parse(readFileSync(join(RESOURCES, fileName), 'utf8'))

describe('checkOperationRange', () => {
  it('takes fractions from 0 to 1, the start before the end', () => {
    expect(checkOperationRange({ start_frac: 0, end_frac: 0.2 })).toBeNull()
    // CA's defaults: the whole sub-experiment.
    expect(checkOperationRange({})).toBeNull()
    expect(checkOperationRange({ end_frac: 0.5 })).toBeNull()
    for (const kwargs of [{ start_frac: 0.5, end_frac: 0.5 }, { start_frac: -0.1 }, { end_frac: 1.5 }, { start_frac: '0' }]) {
      expect(checkOperationRange(kwargs)).toMatch(/^The range must run from a start_frac to a later end_frac, both from 0 to 1/)
    }
    expect(checkOperationRange({ start_frac: 0.8, end_frac: 0.2 })).toBe('The range must run from a start_frac to a later end_frac, both from 0 to 1; it is 0.8 to 0.2.')
  })

  it('needs a sample in the range, the end left out, as CA takes them', () => {
    // 1 s at 0.1 s apart is 11 samples: 0 to 0.1 takes the first, 0 to 0.05 none.
    expect(checkOperationRange({ start_frac: 0, end_frac: 0.1 }, { duration: 1, dt: 0.1 })).toBeNull()
    expect(checkOperationRange({ start_frac: 0, end_frac: 0.05 }, { duration: 1, dt: 0.1 })).toBe(
      'The range 0 to 0.05 of 1 s takes no samples: at 0.1 s apart it records 11, and the range takes those from int(start_frac * (n - 1)) up to, not including, int(end_frac * (n - 1)). Widen it.'
    )
    expect(checkOperationRange({ start_frac: 0.95, end_frac: 1 }, { duration: 1, dt: 0.1 })).toBeNull()
    expect(checkOperationRange({ start_frac: 0.95, end_frac: 0.99 }, { duration: 1, dt: 0.1 })).not.toBeNull()
    expect(checkOperationRange({ start_frac: 0, end_frac: 0.05 }, { duration: 1 })).toBeNull()
  })

  it('knows the operations in a range, and the spellings of none', () => {
    expect(['min_in_range', 'max', null].map(isRangeOperation)).toEqual([true, false, false])
    expect(['max', ' None', 'nan', '', null].map(readOperation)).toEqual(['max', null, null, null, null])
  })
})

describe('validatePredictionItems', () => {
  const document = {
    protocol_info: { pre_times: [0, 0], sim_times: [[1, 2], [3]], params_to_change: {} },
    data_items: [{ data_item_name: 'V_rest' }],
    prediction_items: [
      { data_item_name: 'peak', operands: ['m/v'], unit: 'mV', operation: 'max_in_range', operation_kwargs: { start_frac: 0, end_frac: 0.001 }, subexperiment_idx: 1 },
      { data_item_name: 'V_rest', operands: ['m/v'], unit: 'mV', experiment_idx: 3 },
      { data_item_name: 'late', operands: ['m/v'], unit: 'mV', operation: 'mean_in_range', operation_kwargs: { start_frac: 0.5 }, experiment_idx: 1 },
      { data_item_name: 'rel', operands: ['m/v'], unit: 'mV', operation: 'ratio', operation_kwargs: { of: 'V_rest' } },
    ],
  }

  it("goes on past CA's first error, so each item's are known", () => {
    const { errors, itemErrors, warnings } = validatePredictionItems(document, { dt: 0.01 })
    expect(itemErrors[0]).toEqual([expect.stringMatching(/^prediction_items\[0\] \('peak'\): The range 0 to 0.001 of 2 s takes no samples: at 0.01 s apart it records 201/)])
    expect(itemErrors[1]).toEqual(["prediction_items[1] ('V_rest'): experiment_idx 3 is not an experiment of protocol_info, which has 2."])
    expect(itemErrors[2]).toEqual([])
    expect(itemErrors[3]).toEqual([
      "prediction_items[3] ('rel'): operation_kwargs 'of' references data_item 'V_rest'. A prediction item's operation_kwargs may reference earlier prediction_items only.",
    ])
    expect(errors).toEqual([...itemErrors.flat(), expect.stringMatching(/^Duplicate 'data_item_name' in obs_data: 'V_rest' x2 \(in data_items, prediction_items\)/)])
    expect(warnings).toHaveLength(1)
  })

  it('checks only the fractions without a dt', () => {
    expect(validatePredictionItems(document).itemErrors[0]).toEqual([])
  })

  it('passes the prediction items CA #536 reads, and refuses a list of none', () => {
    expect(validatePredictionItems(readFixture('prediction_items_536_obs_data.json'), { dt: 0.01 }).errors).toEqual([])
    expect(validatePredictionItems({}).errors).toEqual([])
    expect(validatePredictionItems({ prediction_items: {} }).errors).toEqual(["prediction_items must be a list of dict entries, got <class 'dict'>"])
  })
})

describe('findPredictionItemLimits', () => {
  it('names the items that need circulatory_autogen #536', () => {
    expect(findPredictionItemLimits(readFixture('prediction_items_536_obs_data.json'))).toEqual([
      '5 prediction items use an operation or a sub-experiment (i_Na_holding, I_peak_e0, I_peak_e1, V_step_e1, I_late_e1), so it needs circulatory_autogen with #536; ' +
        'released libcuflynx 0.7.3 and current CUFLynx reject this file.',
    ])
    expect(findPredictionItemLimits({ prediction_items: [{ data_item_name: 'a', subexperiment_idx: 0 }] })[0]).toMatch(/^A prediction item uses an operation or a sub-experiment \(a\)/)
    expect(findPredictionItemLimits(readFixture('SN_simple_obs_data.json'))).toEqual([])
    expect(findPredictionItemLimits(null)).toEqual([])
  })
})
