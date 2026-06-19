from django.db import migrations, models

from posthog.migration_helpers import CreateIndexConcurrently


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("event_definitions", "0009_drop_eventproperty_proj_event_coalesce_idx"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddIndex(
                    model_name="eventproperty",
                    index=models.Index(
                        fields=["project", "property", "event"],
                        name="ph_eve_proj_prop_event_idx",
                    ),
                ),
            ],
            database_operations=[
                CreateIndexConcurrently(
                    index_name="ph_eve_proj_prop_event_idx",
                    table_name="posthog_eventproperty",
                    columns="(project_id, property, event)",
                ),
            ],
        ),
    ]
