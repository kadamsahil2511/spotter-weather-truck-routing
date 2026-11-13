import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]


def _boot(env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-c", "import django; django.setup()"],
        cwd=BACKEND,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def _env(**overrides: str) -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if key != "DJANGO_SECRET_KEY"}
    env["DJANGO_SETTINGS_MODULE"] = "config.settings"
    env.update(overrides)
    return env


@pytest.mark.parametrize("secret", ["", "change-me", "dev-only-not-for-production", "dev-only-change-me"])
def test_production_refuses_a_missing_or_default_secret(secret: str):
    result = _boot(_env(DJANGO_DEBUG="0", DJANGO_SECRET_KEY=secret))
    assert result.returncode != 0
    assert "DJANGO_SECRET_KEY" in result.stderr + result.stdout


def test_production_accepts_a_real_secret():
    result = _boot(_env(DJANGO_DEBUG="0", DJANGO_SECRET_KEY="a-real-production-secret"))
    assert result.returncode == 0
