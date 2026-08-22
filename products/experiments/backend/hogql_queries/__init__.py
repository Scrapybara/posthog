from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from products.experiments.backend.models.experiment import Experiment


# The FF variant name for control
CONTROL_VARIANT_KEY = "control"


def get_baseline_variant_key(stats_config: dict | None, variant_keys: list[str]) -> str:
    """The effective baseline for an experiment: the configured baseline_variant_key,
    else 'control' when the flag has one, else the flag's first variant.

    The 'control'-when-present step keeps the baseline stable for pre-existing
    experiments whose flag has 'control' in a non-first position."""
    configured = (stats_config or {}).get("baseline_variant_key")
    if configured:
        return configured
    if not variant_keys or CONTROL_VARIANT_KEY in variant_keys:
        return CONTROL_VARIANT_KEY
    return variant_keys[0]


def get_experiment_baseline_variant_key(experiment: "Experiment") -> str:
    variants = experiment.feature_flag.variants or []
    variant_keys = [variant["key"] for variant in variants if variant.get("key")]
    return get_baseline_variant_key(experiment.stats_config, variant_keys)


def get_fingerprint_baseline_variant_key(stats_config: dict | None, variant_keys: list[str]) -> str | None:
    configured = (stats_config or {}).get("baseline_variant_key")
    if configured:
        return configured
    if not variant_keys or CONTROL_VARIANT_KEY in variant_keys:
        return None
    return variant_keys[0]


def get_experiment_fingerprint_baseline_variant_key(experiment: "Experiment") -> str | None:
    variants = experiment.feature_flag.variants or []
    variant_keys = [variant["key"] for variant in variants if variant.get("key")]
    return get_fingerprint_baseline_variant_key(experiment.stats_config, variant_keys)


# The FF variant name for multiple variants
MULTIPLE_VARIANT_KEY = "$multiple"

# controls minimum number of people to be exposed to a variant
# before the results are deemed significant
FF_DISTRIBUTION_THRESHOLD = 100

# If probability of a variant is below this threshold, it will be considered
# insignificant
MIN_PROBABILITY_FOR_SIGNIFICANCE = 0.9

EXPECTED_LOSS_SIGNIFICANCE_LEVEL = 0.01
