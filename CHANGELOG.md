# Changelog

## 0.5.0 (unreleased)

Breaking: the editor edits an obs_data document as CUFLynx's "Edit obs_data" dialog does, one row per item, and the
Outputs and their feature plots form are gone.

- Prediction items are edited one at a time, as rows (`listPredictionItems`, `readPredictionItemRow`,
  `buildPredictionItem`, `createPredictionItem`, `addPredictionItem`, `updatePredictionItem`, `removePredictionItem`),
  replacing the Outputs (`listOutputs`, `addOutput`, `updateOutput`, `removeOutput`, `findOutputKey`,
  `OUTPUT_OPERATIONS`) and the names they made up. An item left unnamed is named after its variable, apart from every
  other item (`findFreeItemName`), as CA #536 requires names unique. A renamed item is renamed in the other prediction
  items' operation_kwargs, and prediction plots follow a group renamed in its last item. An item read and written back
  is the same, held-out data (`value`, `std`, `data_type`, `obs_dt`) and keys unknown included, legacy keys written as
  their replacements; held-out items are edited like the others, their data kept (`isValidationData` marks them). A
  document the Outputs of 0.2 to 0.4 wrote reads as one row per item and saves back unchanged.
- Data items' features, computed as CA #536's cost loop does (`computeDataItemFeatures`): each constant item with an
  operation over its sub-experiment (the first by default), the sub-experiments in order and each one's items in the
  order of data_items, so an operation_kwargs value may name an item computed before it, there or in an earlier
  sub-experiment. `sliceRangeBounds(count, kwargs)` gives the samples an `*_in_range` operation takes, for a host to
  draw a feature over them; `computeFeatures` and `computeDataItemFeatures` give each feature its `kwargs`, those naming
  an earlier feature as its value. Golden vectors from CA 7e9fdb55's own get_obs_output_dict and range funcs
  (`scripts/generate_operation_vectors.py`) check both.
- `first_peak_time` is computed (`applyOperation`, `computeFeatures`, `computeDataItemFeatures`): over the operands
  `[t, V]`, the time of V's first peak as scipy's `find_peaks` finds it, at least `spike_min_thresh` high when given,
  or the last time when there is none, as CA's own. An operation now reads as many operands as CA's func names, and
  its kwargs are checked against those it fills. Vectors from CA 7e9fdb55's func check it.
- The editor: `ObsDataEditor`, the top level, a section per key of the document as CUFLynx's dialog has them, headed by
  the raw key: `protocol_info`, `data_items`, `prediction_items` and `prediction_plots`. It holds the experiment shown,
  and the row selected, whose experiment it shows and whose sub-experiment it tints. A data-only document shows
  `protocol_info`, with "Add protocol_info", and its data items. `preset` chooses the host's app: `'cuflynx'` edits
  every column; `'phlynx'` shows the data items read-only, without weight, cost and differentiability.
  - `ProtocolInfoEditor` is the timeline `ProtocolEditor` was, without the outputs and data items, and takes
    `v-model:activeExp`, `highlightExp` and `highlightSubexp`. It no longer takes `dt`, `showDataItems`,
    `dataItemColumns`, `dataItemsReadOnly` or `dataItemVocabulary`, which `ObsDataEditor` takes.
  - `DataItemsSection`: CUFLynx's rows (`name | value | std | operation | exp | sub`), and under a chevron the
    operands, trace label, unit, weight, cost type and its kwargs, plot type, operation kwargs, source and comment.
    Rows CA refuses, and rows whose operation it can't differentiate, are tinted and say why; items a row can't hold
    are kept, and counted ("N non-editable item(s)… will be preserved unchanged"). Its presets
    (`DATA_ITEM_COLUMN_PRESETS`: `cuflynx`, `phlynx`, replacing `all` and `summary`) and `readOnly` say what it shows
    and edits; `isSummaryColumns` is gone (`isReadOnlyPreset`). `isRowDataItem` says which items it lists as rows, for
    a host to count them.
  - `PredictionItemsSection`: `variable | unit | trace label | exp | sub | operation`, the sub-experiment "(last)" or
    an index and the operation "(none)" or one of CA's; under a chevron the name, item label and operation kwargs
    (`start_frac` and `end_frac` for a range). Held-out items are marked `obs`. `predictionItemColumns.js` holds its
    columns and presets.
  - `PredictionPlotsSection`: `name | kind | y | x | series`, over the feature groups and the inputs in each
    sub-experiment, with `validatePredictionPlots`' errors under each row.
  - `ProtocolOutputsEditor`, `ProtocolFeaturePlotsEditor` and the form of `ProtocolDataItemsEditor` are removed.
- CA's messages say "prediction item" where they said "output".

## 0.4.0 (2026-10-10)

- Features, computed as circulatory_autogen #536 computes them (`computeFeatures`): each prediction item with an
  operation that gives one number, over its own sub-experiment's samples (the first included, as CA records them),
  in the order of prediction_items, an operation_kwargs value naming an earlier feature taking its value. `max`,
  `min`, `mean`, `max_minus_min` and their `*_in_range` forms are ported from CA's funcs (`applyOperation`): Python's
  slicing (a string fraction repeated n - 1 times and read as an integer, as Python multiplies one), numpy's NaNs and
  errors, and means summed in numpy's pairwise order (`sumPairwise`), so each value is CA's to the bit. Golden vectors
  from CA's own funcs and features_from_segments (`scripts/generate_operation_vectors.py`,
  `tests/resources/operation-vectors.json`) check it.
- Feature plots: an obs_data's top-level `prediction_plots`, as proposed to circulatory_autogen, each a group of
  features (`item_name_for_plotting`) across experiments against another group or an input's value in a
  sub-experiment, optionally a line per value of an input.
  `addPredictionPlot`, `updatePredictionPlot`, `removePredictionPlot`, `validatePredictionPlots` (the proposal's
  checks), `listFeatureGroups`, and `computePlotSeries`, which pairs computed features into each plot's points.
- Removing a sub-experiment keeps each plot reading its input in the same sub-experiment, or removes a plot that
  can't (`findPlotsLosingInput`), which `findObservationsAt` names. Renaming an output renames it in the plots.
- The editor: a Feature plots section below the outputs (`ProtocolFeaturePlotsEditor`), to add, edit and remove
  plots, with their checks inline.
- Data items, which both apps edit alike: `listDataItems`, `addDataItem`, `updateDataItem` and `removeDataItem` read
  each item as a form's row and write it back as CUFLynx's obs_data editor did (`readDataItem`, `buildDataItem`):
  value and std or a series, weight, obs_dt, operation and kwargs, cost type and kwargs, plot type, colour and labels,
  source and comment, keys unknown kept and legacy keys written as their replacements. A renamed item is renamed in
  other items' operation_kwargs; protocol_info is never changed.
- `readDataItemsAsCircAutogen` reads data items as circulatory_autogen #536's parser does, with its messages, and
  `validateDataItems` checks each for an editor: kwargs against CA's funcs, references to items computed before it,
  experiments in the protocol, names unique across data and prediction items. `DATA_ITEM_VOCABULARY` holds CA's data
  types, plot types, default cost, operations and cost funcs; `readObsDataOptions` reads CUFLynx's, a kwarg it calls
  a string for its None default typed as CA's own are (a number, or an item's name). Golden vectors
  from CA 96ec5c63 (`scripts/generate_data_item_vectors.py`, `tests/resources/data-item-vectors.json`) check them.
- The editor: a Data items section below the feature plots (`ProtocolDataItemsEditor`), with the columns the host
  chooses (`dataItemColumns`): `'all'` edits every field, as CUFLynx does; `'summary'` lists each item's name,
  variable, experiment and sub-experiment read-only, as PhLynx does, and shows nothing when there are none.
  `showDataItems` hides it, `dataItemsReadOnly` and `dataItemVocabulary` pass on. While one item is edited the others
  can't be, and an edit keeps what it leaves alone: a series' gaps and nesting, a constant's list, a missing unit
  (which it asks for, as CA refuses an item without one). An error the item had stays allowed when it is renamed.

## 0.3.0 (2026-10-09)

- The editor tucks away the parameters a protocol sets to their value in the model, as a plain number, in every
  experiment and sub-experiment (`findParametersAtModelValues`, from the host's `getValue`, else `variables`). A line
  below the others counts them and shows or hides them; the document keeps them. One whose model value is unknown, one
  added or edited while the editor is open, and one an error or warning names stay shown.
- `readPredictionItem` checks a prediction item's held-out `std` as circulatory_autogen #536's head (7e9fdb55) does
  (`_held_out_std`): finite and above 0, one number for a constant, one or one per point for a series, which it
  expands. The prediction vectors now come from that commit, which PhLynx's exported scripts install.
- Outputs are grouped as CA names them for plotting (`nameItemForPlotting`): `item_name_for_plotting`, else
  `trace_name_for_plotting`, else the first operand, else `data_item_name`, legacy keys migrated. Before, an item
  without `item_name_for_plotting` was an output of its own.
- `listOutputs` marks an output with two items in one experiment (`hasRepeatedExperiment`); `updateOutput` leaves it
  as it is, as writing one item per experiment dropped the rest, and the editor won't edit it.
- The editor: clicking the Variable caption no longer clears the variable; an error all of an output's items have
  shows once; parameters are always offered, for their mean; a range field that reads as no number is refused.
  `NumberInput` emits `invalid`. The Sub-experiment field shows "The last of each experiment" when chosen, not blank,
  and a new output's form shows no problem until it has a variable or a name.

## 0.2.0 (2026-10-09)

- Outputs: `prediction_items` as a run's outputs, each a variable's trace or a feature of it (`max`, `min`, `mean`,
  `max_minus_min`, and their `*_in_range` forms over `start_frac` to `end_frac`), in the experiments and
  sub-experiment chosen. `addOutput`, `updateOutput` and `removeOutput` write one item per experiment, sharing
  `item_name_for_plotting`; `listOutputs` groups them back. Items with measured data (`value`, `std`, `data_type`,
  `obs_dt`) are validation data, listed but never changed; nothing here writes those keys.
- `readPredictionItemsAsCircAutogen`: prediction items read as circulatory_autogen #536 reads them, with its messages
  (closed keys, required keys and types, experiment and sub-experiment in range, data shapes, `operation_kwargs`
  without an operation, names unique across data and prediction items, references in `operation_kwargs`). Golden
  vectors from #536's own parser (`scripts/generate_prediction_vectors.py`, `tests/resources/prediction-vectors.json`)
  check it.
- `validatePredictionItems` checks each item on its own for the editor, and that each `*_in_range` window takes a
  sample at the run's `dt` (CA leaves its end out). `findPredictionItemLimits` warns that items with an operation or a
  sub-experiment need circulatory_autogen #536: released libcuflynx 0.7.3 and current CUFLynx reject them.
- The editor: an Outputs section (`ProtocolOutputsEditor`) below the protocol, to add, edit and remove outputs, with
  the host's variables (parameters only for a mean). `ProtocolEditor` takes `dt`.
- Publishing builds and tests the package first, and authenticates with an npm token. 0.1.1, which set this up, was
  never published.

## 0.1.0 (2026-10-09)

- The protocol core, extracted from PhLynx (`src/services/protocol/`): reading and writing obs_data, validation as
  circulatory_autogen does it, shape expansion, editing and preview.
- `resolveExperimentColour` moves here from PhLynx's chart series, and takes the palette to fall back on.
- Removing a sub-experiment renumbers prediction items that name one (`subexperiment_idx`), as it did data items, and
  removes those in it. `findObservationsAt` lists them too.
- `validateProtocolInfo` no longer warns that PhLynx ignores `offline_pre_time`: what a host ignores is its own
  warning (the editor's `warn`).
- The protocol editor, extracted from PhLynx (`ProtocolEditor`, `ProtocolCellEditor`, `InlineNumber`, `NumberInput`),
  independent of its host: it takes the model's variables as a plain list (`variables`), and optionally `getValue`,
  `confirm`, `palette` and `warn`. `VariablePicker` and `searchVariables` replace PhLynx's variable index for it.
