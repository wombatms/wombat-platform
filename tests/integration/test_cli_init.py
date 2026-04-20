"""Integration tests for `wombat init`."""

from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from wombat_cli.main import app

from .conftest import parse_json_output


class TestInitCommand:
    def test_init_creates_wombat_dir(self, runner: CliRunner, init_dir: Path):
        result = runner.invoke(app, ["init", str(init_dir)])
        assert result.exit_code == 0
        assert (init_dir / ".wombat").is_dir()

    def test_init_creates_config_yaml(self, runner: CliRunner, init_dir: Path):
        runner.invoke(app, ["init", str(init_dir)])
        config = init_dir / ".wombat" / "config.yaml"
        assert config.exists()
        content = config.read_text()
        assert "project:" in content

    def test_init_creates_subdirectories(self, runner: CliRunner, init_dir: Path):
        runner.invoke(app, ["init", str(init_dir)])
        wombat_dir = init_dir / ".wombat"
        for subdir in ["testcases", "shared-steps", "plans", "stories", "suites"]:
            assert (wombat_dir / subdir).is_dir(), f"Missing subdir: {subdir}"

    def test_init_with_project_id_and_name(self, runner: CliRunner, init_dir: Path):
        result = runner.invoke(app, ["init", str(init_dir), "--id", "my-project", "--name", "My Project"])
        assert result.exit_code == 0
        config_text = (init_dir / ".wombat" / "config.yaml").read_text()
        assert "my-project" in config_text
        assert "My Project" in config_text

    def test_init_json_output(self, runner: CliRunner, init_dir: Path):
        result = runner.invoke(app, ["init", str(init_dir), "--json"])
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert "created" in data
        assert "wombat_dir" in data
        assert isinstance(data["created"], list)
        assert len(data["created"]) > 0

    def test_init_fails_if_already_initialised(self, runner: CliRunner, init_dir: Path):
        runner.invoke(app, ["init", str(init_dir)])
        result = runner.invoke(app, ["init", str(init_dir)])
        assert result.exit_code != 0

    def test_init_force_overwrites_existing(self, runner: CliRunner, init_dir: Path):
        runner.invoke(app, ["init", str(init_dir), "--id", "original"])
        result = runner.invoke(app, ["init", str(init_dir), "--id", "overwritten", "--force"])
        assert result.exit_code == 0
        config_text = (init_dir / ".wombat" / "config.yaml").read_text()
        assert "overwritten" in config_text

    def test_init_nonexistent_directory_fails(self, runner: CliRunner, tmp_path: Path):
        bad_path = tmp_path / "does_not_exist"
        result = runner.invoke(app, ["init", str(bad_path)])
        assert result.exit_code != 0

    def test_init_already_initialised_json_error(self, runner: CliRunner, init_dir: Path):
        runner.invoke(app, ["init", str(init_dir)])
        result = runner.invoke(app, ["init", str(init_dir), "--json"])
        assert result.exit_code != 0
        data = parse_json_output(result.output)
        assert "error" in data or "code" in data
