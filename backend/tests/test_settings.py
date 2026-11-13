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
    skip = {"DJANGO_SECRET_KEY", "DJANGO_ALLOWED_HOSTS", "ALLOWED_HOSTS"}
    env = {key: value for key, value in os.environ.items() if key not in skip}
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


def _hosts(env: dict[str, str]) -> str:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import django; django.setup(); from django.conf import settings; print(','.join(settings.ALLOWED_HOSTS))",
        ],
        cwd=BACKEND,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def test_django_allowed_hosts_wins_over_the_fallback():
    hosts = _hosts(
        _env(
            DJANGO_DEBUG="1",
            DJANGO_ALLOWED_HOSTS="api.example,127.0.0.1",
            ALLOWED_HOSTS="ignored.example",
        )
    )
    assert hosts == "api.example,127.0.0.1"


def test_allowed_hosts_is_the_fallback():
    hosts = _hosts(_env(DJANGO_DEBUG="1", ALLOWED_HOSTS="fallback.example"))
    assert hosts == "fallback.example"
