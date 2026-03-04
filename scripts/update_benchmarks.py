#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import pandas as pd


@dataclass(frozen=True)
class SystemSpec:
    row_key: str
    variant_label: str
    model_label: str
    candidates: Sequence[str]


def _build_system_specs() -> List[SystemSpec]:
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
    mapping: Dict[int, Path] = {}
    prefix = f"results_{experiment}_"
    for path in sorted(results_root.glob(f"{prefix}*")):
        if not path.is_dir():
            continue
        suffix = path.name[len(prefix):]
        if suffix.isdigit():
            mapping[int(suffix)] = path
    return mapping


def _resolve_candidates(specs: Sequence[SystemSpec], run_path: Path) -> Dict[str, Optional[str]]:
    available = {
        child.name
        for child in run_path.iterdir()
        if child.is_dir() and not child.name.startswith(".")
    }
    resolved: Dict[str, Optional[str]] = {}
    for spec in specs:
        selected = None
        for candidate in spec.candidates:
            if candidate in available:
                selected = candidate
                break
        resolved[spec.row_key] = selected
    return resolved


def _compute_table(
    results_root: Path,
    specs: Sequence[SystemSpec],
    experiment: str,
    output_csv: Path,
    domains: Sequence[str],
    metrics: Sequence[str],
    iterations: Optional[Sequence[int]],
    per_system_experiment: Optional[Dict[str, str]] = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    helpers_path = results_root.parent / "scripts" / "results_helpers.py"
    if not helpers_path.is_file():
        raise FileNotFoundError(f"Missing helper module: {helpers_path}")

    spec = importlib.util.spec_from_file_location("results_helpers", helpers_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load module spec from {helpers_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    aggregate_runs = module.aggregate_runs
    run_scores_for_systems = module.run_scores_for_systems

    per_system_experiment = per_system_experiment or {}
    needed_experiments = sorted(set([experiment, *per_system_experiment.values()]))
    paths_by_experiment = {
        exp: _run_paths_by_iteration(results_root, exp) for exp in needed_experiments
    }

    if iterations:
        iteration_ids = sorted(set(iterations))
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

    run_scores = []
    empty_scores: Dict[str, Optional[float]] = {
        domain: None for domain in [*domains, "overall"]
    }
    specs_by_experiment: Dict[str, List[SystemSpec]] = {}
    for spec in specs:
        selected_experiment = per_system_experiment.get(spec.row_key, experiment)
        specs_by_experiment.setdefault(selected_experiment, []).append(spec)

    for iteration in iteration_ids:
        remapped: Dict[str, Dict[str, Optional[float]]] = {}
        for selected_experiment, experiment_specs in specs_by_experiment.items():
            run_path = paths_by_experiment.get(selected_experiment, {}).get(iteration)
            if run_path is None:
                for spec in experiment_specs:
                    remapped[spec.row_key] = empty_scores.copy()
                continue

            resolved = _resolve_candidates(experiment_specs, run_path)
            resolved_keys = sorted({value for value in resolved.values() if value is not None})
            raw_scores = {}
            if resolved_keys:
                raw_scores = run_scores_for_systems(
                    str(run_path),
                    resolved_keys,
                    domains=domains,
                    metrics=metrics,
                )

            for spec in experiment_specs:
                key = resolved.get(spec.row_key)
                remapped[spec.row_key] = raw_scores.get(key, empty_scores.copy())

        for spec in specs:
            remapped.setdefault(spec.row_key, empty_scores.copy())

        run_scores.append(remapped)

    system_order = [spec.row_key for spec in specs]
    mean_df, std_df = aggregate_runs(run_scores, systems=system_order, domains=domains)

    mean_pct = mean_df * 100
    std_pct = std_df * 100
    index = pd.MultiIndex.from_tuples(
        [(spec.variant_label, spec.model_label) for spec in specs],
        names=["System", "Models"],
    )
    mean_pct.index = index
    std_pct.index = index
    mean_pct = mean_pct[~mean_pct["overall"].isna()].copy()
    std_pct = std_pct.reindex(mean_pct.index)

    renamed_columns = {
        "archeology": "Archaeology",
        "astronomy": "Astronomy",
        "biomedical": "Biomedical",
        "environment": "Environment",
        "legal": "Legal",
        "wildfire": "Wildfire",
        "overall": "Overall",
    }
    mean_pct = mean_pct.rename(columns=renamed_columns)
    std_pct = std_pct.rename(columns=renamed_columns)
    ordered_cols = [
        "Archaeology",
        "Astronomy",
        "Biomedical",
        "Environment",
        "Legal",
        "Wildfire",
        "Overall",
    ]
    mean_pct = mean_pct[ordered_cols]
    std_pct = std_pct[ordered_cols]

    rounded = mean_pct.round(2)
    std_rounded = std_pct.round(2)
    return rounded, std_rounded


def _seconds_to_hhmmss(seconds: float) -> str:
    total_seconds = int(round(float(seconds)))
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    secs = total_seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def _write_score_csv(
    output_csv: Path,
    mean_table: pd.DataFrame,
    std_table: pd.DataFrame,
    runtime_mean: pd.Series,
    runtime_std: pd.Series,
) -> None:
    csv_df = mean_table.copy().astype(object)
    for row in csv_df.index:
        for col in csv_df.columns:
            mean_value = mean_table.loc[row, col]
            std_value = std_table.loc[row, col]
            if pd.isna(mean_value):
                csv_df.loc[row, col] = ""
            elif pd.isna(std_value):
                csv_df.loc[row, col] = f"{mean_value:.2f}%"
            else:
                csv_df.loc[row, col] = f"{mean_value:.2f}% ± {std_value:.2f}%"

    runtime_col: List[str] = []
    for row in csv_df.index:
        mean_value = runtime_mean.get(row)
        std_value = runtime_std.get(row)
        if pd.isna(mean_value):
            runtime_col.append("")
        elif pd.isna(std_value):
            runtime_col.append(_seconds_to_hhmmss(mean_value))
        else:
            runtime_col.append(
                f"{_seconds_to_hhmmss(mean_value)} ± {_seconds_to_hhmmss(std_value)}"
            )

    csv_df = csv_df.reset_index()
    csv_df["Overall Benchmark Time"] = runtime_col
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    csv_df.to_csv(output_csv, index=False)


def _print_table(title: str, table: pd.DataFrame, output_path: Path) -> None:
    print(f"\n=== {title} ===")
    print(f"Updated: {output_path}")
    print(table.to_string())


def _print_mean_std_table(
    title: str,
    mean_table: pd.DataFrame,
    std_table: pd.DataFrame,
    overall_runtime: Optional[tuple[pd.Series, pd.Series]] = None,
    overall_tokens: Optional[tuple[pd.Series, pd.Series]] = None,
) -> None:
    formatted = mean_table.copy().astype(object)

    for row in formatted.index:
        for col in formatted.columns:
            mean_value = mean_table.loc[row, col]
            std_value = std_table.loc[row, col]
            if pd.isna(mean_value):
                formatted.loc[row, col] = "-"
            elif pd.isna(std_value):
                formatted.loc[row, col] = f"{mean_value:.2f}%"
            else:
                formatted.loc[row, col] = f"{mean_value:.2f}% ± {std_value:.2f}%"

    if overall_runtime is not None:
        runtime_mean, runtime_std = overall_runtime
        runtime_col: List[str] = []
        for row in formatted.index:
            mean_value = runtime_mean.get(row)
            std_value = runtime_std.get(row)
            if pd.isna(mean_value):
                runtime_col.append("-")
            elif pd.isna(std_value):
                runtime_col.append(_seconds_to_hhmmss(mean_value))
            else:
                runtime_col.append(
                    f"{_seconds_to_hhmmss(mean_value)} ± {_seconds_to_hhmmss(std_value)}"
                )
        formatted["Overall Runtime"] = runtime_col

    if overall_tokens is not None:
        token_mean, token_std = overall_tokens
        token_col: List[str] = []
        for row in formatted.index:
            mean_value = token_mean.get(row)
            std_value = token_std.get(row)
            if pd.isna(mean_value):
                token_col.append("-")
            elif pd.isna(std_value):
                token_col.append(f"{mean_value:.0f}")
            else:
                token_col.append(f"{mean_value:.0f} ± {std_value:.0f}")
        formatted["Overall Tokens"] = token_col

    print(f"\n=== {title} (mean ± std) ===")
    print(formatted.to_string())


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    default_results_root = (repo_root / ".." / "krama-results" / "results").resolve()

    parser = argparse.ArgumentParser(
        description="Refresh benchmark CSVs from krama-results output.",
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
        help="Directory where benchmark_results.csv and benchmark_oracle.csv are written.",
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
    if not results_root.is_dir():
        raise FileNotFoundError(f"Results directory does not exist: {results_root}")

    specs = _build_system_specs()
    domains = ["archeology", "astronomy", "biomedical", "environment", "legal", "wildfire"]
    metrics = ["success", "f1", "llm_paraphrase", "rae_score"]

    benchmark_experiment_by_row = {
        spec.row_key: (
            "full"
            if "Claude" in spec.model_label
            or any("Claude" in candidate for candidate in spec.candidates)
            else "subtasks"
        )
        for spec in specs
    }

    benchmark_table, benchmark_std = _compute_table(
        results_root=results_root,
        specs=specs,
        experiment="subtasks",
        output_csv=args.output_dir / "benchmark_results.csv",
        domains=domains,
        metrics=metrics,
        iterations=args.iterations,
        per_system_experiment=benchmark_experiment_by_row,
    )
    benchmark_runtime_table, benchmark_runtime_std = _compute_table(
        results_root=results_root,
        specs=specs,
        experiment="subtasks",
        output_csv=args.output_dir / "benchmark_results.csv",
        domains=domains,
        metrics=["runtime"],
        iterations=args.iterations,
        per_system_experiment=benchmark_experiment_by_row,
    )
    benchmark_token_table, benchmark_token_std = _compute_table(
        results_root=results_root,
        specs=specs,
        experiment="subtasks",
        output_csv=args.output_dir / "benchmark_results.csv",
        domains=domains,
        metrics=["token_usage_sut"],
        iterations=args.iterations,
        per_system_experiment=benchmark_experiment_by_row,
    )
    oracle_table, oracle_std = _compute_table(
        results_root=results_root,
        specs=specs,
        experiment="oracle",
        output_csv=args.output_dir / "benchmark_oracle.csv",
        domains=domains,
        metrics=metrics,
        iterations=args.iterations,
    )
    oracle_runtime_table, oracle_runtime_std = _compute_table(
        results_root=results_root,
        specs=specs,
        experiment="oracle",
        output_csv=args.output_dir / "benchmark_oracle.csv",
        domains=domains,
        metrics=["runtime"],
        iterations=args.iterations,
    )
    oracle_token_table, oracle_token_std = _compute_table(
        results_root=results_root,
        specs=specs,
        experiment="oracle",
        output_csv=args.output_dir / "benchmark_oracle.csv",
        domains=domains,
        metrics=["token_usage_sut"],
        iterations=args.iterations,
    )

    _write_score_csv(
        args.output_dir / "benchmark_results.csv",
        benchmark_table,
        benchmark_std,
        benchmark_runtime_table["Overall"],
        benchmark_runtime_std["Overall"],
    )
    _write_score_csv(
        args.output_dir / "benchmark_oracle.csv",
        oracle_table,
        oracle_std,
        oracle_runtime_table["Overall"],
        oracle_runtime_std["Overall"],
    )

    _print_table("benchmark_results.csv (full inputs)", benchmark_table, args.output_dir / "benchmark_results.csv")
    _print_mean_std_table(
        "benchmark_results.csv (full inputs)",
        benchmark_table,
        benchmark_std,
        overall_runtime=(benchmark_runtime_table["Overall"], benchmark_runtime_std["Overall"]),
        overall_tokens=(benchmark_token_table["Overall"], benchmark_token_std["Overall"]),
    )
    _print_table("benchmark_oracle.csv (oracle inputs)", oracle_table, args.output_dir / "benchmark_oracle.csv")
    _print_mean_std_table(
        "benchmark_oracle.csv (oracle inputs)",
        oracle_table,
        oracle_std,
        overall_runtime=(oracle_runtime_table["Overall"], oracle_runtime_std["Overall"]),
        overall_tokens=(oracle_token_table["Overall"], oracle_token_std["Overall"]),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())