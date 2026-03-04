#!/usr/bin/env python3
"""Generate pipeline design and implementation score CSVs from results files."""

from __future__ import annotations

import argparse
import importlib.util
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence, Tuple

import pandas as pd


@dataclass(frozen=True)
class SystemSpec:
    """Metadata for one leaderboard row and candidate result directories."""

    row_key: str
    variant_label: str
    model_label: str
    candidates: Sequence[str]


def _build_system_specs() -> List[SystemSpec]:
    """Build the system list used by the website leaderboard."""
    specs: List[SystemSpec] = []

    baseline_models = [
        ("GPTo3", "GPT-o3"),
        ("GPT4o", "GPT-4o"),
        ("Llama3_3Instruct", "Llama3-3Instruct"),
        ("DeepseekR1", "DeepSeek-R1"),
        ("Qwen25", "Qwen2-5Coder"),
        ("Claude35", "Claude-3.5"),
        ("Claude37", "Claude-3-7"),
    ]
    baseline_variants = [
        ("Naive", "DS-Guru no-context"),
        ("OneShot", "DS-Guru one-shot"),
        ("FewShot", "DS-Guru few-shot"),
    ]

    for variant_key, variant_label in baseline_variants:
        for model_key, model_label in baseline_models:
            system_key = f"BaselineLLMSystem{model_key}{variant_key}"
            row_key = f"{variant_label}|{model_label}"
            specs.append(
                SystemSpec(
                    row_key=row_key,
                    variant_label=variant_label,
                    model_label=model_label,
                    candidates=[system_key],
                )
            )

    smol_models = [
        ("GPTo3", "GPT-o3"),
        ("Claude37Sonnet", "Claude-3-7"),
        ("Claude37", "Claude-3-7"),
        ("GPT4o", "GPT-4o"),
        ("Claude35", "Claude-3.5"),
    ]
    smol_variants = [
        ("DeepResearch", "smolagents DR"),
        ("Reflexion", "smolagents Reflexion"),
        ("PDT", "smolagents PDT"),
    ]

    seen_smol_rows = set()
    for variant_key, variant_label in smol_variants:
        for model_key, model_label in smol_models:
            row_key = f"{variant_label}|{model_label}"
            if row_key in seen_smol_rows:
                continue
            seen_smol_rows.add(row_key)

            preferred = f"Smolagents{variant_key}{model_key}"
            alternate = f"Smolagents{model_key}{variant_key}"
            candidates = [preferred]
            if alternate != preferred:
                candidates.append(alternate)

            specs.append(
                SystemSpec(
                    row_key=row_key,
                    variant_label=variant_label,
                    model_label=model_label,
                    candidates=candidates,
                )
            )

    return specs


def _run_paths_by_iteration(results_root: Path, experiment: str) -> Dict[int, Path]:
    """Map run iteration ids to result directories for one experiment."""
    mapping: Dict[int, Path] = {}
    prefix = f"results_{experiment}_"
    for path in sorted(results_root.glob(f"{prefix}*")):
        if not path.is_dir():
            continue
        suffix = path.name[len(prefix):]
        if suffix.isdigit():
            mapping[int(suffix)] = path
    return mapping


def _resolve_candidates(
    specs: Sequence[SystemSpec], run_path: Path
) -> Dict[str, Optional[str]]:
    """Resolve the best available system directory name per row."""
    available = {
        child.name
        for child in run_path.iterdir()
        if child.is_dir() and not child.name.startswith(".")
    }
    resolved: Dict[str, Optional[str]] = {}
    for spec in specs:
        selected: Optional[str] = None
        for candidate in spec.candidates:
            if candidate in available:
                selected = candidate
                break
        resolved[spec.row_key] = selected
    return resolved


def _format_mean_std_percent(mean_value: float, std_value: float) -> str:
    """Format a percentage string with optional standard deviation."""
    if pd.isna(mean_value):
        return ""
    if pd.isna(std_value):
        return f"{mean_value:.2f}%"
    return f"{mean_value:.2f}% ± {std_value:.2f}%"


def _pipeline_design_for_system(
    system_path: str,
    domains: Sequence[str],
    latest_measures_file: Callable[..., Optional[str]],
    pipeline_code_eval_counts_from_measures: Callable[..., Tuple[int, int]],
) -> Optional[float]:
    """Compute Table-8 style pipeline design score for one system/run."""
    total_true = 0
    total_count = 0

    for domain in domains:
        measures_path = latest_measures_file(system_path, domain)
        if measures_path is None:
            continue
        true_count, count = pipeline_code_eval_counts_from_measures(measures_path)
        total_true += true_count
        total_count += count

    if total_count == 0:
        return None
    return 100.0 * (total_true / total_count)


def _compute_pipeline_design_scores(
    specs: Sequence[SystemSpec],
    iteration_ids: Sequence[int],
    paths_by_experiment: Dict[str, Dict[int, Path]],
    per_system_experiment: Dict[str, str],
    domains: Sequence[str],
    latest_measures_file: Callable[..., Optional[str]],
    pipeline_code_eval_counts_from_measures: Callable[..., Tuple[int, int]],
) -> pd.DataFrame:
    """Compute mean/std pipeline design scores across runs."""
    run_values: Dict[str, List[float]] = {spec.row_key: [] for spec in specs}

    specs_by_experiment: Dict[str, List[SystemSpec]] = {}
    for spec in specs:
        selected_experiment = per_system_experiment.get(spec.row_key, "subtasks")
        specs_by_experiment.setdefault(selected_experiment, []).append(spec)

    for iteration in iteration_ids:
        for selected_experiment, experiment_specs in specs_by_experiment.items():
            run_path = paths_by_experiment.get(selected_experiment, {}).get(iteration)
            if run_path is None:
                continue
            resolved = _resolve_candidates(experiment_specs, run_path)

            for spec in experiment_specs:
                resolved_key = resolved.get(spec.row_key)
                if resolved_key is None:
                    continue
                system_path = str(run_path / resolved_key)
                score_value = _pipeline_design_for_system(
                    system_path,
                    domains,
                    latest_measures_file,
                    pipeline_code_eval_counts_from_measures,
                )
                if score_value is not None:
                    run_values[spec.row_key].append(score_value)

    rows = []
    for spec in specs:
        series = pd.Series(run_values[spec.row_key], dtype=float)
        mean_value = float(series.mean()) if not series.empty else float("nan")
        std_value = float(series.std(ddof=0)) if not series.empty else float("nan")
        rows.append(
            {
                "System": spec.variant_label,
                "Models": spec.model_label,
                "Overall": _format_mean_std_percent(mean_value, std_value),
            }
        )

    dataframe = pd.DataFrame(rows)
    dataframe = dataframe[dataframe["Overall"].astype(str).str.strip() != ""].copy()
    dataframe["__sort"] = dataframe["Overall"].str.extract(r"(-?\d+(?:\.\d+)?)").astype(float)
    dataframe = dataframe.sort_values(by="__sort", ascending=False)
    dataframe = dataframe.drop(columns=["__sort"])
    return dataframe.reset_index(drop=True)


def _compute_pipeline_implementation_scores(
    specs: Sequence[SystemSpec],
    iteration_ids: Sequence[int],
    paths_by_experiment: Dict[str, Dict[int, Path]],
    per_system_experiment: Dict[str, str],
    domains: Sequence[str],
    run_scores_for_systems: Callable[..., Dict[str, Dict[str, Optional[float]]]],
    is_subtask: Callable[[str], bool],
    metrics: Sequence[str],
) -> pd.DataFrame:
    """Compute mean/std implementation scores from sub-task filtered metrics."""
    run_values: Dict[str, List[float]] = {spec.row_key: [] for spec in specs}

    specs_by_experiment: Dict[str, List[SystemSpec]] = {}
    for spec in specs:
        selected_experiment = per_system_experiment.get(spec.row_key, "subtasks")
        specs_by_experiment.setdefault(selected_experiment, []).append(spec)

    for iteration in iteration_ids:
        for selected_experiment, experiment_specs in specs_by_experiment.items():
            run_path = paths_by_experiment.get(selected_experiment, {}).get(iteration)
            if run_path is None:
                continue

            resolved = _resolve_candidates(experiment_specs, run_path)
            resolved_keys = sorted(
                {value for value in resolved.values() if value is not None}
            )
            if not resolved_keys:
                continue

            raw_scores = run_scores_for_systems(
                str(run_path),
                resolved_keys,
                domains=domains,
                metrics=metrics,
                task_filter=is_subtask,
            )

            for spec in experiment_specs:
                resolved_key = resolved.get(spec.row_key)
                if resolved_key is None:
                    continue
                overall = raw_scores.get(resolved_key, {}).get("overall")
                if overall is not None and not pd.isna(overall):
                    run_values[spec.row_key].append(float(overall) * 100.0)

    rows = []
    for spec in specs:
        series = pd.Series(run_values[spec.row_key], dtype=float)
        mean_value = float(series.mean()) if not series.empty else float("nan")
        std_value = float(series.std(ddof=0)) if not series.empty else float("nan")
        rows.append(
            {
                "System": spec.variant_label,
                "Models": spec.model_label,
                "Overall": _format_mean_std_percent(mean_value, std_value),
            }
        )

    dataframe = pd.DataFrame(rows)
    dataframe = dataframe[dataframe["Overall"].astype(str).str.strip() != ""].copy()
    dataframe["__sort"] = dataframe["Overall"].str.extract(r"(-?\d+(?:\.\d+)?)").astype(float)
    dataframe = dataframe.sort_values(by="__sort", ascending=False)
    dataframe = dataframe.drop(columns=["__sort"])
    return dataframe.reset_index(drop=True)


def _load_results_helpers(results_root: Path):
    """Load helper functions from the krama-results scripts module."""
    helpers_path = results_root.parent / "scripts" / "results_helpers.py"
    if not helpers_path.is_file():
        raise FileNotFoundError(f"Missing helper module: {helpers_path}")

    module_spec = importlib.util.spec_from_file_location("results_helpers", helpers_path)
    if module_spec is None or module_spec.loader is None:
        raise ImportError(f"Unable to load module spec from {helpers_path}")

    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    return module


def main() -> int:
    """Parse CLI arguments and generate design/implementation CSV files."""
    repo_root = Path(__file__).resolve().parents[1]
    default_results_root = (repo_root / ".." / "krama-results" / "results").resolve()

    parser = argparse.ArgumentParser(
        description=(
            "Generate pipeline design and implementation leaderboard CSV files "
            "using the Table-8 scoring blueprint."
        )
    )
    parser.add_argument(
        "--results-root",
        type=Path,
        default=default_results_root,
        help="Path to krama-results/results directory.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=repo_root / "data",
        help="Directory where output CSV files are written.",
    )
    parser.add_argument(
        "--iterations",
        type=int,
        nargs="*",
        default=None,
        help="Optional run indices to include (e.g. --iterations 0 1 2).",
    )
    args = parser.parse_args()

    results_root = args.results_root.resolve()
    output_dir = args.output_dir.resolve()
    if not results_root.is_dir():
        raise FileNotFoundError(f"Results directory does not exist: {results_root}")

    helpers = _load_results_helpers(results_root)
    run_scores_for_systems = helpers.run_scores_for_systems
    is_subtask = helpers.is_subtask
    latest_measures_file = helpers.latest_measures_file
    pipeline_code_eval_counts_from_measures = helpers.pipeline_code_eval_counts_from_measures

    domains = ["archeology", "astronomy", "biomedical", "environment", "legal", "wildfire"]
    metrics = ["success", "f1", "llm_paraphrase", "rae_score"]
    specs = _build_system_specs()

    per_system_experiment = {
        spec.row_key: (
            "full"
            if "Claude" in spec.model_label
            or any("Claude" in candidate for candidate in spec.candidates)
            else "subtasks"
        )
        for spec in specs
    }
    needed_experiments = sorted(set(["subtasks", *per_system_experiment.values()]))
    paths_by_experiment = {
        experiment: _run_paths_by_iteration(results_root, experiment)
        for experiment in needed_experiments
    }

    if args.iterations:
        iteration_ids = sorted(set(args.iterations))
    else:
        experiment_sets = [set(paths_by_experiment[exp].keys()) for exp in needed_experiments]
        if not experiment_sets:
            iteration_ids = []
        else:
            common = set.intersection(*experiment_sets)
            iteration_ids = sorted(common if common else set.union(*experiment_sets))

    if not iteration_ids:
        joined = ", ".join(needed_experiments)
        raise FileNotFoundError(
            f"No runs found for experiments [{joined}] in {results_root}"
        )

    design_table = _compute_pipeline_design_scores(
        specs,
        iteration_ids,
        paths_by_experiment,
        per_system_experiment,
        domains,
        latest_measures_file,
        pipeline_code_eval_counts_from_measures,
    )
    implementation_table = _compute_pipeline_implementation_scores(
        specs,
        iteration_ids,
        paths_by_experiment,
        per_system_experiment,
        domains,
        run_scores_for_systems,
        is_subtask,
        metrics,
    )

    design_output = output_dir / "pipeline_design_scores.csv"
    implementation_output = output_dir / "pipeline_implementation_scores.csv"
    output_dir.mkdir(parents=True, exist_ok=True)
    design_table.to_csv(design_output, index=False)
    implementation_table.to_csv(implementation_output, index=False)

    print(f"Updated: {design_output}")
    print(f"Updated: {implementation_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
