"""JA-100 family catalog helpers.

HID 0x8a type/conn is a family code, not an F-Link SKU. Byte 0x04 is shared by
PIR / siren / keypad / RF module — never treat those placeholders as a model.
"""

from __future__ import annotations

GENERIC_MODEL_HINTS = frozenset(
    {
        "JA-bus",
        "Keypad",
        "Smoke",
        "Siren",
        "Glass",
        "PIR",
        "Bus",
        "RF",
    }
)

VALID_DEVICE_LINKS = frozenset({"bus", "rf"})


def normalize_device_link(value: str | None) -> str:
    v = (value or "").strip().lower()
    return v if v in VALID_DEVICE_LINKS else ""


def is_generic_model_hint(model: str | None) -> bool:
    """True when the stored model is empty or an invented HID placeholder."""
    m = (model or "").strip()
    if not m:
        return True
    if m in GENERIC_MODEL_HINTS:
        return True
    if m.startswith("Bus 0x") or m.startswith("RF 0x"):
        return True
    return False


def is_unrefined_device_type(device_type: str | None) -> bool:
    cur = (device_type or "sensor").strip().lower()
    return cur in ("", "sensor", "other")
