import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("delta", Path(__file__).with_name("gcp-refresh-push-tokens.py"))
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)


class DeltaSafetyTests(unittest.TestCase):
    def test_cloud_sql_export_starts_with_select_not_comments(self):
        self.assertEqual(delta.export_query("-- Inventory only\n-- No rows\nSELECT '{}'::jsonb;"), "SELECT '{}'::jsonb")
        with self.assertRaises(ValueError):
            delta.export_query("SELECT 1; DELETE FROM public.stores")

    def test_only_reviewed_table_can_change(self):
        with self.assertRaises(ValueError):
            delta.build_refresh_sql({"stores": 1}, {"stores": 2}, [], {}, "SELECT '{}'::jsonb")

    def test_quote_escape_and_transaction_guards(self):
        sql = delta.build_refresh_sql(
            {"push_tokens": "old"}, {"push_tokens": "new"},
            [{"token": "test'; DROP TABLE public.stores; --"}],
            {"last_value": 5, "is_called": True}, "SELECT '{}'::jsonb;",
        )
        self.assertIn("test''; DROP", sql)
        self.assertIn("current_database() <> 'dodolink'", sql)
        self.assertIn("Target changed since verification", sql)
        self.assertIn("Post-refresh verification failed", sql)
        self.assertIn("LOCK TABLE public.push_tokens", sql)
        self.assertTrue(sql.rstrip().endswith("COMMIT;"))

    def test_sequence_input_is_not_sql(self):
        with self.assertRaises(ValueError):
            delta.build_refresh_sql(
                {"push_tokens": 1}, {"push_tokens": 2}, [],
                {"last_value": "1); DROP TABLE public.stores", "is_called": True},
                "SELECT '{}'::jsonb",
            )


if __name__ == "__main__":
    unittest.main()
