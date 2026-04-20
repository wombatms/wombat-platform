"""Tests for config loading."""

from wombat_core.config.loader import load_config


class TestWombatConfig:
    def test_load_valid_config(self, tmp_path):
        config_dir = tmp_path / ".wombat"
        config_dir.mkdir()
        config_file = config_dir / "config.yaml"
        config_file.write_text("""
project:
  id: "test-project"
  name: "Test Project"
  org: "test-org"
  default_owner: "qa-team"

taxonomy:
  components: [auth, payments]
  environments: [staging, prod]

lint:
  rules:
    require_expected_per_step: true
    require_owner: true
    max_steps: 30

id:
  auto_sequence: true
""")
        config = load_config(tmp_path)
        assert config.project.id == "test-project"
        assert config.project.org == "test-org"
        assert "auth" in config.taxonomy.components
        assert config.lint.rules.get("max_steps") == 30
        assert config.id.auto_sequence is True

    def test_load_missing_config_returns_default(self, tmp_path):
        config = load_config(tmp_path)
        assert config.project.id == ""
        assert config.taxonomy.components == []

    def test_walks_up_to_find_config(self, tmp_path):
        config_dir = tmp_path / ".wombat"
        config_dir.mkdir()
        config_file = config_dir / "config.yaml"
        config_file.write_text("""
project:
  id: "parent-project"
  name: "Parent"
  default_owner: "qa"
""")
        nested = tmp_path / "testcases" / "payments"
        nested.mkdir(parents=True)
        config = load_config(nested)
        assert config.project.id == "parent-project"
