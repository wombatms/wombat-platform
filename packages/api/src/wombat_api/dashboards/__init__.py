# dashboards subpackage
# Widget implementations are imported below (Tasks 12-16); their side-effect
# registrations populate REGISTRY in dashboards/registry.py.

from wombat_api.dashboards.widgets import passfail_trend as _passfail_trend  # noqa: F401
from wombat_api.dashboards.widgets import recent_runs as _recent_runs  # noqa: F401
from wombat_api.dashboards.widgets import release_readiness as _release_readiness  # noqa: F401
from wombat_api.dashboards.widgets import review_backlog as _review_backlog  # noqa: F401
from wombat_api.dashboards.widgets import top_failing_cases as _top_failing_cases  # noqa: F401
