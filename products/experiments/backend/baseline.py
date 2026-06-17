from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING

from rest_framework.exceptions import ValidationError

from products.experiments.backend.hogql_queries import CONTROL_VARIANT_KEY

if TYPE_CHECKING:
    from products.experiments.backend.models.experiment import Experiment


def get_explicit_baseline_variant_key(stats_config: Mapping[str, object] | None) -> str | None:
    baseline_variant_key = (stats_config or {}).get("baseline_variant_key")
    return baseline_variant_key if isinstance(baseline_variant_key, str) and baseline_variant_key else None


def resolve_baseline_variant_key(
    variant_keys: Sequence[str],
    stats_config: Mapping[str, object] | None = None,
    *,
    excluded_variants: Sequence[str] | None = None,
) -> str:
    if len(variant_keys) < 2:
        raise ValidationError("Feature flag must have at least 2 variants")

    excluded_variant_keys = set(excluded_variants or [])
    explicit_baseline_key = get_explicit_baseline_variant_key(stats_config)

    if explicit_baseline_key:
        if explicit_baseline_key not in variant_keys:
            raise ValidationError(
                f"Invalid baseline_variant_key: '{explicit_baseline_key}'. "
                f"Must be one of: {', '.join(sorted(variant_keys))}"
            )
        baseline_variant_key = explicit_baseline_key
    elif CONTROL_VARIANT_KEY in variant_keys:
        baseline_variant_key = CONTROL_VARIANT_KEY
    else:
        baseline_variant_key = variant_keys[0]

    if baseline_variant_key in excluded_variant_keys:
        raise ValidationError(f"baseline variant cannot be excluded ('{baseline_variant_key}')")

    return baseline_variant_key


def resolve_experiment_baseline_variant_key(experiment: "Experiment") -> str:
    variant_keys = [variant["key"] for variant in experiment.feature_flag.variants]
    excluded_variants = (experiment.parameters or {}).get("excluded_variants") or []
    return resolve_baseline_variant_key(
        variant_keys,
        experiment.stats_config,
        excluded_variants=excluded_variants,
    )


def get_experiment_fingerprint_baseline_variant_key(experiment: "Experiment") -> str | None:
    if get_explicit_baseline_variant_key(experiment.stats_config) is None:
        return None
    return resolve_experiment_baseline_variant_key(experiment)
