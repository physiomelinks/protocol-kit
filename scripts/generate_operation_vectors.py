"""
Writes tests/resources/operation-vectors.json: what circulatory_autogen's own operation funcs (#536 and later) give
for the operations a feature can take, on series of many lengths and values, with and without operation_kwargs, the
samples each window takes, and the features a run gives prediction items and data items, for protocol-kit's port
(src/core/operations.js, src/core/features.js) to be checked against, to the last bit. Run by hand, not in CI, with a
Python that has that circulatory_autogen's libcuflynx installed:

    python scripts/generate_operation_vectors.py [path/to/circulatory_autogen]

The path is only read for the commit it records. A series is written as its float64 bytes (little-endian, base64), and
a value as Python's repr reads back exactly, or "nan", "inf" or "-inf".
"""
import base64
import json
import math
import os
import subprocess
import sys
import warnings

import tempfile

import numpy as np

from libcuflynx.param_id import prediction_features as pf
from libcuflynx.param_id.paramID import ParamID
from libcuflynx.param_id.operation_funcs import get_operation_funcs_dict_for_mode, resolve_operation_kwargs
from libcuflynx.param_id.prediction_features import as_scalar
from libcuflynx.parsers.PrimitiveParsers import ObsAndParamDataParser

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
RESOURCES = os.path.join(ROOT, "tests", "resources")
CA = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "..", "circulatory_autogen"))

OPERATIONS = ["max", "min", "mean", "max_minus_min", "max_in_range", "min_in_range", "mean_in_range", "max_minus_min_in_range"]
# Lengths around numpy's pairwise summation: fewer than 8, its unrolling by 8, its blocks of 128, and longer.
LENGTHS = [1, 2, 3, 7, 8, 9, 15, 16, 17, 63, 100, 127, 128, 129, 130, 136, 255, 256, 257, 1000, 1001, 4097]
# Windows: CA's defaults, a few fractions, one that takes no sample, and ones outside 0 to 1, which Python slices.
WINDOWS = [None, {"start_frac": 0, "end_frac": 0.2}, {"start_frac": 0.5, "end_frac": 1}, {"start_frac": 0.1, "end_frac": 0.9},
           {"start_frac": 0.333, "end_frac": 0.667}, {"start_frac": 0, "end_frac": 0.001}, {"start_frac": 0.8, "end_frac": 0.2},
           {"start_frac": -0.5, "end_frac": 1}, {"start_frac": 0, "end_frac": 1.5}, {"start_frac": 1, "end_frac": 0}, {"start_frac": True, "end_frac": 1}]
# operation_kwargs CA refuses, or can't use, and strings, which Python repeats n - 1 times and then reads as an integer.
BAD_KWARGS = [{"start": 0.1}, {"series_output": True}, {"x": 1}, {"start_frac": "a"}, {"start_frac": None}, {"start_frac": [0]},
              {"start_frac": "0"}, {"start_frac": "00", "end_frac": "1"}, {"start_frac": "0", "end_frac": "2_0"}, {"start_frac": "-1"},
              {"start_frac": " 0 "}, {"start_frac": "0.5"}, {"start_frac": ""}]
# first_peak_time's (t, V): scipy's find_peaks over V, plateaus, peaks at either end (which aren't), and no peak at all.
PEAK_SERIES = [
    ("one peak", [0.0, 1.0, 0.0]),
    ("two peaks", [0.0, 1.0, 0.0, 2.0, 0.0]),
    ("a plateau of two", [0.0, 1.0, 1.0, 0.0, 0.5, 0.0]),
    ("a plateau of three", [0.0, 2.0, 2.0, 2.0, 0.0, 3.0, 0.0]),
    ("a plateau at the end", [0.0, 1.0, 1.0, 1.0]),
    ("a rise", [0.0, 1.0, 2.0, 3.0]),
    ("a fall", [3.0, 2.0, 1.0, 0.0]),
    ("a flat line", [1.0] * 6),
    ("two samples", [0.0, 1.0]),
    ("one sample", [-80.0]),
    ("a NaN beside a peak", [0.0, 1.0, np.nan, 2.0, 0.0, 0.5, 0.0]),
    ("a NaN peak", [0.0, np.nan, 0.0, 1.0, 0.0]),
    ("an infinite peak", [0.0, np.inf, 0.0, 1.0, 0.0]),
    ("signed zeros", [-1.0, 0.0, -0.0, -1.0]),
]
PEAK_KWARGS = [None, {"spike_min_thresh": None}, {"spike_min_thresh": 1.5}, {"spike_min_thresh": 0.5}, {"spike_min_thresh": 10},
               {"spike_min_thresh": True}, {"spike_min_thresh": -1}, {"spike_min_thresh": "a"}, {"start_frac": 0}, {"t": 0}]


def encode_series(values):
    return base64.b64encode(np.asarray(values, dtype="<f8").tobytes()).decode("ascii")


def encode_value(value):
    if math.isnan(value):
        return "nan"
    if math.isinf(value):
        return "inf" if value > 0 else "-inf"
    return value


def series():
    """Named series: random ones of many lengths and magnitudes, and a few with NaN, infinities and signed zeros."""
    rng = np.random.default_rng(536)
    named = []
    for length in LENGTHS:
        named.append((f"normal x{length}", rng.standard_normal(length)))
        named.append((f"magnitudes x{length}", rng.standard_normal(length) * 10.0 ** rng.integers(-6, 9, length)))
        named.append((f"offset x{length}", -80 + 1e-3 * rng.standard_normal(length)))
    named += [
        ("a NaN", np.array([1.0, np.nan, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0])),
        ("an infinity", np.array([1.0, np.inf, 3.0, -2.0, 0.5])),
        ("both infinities", np.array([np.inf, 1.0, -np.inf, 2.0])),
        ("signed zeros", np.array([0.0, -0.0, 0.0, -0.0])),
        ("negative zeros", np.array([-0.0] * 12)),
        ("negative zero first", np.array([-0.0, 0.0])),
        ("a constant of one sample", np.array([-80.0])),
        ("a constant over time", np.full(1001, 0.1)),
        ("integers", np.arange(-50, 51, dtype=float)),
    ]
    return named


# A run's features, as features_from_segments computes them: two experiments of two sub-experiments, features over
# either, a constant recorded as one sample, and a range that starts where an earlier feature says.
FEATURE_DOCUMENT = {
    "protocol_info": {"pre_times": [0, 0], "sim_times": [[1, 2], [1, 2]], "params_to_change": {"clamp/V_cmd": [[-80, -40], [-80, 0]]}},
    "data_items": [],
    "prediction_items": [
        {"data_item_name": "V_trace", "operands": ["membrane/V"], "unit": "mV"},
        {"data_item_name": "I_peak_e0", "operands": ["i_Na/i_Na"], "unit": "uA_per_cm2", "operation": "min_in_range",
         "operation_kwargs": {"start_frac": 0, "end_frac": 0.2}, "experiment_idx": 0, "subexperiment_idx": 1, "item_name_for_plotting": "I_peak"},
        {"data_item_name": "I_peak_e1", "operands": ["i_Na/i_Na"], "unit": "uA_per_cm2", "operation": "min_in_range",
         "operation_kwargs": {"start_frac": 0, "end_frac": 0.2}, "experiment_idx": 1, "subexperiment_idx": 1, "item_name_for_plotting": "I_peak"},
        {"data_item_name": "V_step_e0", "operands": ["clamp/V_cmd"], "unit": "mV", "operation": "mean", "experiment_idx": 0, "item_name_for_plotting": "V_step"},
        {"data_item_name": "V_step_e1", "operands": ["clamp/V_cmd"], "unit": "mV", "operation": "mean", "experiment_idx": 1, "item_name_for_plotting": "V_step"},
        {"data_item_name": "V_hold_mean", "operands": ["membrane/V"], "unit": "mV", "operation": "mean_in_range", "experiment_idx": 1, "subexperiment_idx": 0,
         "operation_kwargs": {"start_frac": 0.25, "end_frac": 0.75}},
        {"data_item_name": "late_frac", "operands": ["fraction/f"], "unit": "dimensionless", "operation": "mean", "experiment_idx": 0, "subexperiment_idx": 0},
        {"data_item_name": "V_late_max", "operands": ["membrane/V"], "unit": "mV", "operation": "max_in_range", "experiment_idx": 0,
         "operation_kwargs": {"start_frac": "late_frac", "end_frac": 1}},
        {"data_item_name": "I_range", "operands": ["i_Na/i_Na"], "unit": "uA_per_cm2", "operation": "max_minus_min", "experiment_idx": 1, "data_type": "constant",
         "value": 2.5, "std": 0.1},
    ],
}
# Samples per sub-experiment: dt 0.01 over 1 and 2 s.
SAMPLES = [101, 201]


def feature_segments(rng):
    """Each sub-experiment's own samples of each operand: a constant as one sample, as Myokit's helper gives it."""
    segments = []
    for experiment, steps in enumerate([[-80, -40], [-80, 0]]):
        segments.append([])
        for sub, count in enumerate(SAMPLES):
            t = np.linspace(0, 1, count)
            segments[-1].append({
                "time": sub + t,
                "membrane/V": steps[sub] + rng.standard_normal(count),
                "i_Na/i_Na": -(experiment + 1) * np.exp(-((t - 0.1) / 0.03) ** 2) + 1e-3 * rng.standard_normal(count),
                "clamp/V_cmd": np.array([float(steps[sub])]),
                "fraction/f": np.array([0.4]),
            })
    return segments


def compute_features(funcs):
    """CA's features of FEATURE_DOCUMENT over random segments, with the segments."""
    segments = feature_segments(np.random.default_rng(7))
    info = ObsAndParamDataParser().parse_obs_data_json(obs_data_dict=FEATURE_DOCUMENT)
    prediction_info, protocol_info = info["prediction_info"], FEATURE_DOCUMENT["protocol_info"]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        indices = pf.prediction_feature_indices(prediction_info, funcs)
    operands = pf.result_variables(prediction_info, indices)
    by_segment = {(e, s): [[segment[name] for name in names] for names in operands] for e, subs in enumerate(segments) for s, segment in enumerate(subs)}
    values = pf.features_from_segments(prediction_info, indices, funcs, protocol_info, by_segment)
    return {
        "document": FEATURE_DOCUMENT,
        "segments": [[{name: encode_series(samples) for name, samples in segment.items()} for segment in subs] for subs in segments],
        "features": [{"name": name, "segment": list(segment), "value": encode_value(value)}
                     for name, segment, value in zip(pf.prediction_feature_names(prediction_info, indices),
                                                     pf.feature_segments(prediction_info, indices, protocol_info), values)],
    }


# Data items over the same run: features over either sub-experiment (CA refuses an index some items lack), and ranges
# that start where an item computed before says, in its own sub-experiment or an earlier one.
DATA_ITEM_DOCUMENT = {
    "protocol_info": FEATURE_DOCUMENT["protocol_info"],
    "prediction_items": [],
    "data_items": [
        {"data_item_name": "I_peak_e1", "data_type": "constant", "unit": "uA_per_cm2", "operands": ["i_Na/i_Na"], "operation": "min_in_range",
         "operation_kwargs": {"start_frac": 0, "end_frac": 0.2}, "value": -2, "std": 0.1, "experiment_idx": 1, "subexperiment_idx": 1},
        {"data_item_name": "V_rest", "data_type": "constant", "unit": "mV", "operands": ["membrane/V"], "operation": "mean", "value": -80, "std": 1,
         "experiment_idx": 0, "subexperiment_idx": 0},
        {"data_item_name": "f_late", "data_type": "constant", "unit": "dimensionless", "operands": ["fraction/f"], "operation": "mean", "value": 0.4,
         "std": 0.1, "experiment_idx": 0, "subexperiment_idx": 0},
        {"data_item_name": "V_late_max", "data_type": "constant", "unit": "mV", "operands": ["membrane/V"], "operation": "max_in_range",
         "operation_kwargs": {"start_frac": "f_late", "end_frac": 1}, "value": -38, "std": 1, "experiment_idx": 0, "subexperiment_idx": 1},
        {"data_item_name": "I_range", "data_type": "constant", "unit": "uA_per_cm2", "operands": ["i_Na/i_Na"], "operation": "max_minus_min",
         "value": 2, "std": 0.1, "experiment_idx": 1, "subexperiment_idx": 1},
        {"data_item_name": "V_step_min", "data_type": "constant", "unit": "mV", "operands": ["clamp/V_cmd"], "operation": "min", "value": -40,
         "std": 1, "experiment_idx": 0, "subexperiment_idx": 1},
        {"data_item_name": "V_peak_e1", "data_type": "constant", "unit": "mV", "operands": ["membrane/V"], "operation": "max_minus_min_in_range",
         "operation_kwargs": {"start_frac": "f_late", "end_frac": 0.9}, "value": 3, "std": 1, "experiment_idx": 1, "subexperiment_idx": 0},
        {"data_item_name": "V_first_peak", "data_type": "constant", "unit": "s", "operands": ["time", "membrane/V"], "operation": "first_peak_time",
         "value": 1.05, "std": 0.01, "experiment_idx": 0, "subexperiment_idx": 1, "plot_type": "vertical"},
        {"data_item_name": "V_first_spike", "data_type": "constant", "unit": "s", "operands": ["time", "membrane/V"], "operation": "first_peak_time",
         "operation_kwargs": {"spike_min_thresh": 1.5}, "value": 0.5, "std": 0.01, "experiment_idx": 1, "subexperiment_idx": 1, "plot_type": "vertical"},
    ],
}


def compute_data_item_features(funcs):
    """CA's features of DATA_ITEM_DOCUMENT's data items over random segments, as its cost loop computes them: each
    sub-experiment in order, every item evaluated by get_obs_output_dict, its own kept."""
    segments = feature_segments(np.random.default_rng(11))
    parser = ObsAndParamDataParser()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        parsed = parser.parse_obs_data_json(obs_data_dict=DATA_ITEM_DOCUMENT)
        obs_info = parser.process_obs_info(parsed["gt_df"], tempfile.mkdtemp(), 0.01)
    # Only what get_obs_output_dict reads of a ParamID: no model is built or run.
    param_id = object.__new__(ParamID)
    param_id.obs_info, param_id.operation_funcs_dict, param_id.emulates_features = obs_info, funcs, False
    names, values = obs_info["data_item_names"], {}
    with param_id.accumulating_temp_results():
        for experiment, subs in enumerate(segments):
            for sub, segment in enumerate(subs):
                operands = [[segment[name] for name in item_operands] for item_operands in obs_info["operands"]]
                with param_id.evaluating_segment(experiment, sub):
                    const = param_id.get_obs_output_dict(operands)["const"]
                for index, name in enumerate(names):
                    if (int(obs_info["experiment_idxs"][index]), int(obs_info["subexperiment_idxs"][index])) == (experiment, sub):
                        values[name] = float(const[index])
    return {
        "document": DATA_ITEM_DOCUMENT,
        "segments": [[{name: encode_series(samples) for name, samples in segment.items()} for segment in subs] for subs in segments],
        "features": [{"name": name, "value": encode_value(values[name])} for name in names],
    }


def find_bounds(funcs, count, kwargs):
    """The samples CA's own *_in_range funcs take of count: over the indices, the least is the first and the greatest
    the last; none when they raise for an empty range, and the error a fraction it can't read raises."""
    indices = np.arange(count, dtype=float)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            first = funcs["min_in_range"](indices, **(kwargs or {}))
            last = funcs["max_in_range"](indices, **(kwargs or {}))
        return {"start": int(first), "end": int(last) + 1}
    except ValueError as error:
        return {"empty": True} if "zero-size array" in str(error) else {"error": type(error).__name__}


def run(funcs, operation, values, kwargs):
    """CA's value, as evaluate_feature gives it, or its error."""
    func = funcs[operation]
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            resolved = resolve_operation_kwargs(kwargs or {}, func, operation_name=operation, data_item_name="item", temp_results={}, num_operands=1)
            return {"value": encode_value(as_scalar(func(np.asarray(values, dtype=float), **resolved), "item", operation))}
    except Exception as error:  # noqa: BLE001 -- the vectors record what CA raises
        return {"error": type(error).__name__}


def peak_times(values):
    """The time a first_peak_time case's values are sampled at."""
    return np.linspace(0, 1, len(values))


def run_peak(funcs, values, kwargs):
    """CA's first_peak_time of values over peak_times, or its error, TypeError for numpy's subclasses of it."""
    func = funcs["first_peak_time"]
    times = peak_times(values)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            resolved = resolve_operation_kwargs(kwargs or {}, func, operation_name="first_peak_time", data_item_name="item", temp_results={}, num_operands=2)
            return {"value": encode_value(as_scalar(func(times, np.asarray(values, dtype=float), **resolved), "item", "first_peak_time"))}
    except Exception as error:  # noqa: BLE001 -- the vectors record what CA raises
        return {"error": "TypeError" if isinstance(error, TypeError) else type(error).__name__}


def main():
    commit = subprocess.run(["git", "-C", CA, "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    funcs = get_operation_funcs_dict_for_mode("numpy")
    cases = []
    named = series()
    for name, values in named:
        for operation in OPERATIONS:
            windows = WINDOWS if operation.endswith("_in_range") else [None]
            for kwargs in windows:
                cases.append({"series": name, "operation": operation, "operation_kwargs": kwargs, **run(funcs, operation, values, kwargs)})
    for operation in ["max", "mean_in_range"]:
        for kwargs in BAD_KWARGS:
            cases.append({"series": "normal x100", "operation": operation, "operation_kwargs": kwargs, **run(funcs, operation, dict(named)["normal x100"], kwargs)})
    peaks = [{"series": name, "times": encode_series(peak_times(values)), "values": encode_series(values), "operation_kwargs": kwargs, **run_peak(funcs, values, kwargs)}
             for name, values in PEAK_SERIES for kwargs in PEAK_KWARGS]
    windows = [window for window in WINDOWS if window] + [{"start_frac": "0", "end_frac": 1}, {"start_frac": 0}, {"end_frac": 0.5}]
    bounds = [{"count": count, "operation_kwargs": kwargs, **find_bounds(funcs, count, kwargs)} for count in [1, 2, 3, 10, 11, 100, 101, 201] for kwargs in windows]
    vectors = {
        "source": {"repository": "circulatory_autogen", "commit": commit, "numpy": np.__version__},
        "series": {name: encode_series(values) for name, values in named},
        "cases": cases,
        "peaks": peaks,
        "features": compute_features(funcs),
        "data_item_features": compute_data_item_features(funcs),
        "bounds": bounds,
    }
    # A line per case and per series, as there are thousands.
    text = json.dumps({**vectors, "series": None, "cases": None}, indent=1)
    lines = lambda entries: ",\n".join(f"  {entry}" for entry in entries)
    text = text.replace('"series": null', '"series": {\n' + lines(f"{json.dumps(name)}: {json.dumps(value)}" for name, value in vectors["series"].items()) + "\n }")
    text = text.replace('"cases": null', '"cases": [\n' + lines(json.dumps(case) for case in cases) + "\n ]")
    with open(os.path.join(RESOURCES, "operation-vectors.json"), "w") as f:
        f.write(text + "\n")
    print(f"Wrote {len(cases)} operation vectors on {len(named)} series, {len(peaks)} first peaks, and {len(bounds)} windows, from CA {commit} (numpy {np.__version__}).")


if __name__ == "__main__":
    main()
