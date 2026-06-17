from typing import Any

from posthog.test.base import APIBaseTest, QueryMatchingTest

from rest_framework import status

from posthog.api.test.dashboards import DashboardAPI
from posthog.constants import AvailableFeature
from posthog.models.organization import OrganizationMembership

from ee.models.rbac.access_control import AccessControl

# A section header is an ordinary transparent text tile whose markdown body is a heading, an optional
# description paragraph, and a trailing divider. There is no section-header model — these tests pin the
# text-tile representation the feature relies on (full-width transparent placement, body persistence,
# duplication, deletion, and serialization).
SECTION_BODY = "## Acquisition\n\nHow new users discover and sign up for the product\n\n---"
SECTION_LAYOUTS = {"sm": {"x": 0, "y": 0, "w": 12, "h": 2}, "xs": {"x": 0, "y": 0, "w": 1, "h": 2}}


class TestDashboardSectionHeaders(APIBaseTest, QueryMatchingTest):
    def setUp(self) -> None:
        super().setUp()
        self.dashboard_api = DashboardAPI(self.client, self.team, self.assertEqual)

    def _create_section(self, dashboard_id: int, body: str = SECTION_BODY) -> dict[str, Any]:
        _, dashboard = self.dashboard_api.create_text_tile(
            dashboard_id,
            text=body,
            extra_data={"transparent_background": True, "layouts": SECTION_LAYOUTS},
        )
        return next(tile for tile in dashboard["tiles"] if tile.get("text"))

    def test_creates_full_width_transparent_section_header(self) -> None:
        dashboard_id, _ = self.dashboard_api.create_dashboard({"name": "Growth"})

        section = self._create_section(dashboard_id)

        self.assertEqual(section["transparent_background"], True)
        self.assertEqual(section["text"]["body"], SECTION_BODY)
        self.assertEqual(section["layouts"]["sm"]["w"], 12)
        self.assertEqual(section["layouts"]["sm"]["x"], 0)
        self.assertEqual(section["layouts"]["xs"]["w"], 1)

    def test_serializes_section_header_fields(self) -> None:
        dashboard_id, _ = self.dashboard_api.create_dashboard({"name": "Growth"})
        section = self._create_section(dashboard_id)

        dashboard = self.dashboard_api.get_dashboard(dashboard_id)
        serialized = next(tile for tile in dashboard["tiles"] if tile["id"] == section["id"])

        self.assertEqual(serialized["text"]["body"], SECTION_BODY)
        self.assertEqual(serialized["transparent_background"], True)
        self.assertEqual(serialized["layouts"]["sm"]["w"], 12)

    def test_edits_section_header_body_in_place(self) -> None:
        dashboard_id, _ = self.dashboard_api.create_dashboard({"name": "Growth"})
        section = self._create_section(dashboard_id)
        new_body = "## Acquisition\n\nUpdated subtitle\n\n---"

        _, updated = self.dashboard_api.update_text_tile(
            dashboard_id,
            {
                "id": section["id"],
                "text": {"id": section["text"]["id"], "body": new_body},
                "transparent_background": True,
            },
        )

        updated_section = next(tile for tile in updated["tiles"] if tile["id"] == section["id"])
        self.assertEqual(updated_section["text"]["body"], new_body)
        self.assertEqual(updated_section["transparent_background"], True)
        # The body is edited in place — the same Text row is reused, not replaced.
        self.assertEqual(updated_section["text"]["id"], section["text"]["id"])

    def test_duplicating_dashboard_preserves_section_header(self) -> None:
        dashboard_id, _ = self.dashboard_api.create_dashboard({"name": "Growth"})
        section = self._create_section(dashboard_id)

        duplicated = self.client.post(
            f"/api/projects/{self.team.id}/dashboards",
            {"name": "Growth copy", "use_dashboard": dashboard_id, "duplicate_tiles": True},
        ).json()

        duplicated_section = next(tile for tile in duplicated["tiles"] if tile.get("text"))
        self.assertNotEqual(duplicated_section["id"], section["id"])
        self.assertEqual(duplicated_section["transparent_background"], True)
        self.assertEqual(duplicated_section["text"]["body"], SECTION_BODY)
        self.assertEqual(duplicated_section["layouts"]["sm"]["w"], 12)

    def test_soft_deletes_section_header_tile(self) -> None:
        dashboard_id, _ = self.dashboard_api.create_dashboard({"name": "Growth"})
        section = self._create_section(dashboard_id)

        response = self.client.patch(
            f"/api/projects/{self.team.id}/dashboards/{dashboard_id}",
            {"tiles": [{"id": section["id"], "deleted": True}]},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

        dashboard = self.dashboard_api.get_dashboard(dashboard_id)
        self.assertTrue(all(tile["id"] != section["id"] for tile in dashboard["tiles"]))

    def test_non_editor_cannot_create_section_header(self) -> None:
        self.organization.available_product_features = [
            {"key": AvailableFeature.ACCESS_CONTROL, "name": AvailableFeature.ACCESS_CONTROL},
            {"key": AvailableFeature.ROLE_BASED_ACCESS, "name": AvailableFeature.ROLE_BASED_ACCESS},
        ]
        self.organization.save()

        dashboard_id, _ = self.dashboard_api.create_dashboard({"name": "Growth"})
        AccessControl.objects.create(
            resource="dashboard", resource_id=str(dashboard_id), team=self.team, access_level="none"
        )

        viewer = self._create_user("viewer@posthog.com", level=OrganizationMembership.Level.MEMBER)
        self.client.force_login(viewer)

        self.dashboard_api.create_text_tile(
            dashboard_id,
            text=SECTION_BODY,
            extra_data={"transparent_background": True, "layouts": SECTION_LAYOUTS},
            expected_status=status.HTTP_403_FORBIDDEN,
        )
