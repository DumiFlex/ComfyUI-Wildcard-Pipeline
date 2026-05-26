"""012_templates migration — table exists + accepts a row."""
from engine._utils import now_iso


def test_templates_table_created(wp_db):
    cols = {
        row[1]
        for row in wp_db.execute("PRAGMA table_info(templates);").fetchall()
    }
    assert cols == {
        "id", "name", "description", "category_id", "tags",
        "is_favorite", "template_string", "created_at", "updated_at",
    }


def test_templates_row_roundtrip(wp_db):
    now = now_iso()
    wp_db.execute(
        "INSERT INTO templates(id, name, description, category_id, tags, "
        "is_favorite, template_string, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?);",
        ("aabbccdd", "demo", "", None, "[]", 0, "$a $b", now, now),
    )
    row = wp_db.execute(
        "SELECT name, template_string FROM templates WHERE id='aabbccdd';"
    ).fetchone()
    assert row["name"] == "demo"
    assert row["template_string"] == "$a $b"
