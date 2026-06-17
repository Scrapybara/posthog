from posthog.api.routing import RouterRegistry

from products.posthog_ai.backend.api import ConversationAttachmentViewSet, MCPToolsViewSet


def register_routes(routers: RouterRegistry) -> None:
    routers.projects.register(
        r"conversation_attachments",
        ConversationAttachmentViewSet,
        "project_conversation_attachments",
        ["team_id"],
    )
    routers.register_legacy_dual_route(
        r"mcp_tools",
        MCPToolsViewSet,
        "project_mcp_tools",
        ["team_id"],
    )
