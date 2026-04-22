from wombat_api.rbac.models import Role
from wombat_api.rbac.permissions import Permission, role_permissions


def test_viewer_has_runs_read_only():
    perms = role_permissions(Role.viewer)
    assert Permission.RUNS_READ in perms
    assert Permission.RUNS_CREATE not in perms


def test_editor_has_all_runs_perms_except_reopen():
    perms = role_permissions(Role.editor)
    for p in (Permission.RUNS_READ, Permission.RUNS_CREATE, Permission.RUNS_RECORD, Permission.RUNS_CLOSE):
        assert p in perms
    assert Permission.RUNS_REOPEN not in perms


def test_admin_has_runs_reopen():
    assert Permission.RUNS_REOPEN in role_permissions(Role.admin)
