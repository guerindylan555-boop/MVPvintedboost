"""Shared helpers for usage costs loaded from the repo-level config."""
from __future__ import annotations

import json
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict

_DEFAULT_COST = Decimal("1")


def _load_rules() -> dict[str, Any]:
    path = Path(__file__).resolve().parents[2] / "shared" / "usage-rules.json"
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
            if isinstance(data, dict):
                return data
    except FileNotFoundError:
        return {"precision": 0, "operations": {}}
    except json.JSONDecodeError:
        return {"precision": 0, "operations": {}}
    return {"precision": 0, "operations": {}}


@lru_cache(maxsize=1)
def _get_rules() -> dict[str, Any]:
    return _load_rules()


@lru_cache(maxsize=1)
def get_usage_precision() -> int:
    raw = _get_rules().get("precision")
    try:
        value = int(raw)
        return value if value >= 0 else 0
    except (TypeError, ValueError):
        return 0


@lru_cache(maxsize=1)
def _get_scale() -> Decimal:
    precision = get_usage_precision()
    if precision <= 0:
        return Decimal("1")
    return Decimal(10) ** precision


@lru_cache(maxsize=1)
def get_operation_metadata() -> Dict[str, dict[str, Any]]:
    raw = _get_rules().get("operations")
    if not isinstance(raw, dict):
        return {}
    metadata: Dict[str, dict[str, Any]] = {}
    for key, value in raw.items():
        if not isinstance(value, dict):
            continue
        cost_raw = value.get("cost", 0)
        try:
            cost = Decimal(str(cost_raw))
        except (TypeError, ValueError, ArithmeticError):
            continue
        if cost < 0:
            continue
        metadata[key] = {
            "label": value.get("label"),
            "description": value.get("description"),
            "cost": cost,
        }
    return metadata


@lru_cache(maxsize=1)
def get_operation_costs() -> Dict[str, float]:
    metadata = get_operation_metadata()
    return {key: float(value["cost"]) for key, value in metadata.items()}


def get_operation_cost(operation: str, default: Decimal | float | int = _DEFAULT_COST) -> float:
    metadata = get_operation_metadata()
    if operation in metadata:
        return float(metadata[operation]["cost"])
    try:
        return float(Decimal(str(default)))
    except (TypeError, ValueError, ArithmeticError):
        return float(_DEFAULT_COST)


def amount_to_units(amount: Decimal | float | int) -> int:
    try:
        dec = Decimal(str(amount))
    except (TypeError, ValueError, ArithmeticError):
        dec = Decimal(0)
    if dec <= 0:
        return 0
    scale = _get_scale()
    scaled = dec * scale
    return int(scaled.to_integral_value(rounding=ROUND_HALF_UP))


def units_to_amount(units: int) -> float:
    try:
        raw = int(units)
    except (TypeError, ValueError):
        raw = 0
    scale = _get_scale()
    if scale == 0:
        return float(raw)
    dec = Decimal(raw) / scale
    return float(dec)


USAGE_PRECISION = get_usage_precision()
USAGE_SCALE = int(_get_scale())
DEFAULT_OPERATION_COST = float(_DEFAULT_COST)
