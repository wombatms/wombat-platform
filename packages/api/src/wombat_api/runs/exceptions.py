"""Domain exceptions for the SP3.3 Run / Result / Evidence layer.

These are raised by `Repository` methods (and by service code built on
top of them) so routes can translate domain failures into HTTP errors
without leaking SQLAlchemy internals.
"""

from __future__ import annotations


class RunDomainError(Exception):
    """Base class."""


class RunNotFoundError(RunDomainError): ...


class RunClosedError(RunDomainError): ...


class RunNotOpenError(RunDomainError): ...


class ResultConflictError(RunDomainError):
    def __init__(self, current_revision: int):
        super().__init__(f"revision conflict; current={current_revision}")
        self.current_revision = current_revision


class CaseAlreadyInRunError(RunDomainError): ...


class CaseNotInRunError(RunDomainError): ...


class EnvironmentNotFoundError(RunDomainError): ...
