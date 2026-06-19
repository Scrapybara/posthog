"""Seed Customer analytics accounts from a project's existing group-analytics groups.

Builds on top of data already in a project (e.g. demo data) instead of generating events,
so it has no dependency on ClickHouse->Postgres sync timing. For the given team it:

- reads the group-analytics groups at index 0,
- creates an Account for each (external_id = group key, so the account org page resolves),
- ensures a small shared pool of organization-member users and assigns them as each account's
  CSM / account executive / account owner,
- adds a few notes (internal notebooks) to a handful of accounts,
- points the team's customer-analytics config at group type index 0.

Re-running is safe: existing accounts, pool users, and notes are left alone.

Optionally, `--with-health-demo` also seeds two demo usage metrics plus deterministic events so the
accounts list's Health column has something healthy and something at risk to show. It is off by
default and is the only part of this command that writes events — the default behavior stays
event-free and Kafka-free.

Usage:
    python manage.py seed_customer_analytics_accounts --team-id 1
    python manage.py seed_customer_analytics_accounts --team-id 1 --users 5 --accounts-with-notes 5
    python manage.py seed_customer_analytics_accounts --team-id 1 --with-health-demo
    python manage.py seed_customer_analytics_accounts --team-id 1 --dry-run
"""

import uuid
from datetime import timedelta
from typing import Any
from uuid import uuid4

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from posthog.clickhouse.client import sync_execute
from posthog.models import Group, OrganizationMembership, Team, User
from posthog.models.event.sql import EVENTS_DATA_TABLE
from posthog.models.event.util import create_event
from posthog.models.group_usage_metric import GroupUsageMetric
from posthog.models.scoping import team_scope

from products.customer_analytics.backend.models.account import Account, AccountAssignment, AccountProperties
from products.customer_analytics.backend.models.team_customer_analytics_config import TeamCustomerAnalyticsConfig
from products.notebooks.backend.models import Notebook, ResourceNotebook

ACCOUNT_GROUP_TYPE_INDEX = 0

NOTE_TEMPLATES: list[tuple[str, str]] = [
    ("Kickoff call", "Walked the team through onboarding. Main goal is consolidating file storage across departments."),
    ("QBR summary", "Reviewed usage trends — uploads up month over month. Flagged seats approaching the plan limit."),
    ("Renewal notes", "Renewal in ~60 days. Champion is happy; needs finance sign-off on the enterprise tier."),
    ("Support escalation", "Looked into slow shared-link loads. Mitigated for now; permanent fix ETA to follow."),
]

# Stable namespace so health-demo event UUIDs are reproducible (uuid5) — re-running the command
# regenerates the exact same rows instead of piling up duplicates.
HEALTH_DEMO_UUID_NAMESPACE = uuid.UUID("5b6c3d2e-1f4a-4c8b-9e7d-0a1b2c3d4e5f")
HEALTH_DEMO_INTERVAL_DAYS = 7

# Two count metrics, one event each. The current/previous counts below produce the demo narrative:
# the first external-id account retains 9/10 (healthy ~90) and the second retains 2/10 (at risk ~20)
# on both factors.
HEALTH_DEMO_METRICS: list[tuple[str, str]] = [
    ("Customer analytics demo: Events ingested", "demo_health_event_ingested"),
    ("Customer analytics demo: Active users", "demo_health_active_user"),
]
# (current_period_count, previous_period_count) per account, indexed by account position.
HEALTH_DEMO_COUNTS: list[tuple[int, int]] = [(9, 10), (2, 10)]


class Command(BaseCommand):
    help = "Seed Customer analytics accounts (with users and notes) from existing group-analytics groups."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--team-id", type=int, required=True, help="Team whose groups to read and seed into.")
        parser.add_argument(
            "--users",
            type=int,
            default=5,
            help="Size of the org-member user pool to create and assign as account roles (default: 5).",
        )
        parser.add_argument(
            "--accounts-with-notes", type=int, default=5, help="How many accounts get notes (default: 5)."
        )
        parser.add_argument(
            "--notes-per-account", type=int, default=2, help="Notes created per selected account (default: 2)."
        )
        parser.add_argument(
            "--limit", type=int, default=None, help="Cap how many groups become accounts (default: all)."
        )
        parser.add_argument(
            "--with-health-demo",
            action="store_true",
            help="Also seed two demo usage metrics and deterministic events so the Health column has "
            "healthy and at-risk accounts to show (writes events; off by default).",
        )
        parser.add_argument("--dry-run", action="store_true", help="Report what would be created without writing.")

    def handle(self, *args: Any, **options: Any) -> None:
        team = self._get_team(options["team_id"])
        groups = self._read_account_groups(team, options["limit"])
        if not groups:
            raise CommandError(f"No group-analytics groups at index {ACCOUNT_GROUP_TYPE_INDEX} for team {team.pk}.")

        self.stdout.write(
            f"Found {len(groups)} group(s) at index {ACCOUNT_GROUP_TYPE_INDEX} for team {team.pk} ({team.name})."
        )

        if options["dry_run"]:
            note_account_count = min(options["accounts_with_notes"], len(groups))
            self.stdout.write(self.style.WARNING("Dry run — no changes will be written."))
            self.stdout.write(
                f"Would set account_group_type_index = {ACCOUNT_GROUP_TYPE_INDEX}, "
                f"create up to {len(groups)} account(s), ensure a pool of {options['users']} user(s), "
                f"and add up to {note_account_count * options['notes_per_account']} note(s) "
                f"across {note_account_count} account(s)."
            )
            if options["with_health_demo"]:
                demo_account_count = min(len(HEALTH_DEMO_COUNTS), len(groups))
                event_count = self._health_demo_event_count(demo_account_count)
                self.stdout.write(
                    f"Would also define/update {len(HEALTH_DEMO_METRICS)} demo usage metric(s) and queue "
                    f"{event_count} event(s) across the first {demo_account_count} account(s) for the Health column."
                )
            return

        self._set_config(team)
        user_pool = self._ensure_user_pool(team, options["users"])
        accounts = self._create_accounts(team, groups, user_pool)
        self._create_notes(team, accounts, user_pool, options["accounts_with_notes"], options["notes_per_account"])
        if options["with_health_demo"]:
            self._create_health_demo(team, accounts)
        self.stdout.write(self.style.SUCCESS("Done."))

    def _get_team(self, team_id: int) -> Team:
        try:
            return Team.objects.get(pk=team_id)
        except Team.DoesNotExist:
            raise CommandError(f"Team {team_id} does not exist.")

    def _read_account_groups(self, team: Team, limit: int | None) -> list[tuple[str, dict[str, Any]]]:
        rows = [
            (group_key, props or {})
            for group_key, props in Group.objects.filter(  # nosemgrep: no-direct-persons-db-orm
                team_id=team.pk, group_type_index=ACCOUNT_GROUP_TYPE_INDEX
            )
            .order_by("group_key")
            .values_list("group_key", "group_properties")
        ]
        return rows[:limit] if limit is not None else rows

    def _set_config(self, team: Team) -> None:
        # Point customer analytics at the group type we seed from, so the accounts list and the
        # account org page's usage metrics resolve against it.
        TeamCustomerAnalyticsConfig.objects.update_or_create(
            team=team, defaults={"account_group_type_index": ACCOUNT_GROUP_TYPE_INDEX}
        )
        self.stdout.write(f"Set account_group_type_index = {ACCOUNT_GROUP_TYPE_INDEX}.")

    def _ensure_user_pool(self, team: Team, count: int) -> list[User]:
        organization = team.organization
        # Team-scoped email domain keeps pool users unique per team (User.email is globally unique).
        domain = f"team{team.pk}.customer-analytics.invalid"
        pool: list[User] = []
        created = 0
        for i in range(1, count + 1):
            email = f"ca-seed-{i}@{domain}"
            existing = User.objects.filter(email=email).first()
            # Reuse a prior run's seed user, but never adopt a stranger who happens to hold the
            # predictable address into the org — if the email is taken by a non-member, mint a
            # fresh unguessable one instead.
            if (
                existing is not None
                and OrganizationMembership.objects.filter(organization=organization, user=existing).exists()
            ):
                pool.append(existing)
                continue
            if existing is not None:
                email = f"ca-seed-{i}-{uuid4().hex[:8]}@{domain}"
            pool.append(
                User.objects.create_and_join(
                    organization=organization,
                    email=email,
                    password=None,
                    first_name=f"Account Manager {i}",
                    level=OrganizationMembership.Level.MEMBER,
                )
            )
            created += 1
        self.stdout.write(f"Ensured pool of {len(pool)} org member user(s) ({created} created).")
        return pool

    @transaction.atomic
    def _create_accounts(
        self, team: Team, groups: list[tuple[str, dict[str, Any]]], user_pool: list[User]
    ) -> list[Account]:
        assignments = [AccountAssignment(id=user.id, email=user.email) for user in user_pool]
        creator = team.organization.members.first()
        created = 0
        accounts: list[Account] = []
        with team_scope(team.pk):
            existing = {
                account.external_id: account
                for account in Account.objects.filter(external_id__in=[key for key, _ in groups])
            }
            for index, (group_key, props) in enumerate(groups):
                account = existing.get(group_key)
                if account is None:
                    account = Account.objects.create(
                        team=team,
                        name=props.get("name") or group_key,
                        external_id=group_key,
                        created_by=creator,
                        _properties=self._account_roles(assignments, index, group_key).model_dump(mode="json"),
                    )
                    created += 1
                accounts.append(account)
        self.stdout.write(f"Created {created} account(s) ({len(groups) - created} already existed).")
        return accounts

    @staticmethod
    def _account_roles(assignments: list[AccountAssignment], index: int, group_key: str) -> AccountProperties:
        count = len(assignments)
        return AccountProperties(
            csm=assignments[index % count] if count else None,
            account_executive=assignments[(index + 1) % count] if count else None,
            account_owner=assignments[(index + 2) % count] if count else None,
            stripe_customer_id=f"cus_{group_key[:14]}",
        )

    @transaction.atomic
    def _create_notes(
        self,
        team: Team,
        accounts: list[Account],
        user_pool: list[User],
        accounts_with_notes: int,
        notes_per_account: int,
    ) -> None:
        if accounts_with_notes <= 0 or notes_per_account <= 0:
            return
        author = user_pool[0] if user_pool else team.organization.members.first()
        created = 0
        selected = accounts[:accounts_with_notes]
        for account in selected:
            if account.notebooks.exists():  # keep re-runs idempotent — don't pile on
                continue
            for note_index in range(notes_per_account):
                title, body = NOTE_TEMPLATES[note_index % len(NOTE_TEMPLATES)]
                notebook = Notebook.objects.create(
                    team=team,
                    title=f"{account.name} — {title}",
                    content=_paragraph_doc(body),
                    text_content=body,
                    created_by=author,
                    last_modified_by=author,
                    visibility=Notebook.Visibility.INTERNAL,
                )
                ResourceNotebook.objects.create(notebook=notebook, account=account)
                created += 1
        self.stdout.write(f"Created {created} note(s) across up to {len(selected)} account(s).")

    @staticmethod
    def _health_demo_event_count(account_count: int) -> int:
        per_account = sum(current + previous for current, previous in HEALTH_DEMO_COUNTS[:account_count])
        return per_account * len(HEALTH_DEMO_METRICS)

    def _ensure_health_demo_metrics(self, team: Team) -> list[GroupUsageMetric]:
        metrics: list[GroupUsageMetric] = []
        for name, event_name in HEALTH_DEMO_METRICS:
            metric, _ = GroupUsageMetric.objects.update_or_create(
                team=team,
                group_type_index=ACCOUNT_GROUP_TYPE_INDEX,
                name=name,
                defaults={
                    "interval": HEALTH_DEMO_INTERVAL_DAYS,
                    "math": GroupUsageMetric.Math.COUNT,
                    "format": GroupUsageMetric.Format.NUMERIC,
                    "display": GroupUsageMetric.Display.NUMBER,
                    "filters": {"events": [{"id": event_name, "type": "events", "order": 0}]},
                },
            )
            metrics.append(metric)
        return metrics

    def _emit_demo_events(
        self, team: Team, external_id: str, distinct_id: str, event_name: str, period: str, count: int, timestamp: Any
    ) -> int:
        group_property = f"$group_{ACCOUNT_GROUP_TYPE_INDEX}"
        for i in range(count):
            # Keep identifiers deterministic so this fixture is reproducible after its prior rows are cleared.
            event_uuid = uuid.uuid5(HEALTH_DEMO_UUID_NAMESPACE, f"{team.id}:{external_id}:{event_name}:{period}:{i}")
            create_event(
                event_uuid=event_uuid,
                event=event_name,
                team=team,
                distinct_id=distinct_id,
                timestamp=timestamp,
                properties={group_property: external_id},
            )
        return count

    def _create_health_demo(self, team: Team, accounts: list[Account]) -> None:
        self._clear_health_demo_events(team)
        metrics = self._ensure_health_demo_metrics(team)
        # Only accounts with an external id can carry group-attributed events.
        demo_accounts = [account for account in accounts if account.external_id][: len(HEALTH_DEMO_COUNTS)]
        now = timezone.now()
        # Current period is the trailing `interval` days; the previous period is the one before it.
        # Place events safely inside each window so the relative timestamps stay valid when scored.
        current_ts = now - timedelta(days=3)
        previous_ts = now - timedelta(days=HEALTH_DEMO_INTERVAL_DAYS + 3)
        created = 0
        for account_index, account in enumerate(demo_accounts):
            external_id = account.external_id
            assert external_id is not None  # filtered above; reassures the type checker
            current_count, previous_count = HEALTH_DEMO_COUNTS[account_index]
            distinct_id = f"ca-health-demo-{external_id}"
            for _name, event_name in HEALTH_DEMO_METRICS:
                created += self._emit_demo_events(
                    team, external_id, distinct_id, event_name, "current", current_count, current_ts
                )
                created += self._emit_demo_events(
                    team, external_id, distinct_id, event_name, "previous", previous_count, previous_ts
                )
        self.stdout.write(
            f"Defined/updated {len(metrics)} demo usage metric(s) and queued {created} event(s) "
            f"across {len(demo_accounts)} account(s) for the Health column."
        )

    def _clear_health_demo_events(self, team: Team) -> None:
        # Stable UUIDs alone are insufficient because the events table key also includes the event
        # date. Remove this seeder's namespaced events before recreating rolling-window fixtures.
        sync_execute(
            f"ALTER TABLE {EVENTS_DATA_TABLE()} DELETE WHERE team_id = %(team_id)s "
            "AND event IN %(event_names)s SETTINGS mutations_sync=1",
            {
                "team_id": team.id,
                "event_names": tuple(event_name for _, event_name in HEALTH_DEMO_METRICS),
            },
        )


def _paragraph_doc(text: str) -> dict[str, Any]:
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}
