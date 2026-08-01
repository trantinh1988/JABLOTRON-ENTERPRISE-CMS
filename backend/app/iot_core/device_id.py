"""Global device identity helpers: PANEL_x_DEV_yy."""


def make_panel_id(index: int) -> str:
    if index < 1:
        raise ValueError("panel index must be >= 1")
    return f"PANEL_{index}"


def make_device_global_id(panel_id: str, device_num: int) -> str:
    if device_num < 0 or device_num > 99:
        raise ValueError("device_num must be 0..99")
    return f"{panel_id}_DEV_{device_num:02d}"


def parse_global_id(global_id: str) -> tuple[str, str]:
    """Return (panel_id, device_token) e.g. ('PANEL_1', 'DEV_05')."""
    parts = global_id.rsplit("_DEV_", 1)
    if len(parts) != 2:
        raise ValueError(f"Invalid global device id: {global_id}")
    panel_id, num = parts[0], parts[1]
    return panel_id, f"DEV_{num}"
