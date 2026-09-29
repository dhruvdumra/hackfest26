from collections.abc import Iterator

import pytest

#: The pipeline now parks on the Two-Key consent step until someone answers.
#: Most tests only care that a run finishes, so they get a wait short enough
#: to time out at once; tests of the consent round trip pass their own timeout.
FAST_CONSENT_TIMEOUT_SECONDS = "0.05"


@pytest.fixture(autouse=True, scope="session")
def _fast_consent_timeout() -> Iterator[None]:
    # Session scoped so it is already set when module-scoped fixtures build Settings.
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("CONSENT_TIMEOUT_SECONDS", FAST_CONSENT_TIMEOUT_SECONDS)
        yield
