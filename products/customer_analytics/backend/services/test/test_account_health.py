from django.test import SimpleTestCase

from parameterized import parameterized

from posthog.schema import AccountHealthStatus

from products.customer_analytics.backend.services.account_health import (
    compute_change_pct,
    compute_factor_score,
    compute_overall_score,
    no_data_score,
    status_for_score,
)


class TestAccountHealthScoring(SimpleTestCase):
    @parameterized.expand(
        [
            ("retained", 9.0, 10.0, 90),
            ("fully_retained", 10.0, 10.0, 100),
            ("capped_when_grew", 50.0, 10.0, 100),
            ("partial", 2.0, 10.0, 20),
            ("fully_churned", 0.0, 10.0, 0),
            ("new_usage", 5.0, 0.0, 100),
            ("no_signal", 0.0, 0.0, None),
        ]
    )
    def test_compute_factor_score(self, _name, current, previous, expected):
        self.assertEqual(compute_factor_score(current, previous), expected)

    @parameterized.expand(
        [
            ("decline", 9.0, 10.0, -10.0),
            ("growth", 12.0, 10.0, 20.0),
            ("no_baseline", 5.0, 0.0, None),
            ("both_zero", 0.0, 0.0, None),
        ]
    )
    def test_compute_change_pct(self, _name, current, previous, expected):
        self.assertEqual(compute_change_pct(current, previous), expected)

    @parameterized.expand(
        [
            ("simple_average", [90, 90], 90),
            ("rounds_mean", [92, 90], 91),
            ("ignores_nulls", [None, 90], 90),
            ("all_null", [None, None], None),
            ("empty", [], None),
        ]
    )
    def test_compute_overall_score(self, _name, factor_scores, expected):
        self.assertEqual(compute_overall_score(factor_scores), expected)

    @parameterized.expand(
        [
            ("top", 100, AccountHealthStatus.HEALTHY),
            ("healthy_boundary", 80, AccountHealthStatus.HEALTHY),
            ("needs_attention_high", 79, AccountHealthStatus.NEEDS_ATTENTION),
            ("needs_attention_boundary", 50, AccountHealthStatus.NEEDS_ATTENTION),
            ("at_risk_boundary", 49, AccountHealthStatus.AT_RISK),
            ("at_risk_floor", 0, AccountHealthStatus.AT_RISK),
            ("none_is_no_data", None, AccountHealthStatus.NO_DATA),
        ]
    )
    def test_status_for_score(self, _name, score, expected):
        self.assertEqual(status_for_score(score), expected)

    def test_no_data_score(self):
        score = no_data_score()
        self.assertIsNone(score.score)
        self.assertEqual(score.status, AccountHealthStatus.NO_DATA)
        self.assertEqual(score.factors, [])
