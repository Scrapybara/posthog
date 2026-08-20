"""Seed Customer analytics accounts from a project's existing group-analytics groups.

Builds on top of data already in a project (e.g. demo data) instead of generating events,
so it has no dependency on ClickHouse->Postgres sync timing. For the given team it:

- reads the group-analytics groups at index 0,
- creates an Account for each (external_id = group key, so the account org page resolves),
- ensures a small shared pool of organization-member users and assigns them as each account's
  CSM / account executive / account owner,
- adds a few notes (internal notebooks) to a handful of accounts,
- points the team's customer-analytics config at group type index 0.
- optionally adds deterministic healthy, neutral, at-risk, and no-data examples.

Re-running is safe: existing accounts, pool users, and notes are left alone.

Usage:
    python manage.py seed_customer_analytics_accounts --team-id 1
    python manage.py seed_customer_analytics_accounts --team-id 1 --users 5 --accounts-with-notes 5
    python manage.py seed_customer_analytics_accounts --team-id 1 --health-fixtures
    python manage.py seed_customer_analytics_accounts --team-id 1 --dry-run
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import NAMESPACE_URL, uuid4, uuid5

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from posthog.hogql.timings import HogQLTimings

from posthog.api.capture import capture_batch_internal
from posthog.models import OrganizationMembership, Team, User
from posthog.models.group_type_mapping import get_group_types_for_project
from posthog.models.group_usage_metric import GroupUsageMetric
from posthog.models.scoping import team_scope
from posthog.persons_db import persons_db_connection

from products.customer_analytics.backend.facade.api import create_account
from products.customer_analytics.backend.hogql_queries.account_health import AccountHealthScorer
from products.customer_analytics.backend.logic import relationships as relationships_logic
from products.customer_analytics.backend.models.account import Account, AccountProperties
from products.customer_analytics.backend.models.relationship import AccountRelationshipDefinition
from products.customer_analytics.backend.models.team_customer_analytics_config import TeamCustomerAnalyticsConfig
from products.notebooks.backend.facade import api as notebooks

ACCOUNT_GROUP_TYPE_INDEX = 0
HEALTH_FIXTURE_EVENT = "customer analytics health fixture"
HEALTH_FIXTURE_METRIC = "Account health fixture"
HEALTH_FIXTURE_ACCOUNTS = (
    ("health-example-healthy", "Health example: Healthy", 9, 10),
    ("health-example-neutral", "Health example: Neutral", 6, 10),
    ("health-example-at-risk", "Health example: At risk", 3, 10),
    ("health-example-no-data", "Health example: No data", 0, 0),
)

NOTE_TEMPLATES: list[tuple[str, str]] = [
    ("Kickoff call", "Walked the team through onboarding. Main goal is consolidating file storage across departments."),
    ("QBR summary", "Reviewed usage trends — uploads up month over month. Flagged seats approaching the plan limit."),
    ("Renewal notes", "Renewal in ~60 days. Champion is happy; needs finance sign-off on the enterprise tier."),
    ("Support escalation", "Looked into slow shared-link loads. Mitigated for now; permanent fix ETA to follow."),
]


class Command(BaseCommand):
    help = "Seed Customer analytics accounts from existing group-analytics groups."

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
            "--health-fixtures",
            action="store_true",
            help="Add healthy, neutral, at-risk, and no-data account health examples.",
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
            if options["health_fixtures"]:
                self.stdout.write("Would also add four deterministic account health examples.")
            return

        self._set_config(team)
        user_pool = self._ensure_user_pool(team, options["users"])
        accounts = self._create_accounts(team, groups, user_pool)
        self._create_notes(team, accounts, user_pool, options["accounts_with_notes"], options["notes_per_account"])
        if options["health_fixtures"]:
            health_accounts = self._create_health_fixture_accounts(team, user_pool)
            self._create_health_fixture_events(team, health_accounts, self._account_group_type(team))
        self.stdout.write(self.style.SUCCESS("Done."))

    def _get_team(self, team_id: int) -> Team:
        try:
            return Team.objects.get(pk=team_id)
        except Team.DoesNotExist:
            raise CommandError(f"Team {team_id} does not exist.")

    def _read_account_groups(self, team: Team, limit: int | None) -> list[tuple[str, dict[str, Any]]]:
        query = (
            "SELECT group_key, group_properties FROM posthog_group "
            "WHERE team_id = %(team_id)s AND group_type_index = %(gti)s ORDER BY group_key"
        )
        with persons_db_connection(writer=False) as conn, conn.cursor() as cursor:
            cursor.execute(query, {"team_id": team.pk, "gti": ACCOUNT_GROUP_TYPE_INDEX})
            rows = [(group_key, props or {}) for group_key, props in cursor.fetchall()]
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
        creator = team.organization.members.first()
        created = 0
        accounts: list[Account] = []
        definitions = self._ensure_role_definitions(team, creator)
        with team_scope(team.pk):
            existing = {
                account.external_id: account
                for account in Account.objects.filter(external_id__in=[key for key, _ in groups])
            }
            for index, (group_key, props) in enumerate(groups):
                account = existing.get(group_key)
                if account is None:
                    account = create_account(
                        team=team,
                        name=props.get("name") or group_key,
                        external_id=group_key,
                        created_by=creator,
                        properties=AccountProperties(stripe_customer_id=f"cus_{group_key[:14]}"),
                    )
                    self._assign_roles(team, account, definitions, user_pool, index, creator)
                    created += 1
                accounts.append(account)
        self.stdout.write(f"Created {created} account(s) ({len(groups) - created} already existed).")
        return accounts

    @staticmethod
    def _ensure_role_definitions(team: Team, creator: User | None) -> list[AccountRelationshipDefinition]:
        return [
            AccountRelationshipDefinition.objects.for_team(team.pk).get_or_create(
                team_id=team.pk, name=name, defaults={"created_by": creator}
            )[0]
            for name in ("CSM", "Account executive", "Account owner")
        ]

    @staticmethod
    def _assign_roles(
        team: Team,
        account: Account,
        definitions: list[AccountRelationshipDefinition],
        user_pool: list[User],
        index: int,
        creator: User | None,
    ) -> None:
        if not user_pool:
            return
        for offset, definition in enumerate(definitions):
            relationships_logic.assign(
                team_id=team.pk,
                account=account,
                definition=definition,
                user=user_pool[(index + offset) % len(user_pool)],
                created_by=creator,
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
                notebooks.create_account_notebook(
                    team.id,
                    account.id,
                    title=f"{account.name} — {title}",
                    content=_paragraph_doc(body),
                    text_content=body,
                    created_by_id=author.id if author else None,
                    last_modified_by_id=author.id if author else None,
                )
                created += 1
        self.stdout.write(f"Created {created} note(s) across up to {len(selected)} account(s).")

    @transaction.atomic
    def _create_health_fixture_accounts(self, team: Team, user_pool: list[User]) -> list[Account]:
        creator = team.organization.members.first()
        definitions = self._ensure_role_definitions(team, creator)
        accounts: list[Account] = []
        created = 0
        with team_scope(team.pk):
            for index, (external_id, name, _, _) in enumerate(HEALTH_FIXTURE_ACCOUNTS):
                account = Account.objects.filter(external_id=external_id).first()
                if account is None:
                    account = create_account(
                        team=team,
                        name=name,
                        external_id=external_id,
                        created_by=creator,
                        properties=AccountProperties(),
                    )
                    self._assign_roles(team, account, definitions, user_pool, index, creator)
                    created += 1
                accounts.append(account)
        self.stdout.write(f"Ensured four account health examples ({created} created).")
        return accounts

    @staticmethod
    def _account_group_type(team: Team) -> str:
        group_type = next(
            (
                mapping["group_type"]
                for mapping in get_group_types_for_project(
                    team.project_id, caller_tag="seed_customer_analytics_accounts"
                )
                if mapping["group_type_index"] == ACCOUNT_GROUP_TYPE_INDEX
            ),
            None,
        )
        if not group_type:
            raise CommandError("The account group type could not be resolved. Configure group analytics, then rerun.")
        return group_type

    def _create_health_fixture_events(self, team: Team, accounts: list[Account], group_type: str) -> None:
        metric, _ = GroupUsageMetric.objects.update_or_create(
            team=team,
            group_type_index=ACCOUNT_GROUP_TYPE_INDEX,
            name=HEALTH_FIXTURE_METRIC,
            defaults={
                "format": GroupUsageMetric.Format.NUMERIC,
                "interval": 30,
                "display": GroupUsageMetric.Display.NUMBER,
                "filters": {"events": [{"id": HEALTH_FIXTURE_EVENT, "type": "events", "order": 0}]},
                "math": GroupUsageMetric.Math.COUNT,
                "math_property": None,
            },
        )
        selected_metric_ids = [
            selected_metric.id
            for selected_metric, _ in AccountHealthScorer(
                team=team,
                timings=HogQLTimings(),
                modifiers=None,
                user=None,
            ).eligible_metrics
        ]
        if metric.id not in selected_metric_ids:
            raise CommandError(
                "The health fixture metric is outside the first five usage metrics. Remove or rename earlier metrics, then rerun."
            )

        now = datetime.now(UTC)
        events: list[dict[str, Any]] = []
        counts_by_external_id = {
            external_id: (current_count, previous_count)
            for external_id, _, current_count, previous_count in HEALTH_FIXTURE_ACCOUNTS
        }
        for account in accounts:
            current_count, previous_count = counts_by_external_id[account.external_id or ""]
            for period, count, timestamp in (
                ("current", current_count, now - timedelta(days=15)),
                ("previous", previous_count, now - timedelta(days=45)),
            ):
                for index in range(count):
                    events.append(
                        {
                            "event": HEALTH_FIXTURE_EVENT,
                            "distinct_id": f"health-fixture-{account.external_id}",
                            "timestamp": timestamp + timedelta(seconds=index),
                            "properties": {"$groups": {group_type: account.external_id}},
                            "event_uuid": str(
                                uuid5(
                                    NAMESPACE_URL,
                                    f"posthog:health-fixture:v2:{team.id}:{account.external_id}:{period}:{index}",
                                )
                            ),
                        }
                    )
        capture_batch_internal(
            events=events,
            token=team.api_token,
            event_source="seed_customer_analytics_accounts",
            historical_migration=True,
            process_person_profile=True,
        ).raise_for_status()
        self.stdout.write(
            f"Sent {len(events)} health fixture events. Scores appear after historical ingestion catches up."
        )


def _paragraph_doc(text: str) -> dict[str, Any]:
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}
