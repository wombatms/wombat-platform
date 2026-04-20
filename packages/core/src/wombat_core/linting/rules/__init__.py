"""Built-in lint rules."""

from wombat_core.linting.rules.ambiguous_language import AmbiguousLanguageRule
from wombat_core.linting.rules.id_format import IDFormatRule
from wombat_core.linting.rules.quality import QualityRule
from wombat_core.linting.rules.reference_integrity import ReferenceIntegrityRule
from wombat_core.linting.rules.required_fields import RequiredFieldsRule
from wombat_core.linting.rules.taxonomy import TaxonomyRule


def default_rules():
    """Return an instance of every built-in lint rule."""
    return [
        RequiredFieldsRule(),
        IDFormatRule(),
        ReferenceIntegrityRule(),
        AmbiguousLanguageRule(),
        TaxonomyRule(),
        QualityRule(),
    ]


__all__ = [
    "AmbiguousLanguageRule",
    "IDFormatRule",
    "QualityRule",
    "ReferenceIntegrityRule",
    "RequiredFieldsRule",
    "TaxonomyRule",
    "default_rules",
]
